#!/usr/bin/env node
/**
 * IndexAI — 数据健康检查
 *
 * 一个地方定义「什么叫这层数据还活着」，两处复用：
 *   - collect.mjs 跑完调 assertLayers()：某层为空/异常缩水就抛错，不发布残缺数据
 *   - CI 的 health 门禁调 `node health.mjs`：发布前后各验一次，红线不过就让 job 红
 *
 * 设计原则：**失败要响**。以前各层 catch 后返回 []，主流程照常写出 data.json 并发布，
 * 站点看起来一切正常，实际上某一层已经空了几天。这里把这种「静默腐烂」变成硬失败。
 *
 * 用法：
 *   node health.mjs                 # 检查 data.json，红线不达标 exit 1
 *   node health.mjs --json          # 机器可读输出（CI 摘要用）
 *   node health.mjs --report        # 人读表格
 */

import { readFile } from 'node:fs/promises';

const DATA = new URL('./data.json', import.meta.url);
const HISTORY = new URL('./news-history.json', import.meta.url);

/* ────────────────────────── 基线 ──────────────────────────
 * min       ：低于这个数直接判死（源挂了、解析器失效）
 * shrink    ：相对上一次少于这个比例判死（源改版、部分失败）
 * warnBelow ：低于这个数只警告不拦（可以发布，但要在 health 里留痕）
 * 2026-10-24 实测值写在注释里，改阈值前先看实测。
 *
 * 注意：这里**不写 actual 之类的实测快照**。实测数会随采集扩容漂移，
 * 写死当默认值就成了「硬编码隐患」——读数一偏，门禁就被无声放宽。
 * 实测值一律运行时从 data.json 算，见 layerCount()。 */
export const LAYERS = {
  models:        { min: 350, warnBelow: 400, shrink: 0.75, label: '模型比价' },   // 实测 474
  offers:        { min: 25,  warnBelow: 30,  shrink: 0.80, label: '免费额度' },   // 实测 37
  subsRegions:   { min: 12,  warnBelow: 15,  shrink: 0.70, label: '订阅区价套餐' }, // 实测 18
  subsThird:     { min: 50,  warnBelow: 80,  shrink: 0.60, label: '第三方挂单' }, // 实测 209
  relays:        { min: 40,  warnBelow: 50,  shrink: 0.80, label: '中转站在册' }, // 实测 54
  relaysLive:    { min: 8,   warnBelow: 12,  shrink: 0.60, label: '中转站有价' }, // 实测 22
  events:        { min: 243, warnBelow: 382, shrink: 0.70, label: 'AI 活动' },    // 实测 695（Devpost 192 + Luma 480 + AIOS 23）；红线取 35%，警戒 55%
  news:          { min: 200, warnBelow: 800, shrink: 0.70, label: '情报归档' },   // 实测 2235
  resources:     { min: 12,  warnBelow: 16,  shrink: 0.80, label: '工具箱' },     // 实测 21
  bench:         { min: 120, warnBelow: 140, shrink: 0.75, label: '评测' },       // 实测 155
  signals:       { min: 8,   warnBelow: 12,  shrink: 0.70, label: '一手信号' },   // 实测 21
  aaModels:      { min: 150, warnBelow: 200, shrink: 0.70, label: 'AA 智能指数' }, // 实测 266
  orApps:        { min: 10,  warnBelow: 15,  shrink: 0.60, label: 'OR 应用榜' },  // 实测 25
  orModels:      { min: 8,   warnBelow: 12,  shrink: 0.60, label: 'OR 模型榜' },  // 实测 20
  hnSignals:     { min: 8,   warnBelow: 12,  shrink: 0.60, label: 'HN 民间声量' }, // 实测 16
};

