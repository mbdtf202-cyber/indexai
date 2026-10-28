/**
 * 情报层（news）—— 归档与压缩的全部纯逻辑
 *
 * 目标：**跨度尽可能长，单条字节尽可能少，只增不删。**
 *
 * 三条硬规矩：
 *   1. 每天 20 条上限只用来「挑当天代表性条目」，绝不销毁已入库的条目。
 *      历史上选进来的大新闻，一周后可能分数被别的条目压过，但它的价值不随时间下降。
 *   2. 大新闻按分数给「保留天数」。越重要留得越久；日常条目在预算吃紧时才让步。
 *   3. 落盘用短键，渲染时再展开。标题不压（它是唯一不可再生信息），
 *      摘要只留「多出来的信息」——标题里已经出现过的字、来源尾巴、套话前缀全部砍掉。
 *
 * 这个文件不碰网络也不碰文件，collect 与提交脚本都只是调用方。
 */

import { todayISO } from './clock.js';
import { dayDiff, normalizeNewsUrl, clusterNews } from './news-cluster.js';
import {
  TOPIC_LABEL,
  TOPIC_CODE,
  CODE_TOPIC,
  classifyNews,
  scoreNews,
  newsImportance,
} from './news-topics.js';

export { normalizeNewsUrl, titleSimilarity, clusterNews, newsSourceQuality } from './news-cluster.js';

export {
  NEWS_TOPICS,
  TOPIC_LABEL,
  TOPIC_CODE,
  CODE_TOPIC,
  classifyNews,
  scoreNews,
  newsImportance,
  retentionDays,
} from './news-topics.js';

/* ────────────────────────── 摘要压缩 ────────────────────────── */

/** 来源站往摘要里塞的尾巴：链接、"阅读原文"、"via AIHOT" */
const TAIL_RES = [
  /\s*🔗.*$/s,
  /\s*via\s+AIHOT.*$/is,
  /\s*阅读原文.*$/s,
  /\s*https?:\/\/\S+\s*$/,
];

/** 开场套话：删掉不影响信息量 */
const PREAMBLE_RES = [
  /^(据[^，。]{1,12}(报道|消息|称)[，,：:]?)/,
  /^(消息称|消息人士称|知情人士称)[，,：:]?/,
  /^(当地时间)?(今天|昨日|近日)[，,]?/,
  /^(据报道|报道称|外媒报道)[，,：:]?/,
];

