/**
 * 情报 URL 规范化与事件聚类（T6.4 · S8.7）。
 *
 * 这些是归档前的纯函数：URL 归一决定去重键，标题相似度决定 48 小时内
 * 同一事件是否合并。放在单独文件里，lib/news.js 只负责落盘与合并。
 */

const dayMs = 864e5;

export function dayDiff(a, b) {
  const pa = Date.parse(a);
  const pb = Date.parse(b);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return Infinity;
  return Math.round((pb - pa) / dayMs);
}

/* ────────────────────────── URL 规范化 ────────────────────────── */

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'ref', 'ref_src', 'source', 'from', 'spm', 'share_token',
]);

/**
 * 去重键与存档 URL 都用规范化后的原始地址（S8.7 · F08）。
 *
 * 只去掉确定不影响内容的跟踪参数与末尾斜杠；query 里可能是文章 id，
 * 不能一股脑删掉。非法 URL 返回空串，调用方按「没有 URL」处理。
 */
export function normalizeNewsUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  let u;
  try {
    u = new URL(text);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
      u.searchParams.delete(key);
    }
  }
  u.hash = '';
  // 根路径的末尾斜杠统一去掉；文章路径保留（有些站点 /a 与 /a/ 是两页）
  if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

/** 标题的指纹：去掉空白、标点与常见发布动词，只留下实义字。 */
function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）()《》【】\-—_:：·.,!?;:'"()[\]{}]/g, '')
    .replace(/(正式|宣布|发布|推出|上线|开源|全新|现已|现已上线|支持|接入)/g, '');
}

function bigramSet(text) {
  const out = new Set();
  for (let i = 0; i < text.length - 1; i += 1) out.add(text.slice(i, i + 2));
  return out;
}

/** 两个标题的 Jaccard 相似度；短标题（<6 字）退化为完全相等。 */
export function titleSimilarity(a, b) {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (!ka || !kb) return 0;
  if (ka.length < 6 || kb.length < 6) return ka === kb ? 1 : 0;
  const A = bigramSet(ka);
  const B = bigramSet(kb);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/**
 * 48 小时内标题高度相似的条目合并为一个事件（S8.7）。
 *
 * 输入/输出都是短键归档行；`ns` 是来源数。保留日期最早、分数最高的那条：
 * 它通常是原始报道，后续转载的标题只会更夸张。
 */
export function clusterNews(rows, { maxDays = 2, threshold = 0.82 } = {}) {
  const sorted = [...(rows || [])].sort(
    (a, b) => String(b.d || '').localeCompare(String(a.d || '')) || (b.sc ?? 0) - (a.sc ?? 0),
  );
  const clusters = [];
  for (const row of sorted) {
    const hit = clusters.find(
      (c) =>
        Math.abs(dayDiff(c.d, row.d)) <= maxDays &&
        titleSimilarity(c.t, row.t) >= threshold,
    );
    if (!hit) {
      clusters.push({ ...row });
      continue;
    }
    hit.ns = (hit.ns || 1) + (row.ns || 1);
    hit.sc = Math.max(hit.sc ?? 0, row.sc ?? 0);
    if (row.im === 'major') hit.im = 'major';
    if ((row.s || '').length > (hit.s || '').length) hit.s = row.s;
    if (!hit.v && row.v) hit.v = row.v;
    if (row.d && (!hit.d || row.d < hit.d)) hit.d = row.d;
  }
  return clusters;
}


/** 聚合/中转入口的域名：这些不算「原始出处」。 */
export const AGGREGATE_NEWS_HOSTS = new Set([
  'aihot.news',
  'news.ycombinator.com',
  'data.aibijia.org',
]);

/**
 * 新入库条目的原始出处覆盖率（T6.4 验收）。
 * 只统计带 URL 的条目；没有 URL 的条目单独计入 missing。
 */
export function newsSourceQuality(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let total = 0;
  let original = 0;
  let missing = 0;
  for (const row of list) {
    const raw = row?.u || row?.url || '';
    if (!raw) {
      missing += 1;
      continue;
    }
    total += 1;
    try {
      const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
      if (!AGGREGATE_NEWS_HOSTS.has(host)) original += 1;
    } catch {
      missing += 1;
    }
  }
  return {
    total,
    original,
    missing,
    ratio: total ? original / total : 0,
  };
}