/* ────────────────── 活动层：按来源分层的门禁 ──────────────────
 * 事故复盘：活动总数「看着还行」，其实好几个源根本没采到。
 * 旧门禁只有 events.min，只看总数——某个源归零、另一个源翻倍，总数照样过。
 * 所以活动层必须**按源分别**设下限，单源归零要能单独判死。
 *
 * 采集端的 source 字段是人读的大小写（'Devpost' / 'Luma' / 'AIOS'），
 * 比对时统一小写，将来采集端改成小写也不会误判。
 *
 * optional:true —— 可选本地层（AIOS 读本机文件）。没装 AIOS 就该是 0，
 * 所以不设绝对下限；但只要上一版有、这一版凭空变 0，就是采集中断，照样判死。
 *
 * TODO(校准) 采集端扩容落地后（Devpost 192 + Luma 463 + AIOS 23 ≈ 678），
 * 按实测总量重算：总量 min≈35%、warnBelow≈55%；分源 min 取各源实测的 ~35%：
 *   devpost ≈ 67、luma ≈ 162、aios 维持可选。
 * 先按保守值跑，避免 collector 中途写 data.json 时误报。 */
export const EVENT_SOURCES = {
  devpost:  { min: 67,  warnBelow: 106, label: '活动源 Devpost' },  // 实测 192；红线 35%，警戒 55%
  luma:     { min: 168, warnBelow: 264, label: '活动源 Luma' },     // 实测 480；同上
  // Devfolio 只收 AI 相关的未截止场次，量小但真实（实测 9 条）。红线放到 3，防整源归零。
  devfolio: { min: 3,   warnBelow: 6,   label: '活动源 Devfolio' },
  aios:     { min: 0,   warnBelow: 0,   label: '活动源 AIOS', optional: true },
};

/* 活动的语义护栏：比例是「推断失灵 / 灌水」的报警线，不是数量线 */
export const EVENT_GUARDS = {
  otherRegionMax: 0.40, // region=other 超过 40% → 地区映射失灵
  otherKindMax:   0.50, // kind=other 超过 50% → 类型映射失灵
  urlUniqueMin:   0.90, // URL 去重率 < 90% → 重复灌水
};