/** 砍到指定长度时优先在标点处断句 */
function clip(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const cut = Math.max(
    head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('，'), head.lastIndexOf('、'),
  );
  return (cut > max * 0.55 ? head.slice(0, cut) : head).replace(/[，、；]$/, '') + '…';
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 摘要只保留「标题里没有的信息」。
 * 做法：按句切，逐句算与标题的二元组重合率，重合过半的句子直接丢；
 * 剩下的句子如果本身就在复述标题，整条摘要就丢掉（标题已经说完了）。
 */
export function squeezeSummary(title, summary, max = 120) {
  let s = String(summary || '');
  if (!s) return '';
  for (const re of TAIL_RES) s = s.replace(re, '');
  for (const re of PREAMBLE_RES) s = s.replace(re, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^["“「](.*)["”」]$/s, '$1').trim();
  if (!s) return '';

  const tbg = bigrams(String(title || '').replace(/\s/g, ''));
  const sentences = s.split(/(?<=[。！？!?])/).map((x) => x.trim()).filter(Boolean);
  const keptSentences = sentences.filter((sentence) => {
    const body = sentence.replace(/[。！？!?]$/, '');
    if (body.length < 8) return false;
    const bg = bigrams(body.replace(/\s/g, ''));
    if (!bg.size) return false;
    let hit = 0;
    for (const g of bg) if (tbg.has(g)) hit += 1;
    return hit / bg.size < 0.5;          // 一半以上的字标题里都有 → 纯复述
  });
  if (!keptSentences.length) return '';
  let out = keptSentences.join('');
  if (!out) return '';
  // 剩下的长度上限跟标题长度挂钩：标题短 → 摘要承担更多信息
  const budget = Math.max(48, Math.min(max, 168 - Math.min(90, String(title || '').length)));
  out = clip(out, budget).trim();
  if (out.length < 12) return '';
  return out;
}

/* ────────────────────────── 落盘编码（短键） ──────────────────────────
 * 短键比长键省 40%；摘要压缩再加省 25–35%。
 *
 * **标题与 URL 一律不截断**（INV-9）。这两样都不可再生：
 * - 标题截到 96 字且不加省略号 = 永久丢失，读者看不出被截过（归档里已有实例）；
 * - URL 截到 168 字 = 死链，还会让去重键失真（两个不同的长链接可能撞成一条）。
 * 省体积靠短键与摘要压缩，不靠砍标题。 */


export function encodeNews(n) {
  const url = normalizeNewsUrl(n.url || n.u || '');
  if (!url) return null;
  const title = String(n.title || '').trim();
  if (!title) return null;
  const topic = n.topic || classifyNews(title);
  const out = {
    u: url,
    d: String(n.date || '').slice(0, 10),
    tm: String(n.time || '').slice(0, 5) || undefined,
    t: title,
    tp: TOPIC_CODE[topic] ?? TOPIC_CODE.other ?? 99,
  };
  const via = normalizeNewsUrl(n.via || '');
  if (via && via !== url) out.v = via;
  const s = n.sq ?? squeezeSummary(title, n.summary);
  if (s) out.s = s;
  const sc = n.score ?? scoreNews({ title, summary: s || '' });
  out.sc = sc;
  out.im = n.importance || newsImportance({ title, summary: s || '', score: sc });
  if (n.ns > 1) out.ns = n.ns;
  return out;
}

/** 解码回渲染层字段。`full` 决定是否带摘要（长跨度默认只给标题）。 */
export function decodeNews(x) {
  return {
    key: x.u,
    url: x.u,
    date: x.d || '',
    time: x.tm || '',
    title: x.t || '',
    summary: x.s || '',
    topic: CODE_TOPIC[x.tp] || 'other',
    topicLabel: TOPIC_LABEL[CODE_TOPIC[x.tp]] || '其他',
    score: x.sc ?? 0,
    importance: x.im || 'daily',
    via: x.v || '',
    sourceCount: x.ns || 1,
  };
}

/* ────────────────────────── 源解析 ────────────────────────── */

/**
 * 解析 news-frontline.yaml。源站每天只给最近约 50 条，
 * 所以「跨度」只能靠我们自己一天天攒 + 从存档回填。
 */
export function parseNewsYaml(text) {
  const items = [];
  /* F09：首条曾经会丢。
   *
   * 原来的切分是 split(/\n\s*-\s+date:/)，要求每条前面有一个换行。
   * 当文本以 `- date:` 开头（行首没有换行）时，第一条就不在任何 chunk 里。
   *
   * 修法：先在文本前面补一个换行再切。这样无论首条前面有没有换行，
   * 它都会被切出来——补的这一个换行不会产生空条目（切完就丢掉第一段）。 */
  const normalized = `\n${String(text || '')}`;
  const chunks = normalized.split(/\n\s*-\s+date:\s*/).slice(1);
  for (const ch of chunks) {
    const date = (ch.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
    const time = (ch.match(/\n\s*time:\s*"?([\d:]+)"?/) || [])[1] || null;
    const title = (ch.match(/\n\s*title:\s*"((?:[^"\\]|\\.)*)"/) || ch.match(/\n\s*title:\s*(.+)/) || [])[1];
    let summary = (ch.match(/\n\s*summary:\s*"((?:[^"\\]|\\.)*)"/) || ch.match(/\n\s*summary:\s*(.+)/) || [])[1] || '';
    const url = (ch.match(/\n\s*url:\s*"?([^"\n\s]+)"?/) || [])[1] || null;
    if (!title || !url) continue;
    items.push({
      date,
      time,
      title: String(title).replace(/\\"/g, '"').trim(),
      summary: String(summary).replace(/\\"/g, '"').trim(),
      url,
    });
  }
  return items;
}

/* ────────────────────────── 归档合并 ────────────────────────── */

/**
 * 只增不删地合并。
 *
 * 信息优先级（越高越不可能被预算删掉）：
 *   P0 每天分数最高的几张「门面」，任何年龄都留
 *   P1 major
 *   P2 近 120 天，按分数排
 *   P3 更早的，按分数排
 * 只有在总量超预算时才从 P3 最底端开始削；削掉的是「同一天里最没信息量的那条」，
 * 而不是原来那种「过了 24 点就整批销毁」。
 */
export const PRIORITY = { doorsPerDay: 6, recentDays: 120 };

export function mergeArchive(history, fresh, {
  today = todayISO(),
  budget = 6000,           // 条目数上限（约 1.2MB 归档，每天 300 条时能吃满约 3 周 + 长期沉淀）
  maxSpanDays = 1500,
} = {}) {
  const map = new Map();
  const put = (raw) => {
    const enc = encodeNews(raw);
    if (!enc || !enc.d) return;
    const prev = map.get(enc.u);
    if (!prev) { map.set(enc.u, enc); return; }
    map.set(enc.u, {
      ...prev,
      ...Object.fromEntries(Object.entries(enc).filter(([, v]) => v !== undefined && v !== '')),
      d: prev.d && enc.d ? (prev.d < enc.d ? prev.d : enc.d) : (prev.d || enc.d),
      // 摘要保留更长的那份：先抓到的往往更完整
      s: prev.s && prev.s.length >= (enc.s || '').length ? prev.s : enc.s,
      tp: prev.tp ?? enc.tp,
      sc: Math.max(prev.sc ?? 0, enc.sc ?? 0),
      im: prev.im === 'major' || enc.im === 'major' ? 'major' : 'daily',
    });
  };

  for (const x of history || []) put(x.u ? decodeNews(x) : { ...x, url: x.url });
  for (const x of fresh || []) put(x);

  let list = [...map.values()].filter((x) => {
    const age = dayDiff(x.d, today);
    return age >= -1 && age <= maxSpanDays;
  });

  /* 48 小时内标题相似的条目合并成一个事件；`ns` 记录来源数。 */
  list = clusterNews(list);

  if (list.length > budget) {
    // 每天的门面：分数前 doorsPerDay 条，永不被预算删除
    const byDay = new Map();
    for (const x of list) {
      if (!byDay.has(x.d)) byDay.set(x.d, []);
      byDay.get(x.d).push(x);
    }
    const doors = new Set();
    for (const [, rows] of byDay) {
      rows.slice().sort((a, b) => (b.sc ?? 0) - (a.sc ?? 0))
        .slice(0, PRIORITY.doorsPerDay)
        .forEach((x) => doors.add(x.u));
    }
    const rank = (x) => {
      if (doors.has(x.u)) return 0;
      if (x.im === 'major') return 1;
      return dayDiff(x.d, today) <= PRIORITY.recentDays ? 2 : 3;
    };
    // 先按优先级，再按分数与新近程度排；从尾部开始削
    const ranked = list.slice().sort((a, b) => {
      const ra = rank(a); const rb = rank(b);
      if (ra !== rb) return ra - rb;           // 高优先级在前
      if ((b.sc ?? 0) !== (a.sc ?? 0)) return (b.sc ?? 0) - (a.sc ?? 0);
      return b.d.localeCompare(a.d);
    });
    list = ranked.slice(0, budget);
  }

  return list.sort((a, b) =>
    b.d.localeCompare(a.d) || String(b.tm || '').localeCompare(String(a.tm || '')) || (b.sc ?? 0) - (a.sc ?? 0));
}

/* ────────────────────────── 统计 ────────────────────────── */

export function archiveStats(archive, today = todayISO()) {
  const list = archive || [];
  const dates = list.map((x) => x.d).filter(Boolean).sort();
  const byDay = new Map();
  for (const x of list) byDay.set(x.d, (byDay.get(x.d) || 0) + 1);
  const days = byDay.size;
  const spanDays = dates.length ? dayDiff(dates[0], today) + 1 : 0;
  const major = list.filter((x) => x.im === 'major').length;
  const bytes = JSON.stringify(list).length;
  return {
    n: list.length,
    days,
    spanDays,
    first: dates[0] || null,
    last: dates[dates.length - 1] || null,
    major,
    daily: list.length - major,
    bytes,
    perDay: days ? +(list.length / days).toFixed(1) : 0,
  };
}

/**
 * data.json 里只放极简索引：首页计数、健康门禁、跨度提示都用它，
 * 完整条目留在 news-archive.json，由页面按需拉。
 * 索引只带近 N 天，一天一个字符长度级别，几十字节。
 */
export function buildIndex(archive, { today = todayISO(), days = 400 } = {}) {
  const s = archiveStats(archive, today);
  const per = {};
  for (const x of archive || []) {
    const age = dayDiff(x.d, today);
    if (Number.isFinite(age) && age <= days) per[x.d] = (per[x.d] || 0) + 1;
  }
  return {
    n: s.n, days: s.days, span: s.spanDays, first: s.first, last: s.last,
    major: s.major, per, bytes: s.bytes,
  };
}
