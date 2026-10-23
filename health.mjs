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
 * 2026-10-24 实测值写在注释里，改阈值前先看实测。 */
export const LAYERS = {
  models:        { min: 350, warnBelow: 400, shrink: 0.75, label: '模型比价',   actual: 474 },
  offers:        { min: 25,  warnBelow: 30,  shrink: 0.80, label: '免费额度',   actual: 37 },
  subsRegions:   { min: 12,  warnBelow: 15,  shrink: 0.70, label: '订阅区价套餐', actual: 18  },
  subsThird:     { min: 50,  warnBelow: 80,  shrink: 0.60, label: '第三方挂单', actual: 209 },
  relays:        { min: 40,  warnBelow: 50,  shrink: 0.80, label: '中转站在册', actual: 54  },
  relaysLive:    { min: 8,   warnBelow: 12,  shrink: 0.60, label: '中转站有价', actual: 22  },
  events:        { min: 40,  warnBelow: 60,  shrink: 0.70, label: 'AI 活动',   actual: 111 },
  news:          { min: 200, warnBelow: 800, shrink: 0.70, label: '情报归档',   actual: 2235 },
  resources:     { min: 12,  warnBelow: 16,  shrink: 0.80, label: '工具箱',     actual: 21  },
  bench:         { min: 120, warnBelow: 140, shrink: 0.75, label: '评测',       actual: 155 },
  signals:       { min: 8,   warnBelow: 12,  shrink: 0.70, label: '一手信号',   actual: 21  },
  aaModels:      { min: 150, warnBelow: 200, shrink: 0.70, label: 'AA 智能指数', actual: 266 },
  orApps:        { min: 10,  warnBelow: 15,  shrink: 0.60, label: 'OR 应用榜',  actual: 25  },
  orModels:      { min: 8,   warnBelow: 12,  shrink: 0.60, label: 'OR 模型榜',  actual: 20  },
  hnSignals:     { min: 8,   warnBelow: 12,  shrink: 0.60, label: 'HN 民间声量', actual: 16 },
};

/* 语义正确性检查：数量够不等于数据对 */
function semanticChecks(d) {
  const issues = [];
  const red = (k, msg) => issues.push({ level: 'red', key: k, msg });

  // 1. 活动：status 为 open/upcoming 的，不能已经过了 end 日期
  const today = new Date().toISOString().slice(0, 10);
  const ev = Array.isArray(d.events) ? d.events : [];
  const deadOpen = ev.filter((e) => e.status !== 'past' && e.end && e.end < today);
  if (deadOpen.length) red('events', `${deadOpen.length} 个活动标着「开放中」但截止日期已过（最早 ${deadOpen[0].end}：${deadOpen[0].title}）`);

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
    console.log('\n  IndexAI 数据健康检查\n');
    console.log(`  ${pad('层', 14)} ${pad('实测', 8)} ${pad('红线', 6)} ${pad('状态', 6)} 备注`);
    console.log('  ' + '─'.repeat(64));
    for (const r of res.rows) {
      const mark = r.status === 'ok' ? '✓' : r.status === 'warn' ? '!' : '✗';
      console.log(`  ${pad(r.label, 14)} ${pad(r.n, 8)} ${pad(LAYERS[r.key].min, 6)} ${pad(mark, 6)} ${r.note}`);
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