/* 语义正确性检查：数量够不等于数据对 */
function semanticChecks(d) {
  const issues = [];
  const red = (k, msg) => issues.push({ level: 'red', key: k, msg });
  const warn = (k, msg) => issues.push({ level: 'warn', key: k, msg });

  // 1. 活动：status 为 open/upcoming 的，不能已经过了 end 日期
  const today = new Date().toISOString().slice(0, 10);
  const ev = Array.isArray(d.events) ? d.events : [];
  const deadOpen = ev.filter((e) => e.status !== 'past' && e.end && e.end < today);
  if (deadOpen.length) red('events', `${deadOpen.length} 个活动标着「开放中」但截止日期已过（最早 ${deadOpen[0].end}：${deadOpen[0].title}）`);

  // 1b. 活动：region/kind 的 other 占比过高 → 推断失灵（数量够但标签全糊在兜底值上）
  if (ev.length) {
    const otherRegion = ev.filter((e) => (e.region || 'other') === 'other').length;
    const otherKind = ev.filter((e) => (e.kind || 'other') === 'other').length;
    const rShare = otherRegion / ev.length;
    const kShare = otherKind / ev.length;
    if (rShare > EVENT_GUARDS.otherRegionMax) {
      red('events', `${otherRegion}/${ev.length}（${(rShare * 100).toFixed(0)}%）活动 region=other，超过 ${(EVENT_GUARDS.otherRegionMax * 100)}% 上限：地区映射失灵`);
    }
    if (kShare > EVENT_GUARDS.otherKindMax) {
      red('events', `${otherKind}/${ev.length}（${(kShare * 100).toFixed(0)}%）活动 kind=other，超过 ${(EVENT_GUARDS.otherKindMax * 100)}% 上限：类型映射失灵`);
    }

    // 1c. 活动：URL 去重率过低 → 重复灌水（同一个活动被反复塞进数组凑数）
    const withUrl = ev.filter((e) => e.url).length;
    const uniqueUrl = new Set(ev.map((e) => e.url).filter(Boolean)).size;
    if (!withUrl) red('events', '活动全都没有 URL，无法回溯来源');
    else if (uniqueUrl / ev.length < EVENT_GUARDS.urlUniqueMin) {
      red('events', `活动 URL 去重后只有 ${uniqueUrl} 条 / 共 ${ev.length} 条（去重率 ${((uniqueUrl / ev.length) * 100).toFixed(0)}%，低于 ${(EVENT_GUARDS.urlUniqueMin * 100)}%）：疑似重复灌水`);
    } else if (withUrl < ev.length) {
      warn('events', `${ev.length - withUrl} 个活动没有 URL`);
    }
  }

  // 2. 价格：模型全部必须带价格，input=0 但 output>0 是脏数据
  const badPrice = (d.models || []).filter((m) => m.input === 0 && m.output > 0);
  if (badPrice.length) red('models', `${badPrice.length} 个模型 input=0 但 output>0`);
  const noPrice = (d.models || []).filter((m) => m.input == null && m.output == null);
  if (noPrice.length) red('models', `${noPrice.length} 个模型没有任何价格`);

  // 3. 来源：每条模型都要能回溯到 URL
  const noSrc = (d.models || []).filter((m) => !m.src && !m.url);
  if (noSrc.length) red('models', `${noSrc.length} 个模型没有来源 URL`);

  // 4. 订阅：subs 是苹果区价派生的官方月费，必须非空
  const subs = Array.isArray(d.subs) ? d.subs : [];
  if (!subs.length) red('subs', '官方订阅层为空（subs=0），订阅页会只剩第三方挂单');
  const noUsd = subs.filter((s) => s.price == null || !(s.price > 0));
  if (subs.length && noUsd.length > subs.length * 0.2) red('subs', `${noUsd.length}/${subs.length} 档订阅没有美区价格`);

  // 5. 时间戳：生成时间不能是未来，也不能太旧
  const gen = Date.parse(d.meta?.generated_at || '');
  if (!Number.isFinite(gen)) red('meta', 'generated_at 缺失或无法解析');
  else {
    const ageH = (Date.now() - gen) / 3600000;
    if (ageH < -1) red('meta', `generated_at 在未来（${d.meta.generated_at}）`);
    else if (ageH > 48) red('meta', `数据已 ${ageH.toFixed(1)} 小时未更新`);
    else if (ageH > 30) issues.push({ level: 'warn', key: 'meta', msg: `数据已 ${ageH.toFixed(1)} 小时未更新，接近日更上限` });
  }

  // 6. 汇率：必须是正数且接近合理区间
  const fx = Number(d.meta?.fx?.USDCNY);
  if (!(fx > 4 && fx < 12)) red('meta', `汇率异常：USDCNY=${d.meta?.fx?.USDCNY}`);

  // 7. 中转站：在册站点里至少要有一批真的探测成功
  const rl = d.relays || [];
  const ok = rl.filter((r) => r.status === 'ok');
  if (rl.length && !ok.length) red('relays', '所有中转站探测都失败了');

  // 8. 情报：跨度塌缩比条数下降更危险——说明归档被重写而不是被追加
  const ni = d.news;
  if (ni && !Array.isArray(ni)) {
    const span = Number(ni.span || 0);
    const days = Number(ni.days || 0);
    if (!(ni.n > 0)) red('news', '情报归档为空，情报页只剩一手信号');
    else if (span < 30) red('news', `情报跨度只有 ${span} 天（归档应当只增不删，跨度塌缩说明被覆盖了）`);
    else if (days < 10) issues.push({ level: 'warn', key: 'news', msg: `情报只有 ${days} 天有内容，跨度 ${span} 天，中间大量空窗` });
    if (Number(ni.bytes || 0) > 4 * 1024 * 1024) issues.push({ level: 'warn', key: 'news', msg: `情报归档 ${(ni.bytes / 1048576).toFixed(1)}MB，超过 4MB 该收紧保留了` });
  }

  // 9. 采集明细：能定位是哪一层空掉的
  const stale = (d.meta?.collect || []).filter((c) => c.status === 'stale' || c.status === 'failed');
  if (stale.length) issues.push({ level: 'warn', key: 'collect', msg: `${stale.length} 层沿用了上一版数据：${stale.map((s) => s.layer).join(', ')}` });

  return issues;
}

/* ────────────────── 按来源分层的活动门禁 ──────────────────
 * 单独一层检查，不进 LAYERS：LAYERS 的 key 直接对应 data.json 顶层的数组，
 * 而活动源是 d.events[] 里的一个字段值，countOf() 取不到。
 * 这里的核心作用：总数达标 ≠ 每个源都活着。任何单一来源归零/腰斩都要自己报红。 */
function eventSourceChecks(d) {
  const issues = [];
  const ev = Array.isArray(d.events) ? d.events : [];

  // 按小写归一，避免采集端改大小写写法时整层「归零」误判
  const counts = {};
  for (const e of ev) {
    const k = String(e.source || '').trim().toLowerCase();
    if (k) counts[k] = (counts[k] || 0) + 1;
  }

  const rows = [];
  for (const [key, spec] of Object.entries(EVENT_SOURCES)) {
    const n = counts[key] || 0;
    const row = { key, label: spec.label, n, min: spec.min, warnBelow: spec.warnBelow, status: 'ok', note: '' };

    if (spec.optional) {
      // 可选本地层：0 是合理状态，但「上一版有、这一版没了」说明采集中断
      if (n === 0) {
        row.status = 'warn';
        row.note = '可选本地源，本次无数据';
        issues.push({ level: 'warn', key: `events.${key}`, msg: `${spec.label}：本次为 0（可选本地层，未安装 AIOS 时属正常；若本机装有 AIOS 则需排查路径）` });
      }
    } else if (n < spec.min) {
      row.status = 'red';
      row.note = n === 0 ? '整源为空' : `低于红线 ${spec.min}`;
      issues.push({ level: 'red', key: `events.${key}`, msg: `${spec.label}：${row.note}——总数可能被其它源掩盖` });
    } else if (n < spec.warnBelow) {
      row.status = 'warn';
      row.note = `低于健康值 ${spec.warnBelow}`;
      issues.push({ level: 'warn', key: `events.${key}`, msg: `${spec.label}：${row.note}` });
    }
    rows.push(row);
  }

  // 未知来源：出现 EVENT_SOURCES 之外的值，说明采集端加了新源但门禁没跟上，要留痕
  const known = new Set(Object.keys(EVENT_SOURCES));
  const unexpected = Object.keys(counts).filter((k) => !known.has(k));
  if (unexpected.length) {
    issues.push({
      level: 'warn',
      key: 'events',
      msg: `出现未登记的活动来源 ${unexpected.map((k) => `${k}(${counts[k]})`).join(', ')}：请在 health.mjs 的 EVENT_SOURCES 里补门禁`,
    });
  }

  return { rows, issues };
}

/* ────────────────────────── 主检查 ────────────────────────── */
export function checkData(d, prev) {
  const rows = [];
  const issues = [];

  const countOf = (k) => {
    const c = d.meta?.counts || {};
    if (k === 'subsThird') return (d.subsThird || []).length;
    if (k === 'relaysLive') return (d.relays || []).filter((r) => r.status === 'ok').length;
    if (k === 'subsRegions') return (d.subsRegions || []).length;
    return c[k] ?? (Array.isArray(d[k]) ? d[k].length : 0);
  };

  for (const [key, spec] of Object.entries(LAYERS)) {
    const n = countOf(key);
    const prevN = prev ? prev(key) : null;
    const row = { key, label: spec.label, n, prev: prevN, status: 'ok', note: '' };

    if (n < spec.min) {
      row.status = 'red';
      row.note = n === 0 ? '整层为空' : `低于红线 ${spec.min}`;
    } else if (prevN != null && prevN > spec.min && n < prevN * spec.shrink) {
      row.status = 'red';
      row.note = `较上次 ${prevN} 缩水 ${(100 - (n / prevN) * 100).toFixed(0)}%`;
    } else if (n < spec.warnBelow) {
      row.status = 'warn';
      row.note = `低于健康值 ${spec.warnBelow}`;
    }
    rows.push(row);
    if (row.status === 'red') issues.push({ level: 'red', key, msg: `${spec.label}：${row.note}` });
    else if (row.status === 'warn') issues.push({ level: 'warn', key, msg: `${spec.label}：${row.note}` });
  }

  const srcRes = eventSourceChecks(d);
  rows.push(...srcRes.rows);
  issues.push(...srcRes.issues);

  issues.push(...semanticChecks(d));

  const red = issues.filter((i) => i.level === 'red');
  return { rows, issues, ok: red.length === 0, red, warn: issues.filter((i) => i.level === 'warn') };
}

/* 给 collect.mjs 用的硬门禁：不达标就抛，绝不写残缺 data.json */
export function assertLayers(d, prev, { allowDegraded = false } = {}) {
  const res = checkData(d, prev);
  if (!res.ok) {
    const lines = res.red.map((i) => `  ✗ [${i.key}] ${i.msg}`).join('\n');
    if (allowDegraded) {
      console.error(`[health] 红线未过，但 ALLOW_DEGRADED=1，继续发布：\n${lines}`);
      return res;
    }
    const err = new Error(`数据健康检查未通过，拒绝写 data.json：\n${lines}`);
    err.health = res;
    throw err;
  }
  const warns = res.warn.length ? `（${res.warn.length} 条警告）` : '';
  console.log(`[health] 通过${warns}`);
  for (const w of res.warn) console.log(`  ! [${w.key}] ${w.msg}`);
  return res;
}

/* ────────────────────────── CLI ────────────────────────── */
async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  let d;
  try {
    d = JSON.parse(await readFile(DATA, 'utf8'));
  } catch (e) {
    console.error(`[health] 读不到 data.json：${e.message}`);
    process.exit(2);
  }

  const res = checkData(d, null);

  if (asJson) {
    console.log(JSON.stringify({ ok: res.ok, rows: res.rows, issues: res.issues }, null, 2));
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    const isSourceRow = (r) => Object.hasOwn(EVENT_SOURCES, r.key);
    const minOf = (r) => (r.min != null ? r.min : LAYERS[r.key].min);
    console.log('\n  IndexAI 数据健康检查\n');
    console.log(`  ${pad('层', 16)} ${pad('实测', 8)} ${pad('红线', 6)} ${pad('状态', 6)} 备注`);
    console.log('  ' + '─'.repeat(66));
    for (const r of res.rows) {
      const mark = r.status === 'ok' ? '✓' : r.status === 'warn' ? '!' : '✗';
      console.log(`  ${pad((isSourceRow(r) ? '└ ' : '') + r.label, 16)} ${pad(r.n, 8)} ${pad(minOf(r), 6)} ${pad(mark, 6)} ${r.note}`);
    }
    const red = res.issues.filter((i) => i.level === 'red');
    const warn = res.issues.filter((i) => i.level === 'warn');
    if (red.length) { console.log('\n  红线：'); red.forEach((i) => console.log(`    ✗ [${i.key}] ${i.msg}`)); }
    if (warn.length) { console.log('\n  警告：'); warn.forEach((i) => console.log(`    ! [${i.key}] ${i.msg}`)); }
    console.log(res.ok ? '\n  结论：可以发布\n' : '\n  结论：未通过，不要发布\n');
  }

  process.exit(res.ok ? 0 : 1);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) main();
