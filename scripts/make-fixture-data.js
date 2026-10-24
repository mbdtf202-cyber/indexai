#!/usr/bin/env node
/**
 * 从本机真实数据裁出页面测试用的快照（T0.5 · S1.4）。
 *
 * 输出 `fixtures/data/`，总体积必须 ≤ 1 MB（R9）。裁剪规则固定写在代码里，
 * 可重复运行；每次运行覆盖输出，不做增量。
 *
 * 裁剪目标：既要小，又要覆盖每个层的每种渲染分支 ——
 * 免费/付费模型、各来源的活动与各状态、有价/失效中转站、多个评测分组、
 * 跨月情报。所以不是随机抽样，而是按「结构覆盖优先」挑选。
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'fixtures', 'data');

const LIMIT = {
  models: 80,
  events: 60,
  benchBoards: 12,
  news: 200,
};

/** 读取 JSON；缺失时给出可操作的报错。 */
function load(name) {
  try {
    return JSON.parse(readFileSync(join(ROOT, name), 'utf8'));
  } catch {
    throw new Error(`读不到 ${name}：请先运行 npm run collect，或在仓库根放一份真实数据`);
  }
}

/**
 * 按结构覆盖挑模型：
 * 1. 所有官方直连（channelKind === 'direct'）——比价页的主干
 * 2. 每个厂商至少 1 条，保证下拉与分组都有内容
 * 3. 免费与付费各若干，覆盖 band 的三个分支
 * 4. 有缓存价与无缓存价各若干，覆盖「缓存读」列
 */
function pickModels(models) {
  const picked = [];
  const seen = new Set();
  const add = (m) => {
    if (!m || seen.has(m.id + m.channel)) return;
    seen.add(m.id + m.channel);
    picked.push(m);
  };

  // 1) 官方直连全保留（通常 ~30 条）
  for (const m of models) {
    if (m.channelKind === 'direct') add(m);
  }

  // 2) 每个厂商一条（挑 input 最低的那条，通常是该厂最常用的档）
  const byVendor = new Map();
  for (const m of models) {
    const cur = byVendor.get(m.vendorId);
    if (!cur || (m.input ?? 9e9) < (cur.input ?? 9e9)) byVendor.set(m.vendorId, m);
  }
  for (const m of byVendor.values()) add(m);

  // 3) band 覆盖：free / budget / standard / premium 各补两条
  for (const target of ['free', 'budget', 'standard', 'premium']) {
    let n = 0;
    for (const m of models) {
      if (n >= 2) break;
      if (m.band === target && !seen.has(m.id + m.channel)) {
        add(m);
        n += 1;
      }
    }
  }

  // 4) 缓存价覆盖：有 cache_read 的两条，没有的两条
  for (const wantCache of [true, false]) {
    let n = 0;
    for (const m of models) {
      if (n >= 2) break;
      const hasCache = m.cache_read != null;
      if (hasCache === wantCache && !seen.has(m.id + m.channel)) {
        add(m);
        n += 1;
      }
    }
  }

  // 5) 补足到上限，按 input 升序取（自然覆盖各价位）
  const rest = models
    .filter((m) => !seen.has(m.id + m.channel))
    .sort((a, b) => (a.input ?? 9e9) - (b.input ?? 9e9));
  for (const m of rest) {
    if (picked.length >= LIMIT.models) break;
    add(m);
  }

  return picked.slice(0, LIMIT.models);
}

/**
 * 按来源与状态挑活动：每个 source × status 至少 1 条，剩余按奖池/报名数补。
 * 这样活动页的筛选器（来源、状态、类型、地区）都有非空结果。
 */
function pickEvents(events) {
  const picked = [];
  const seen = new Set();
  const add = (e) => {
    if (!e || seen.has(e.id)) return;
    seen.add(e.id);
    picked.push(e);
  };

  const sources = [...new Set(events.map((e) => e.source))];
  const statuses = [...new Set(events.map((e) => e.status))];
  for (const s of sources) {
    for (const st of statuses) {
      const hit = events.find((e) => e.source === s && e.status === st);
      if (hit) add(hit);
    }
  }

  // 类型与地区也各覆盖至少一条
  const kinds = [...new Set(events.map((e) => e.kind))];
  for (const k of kinds) {
    const hit = events.find((e) => e.kind === k);
    if (hit) add(hit);
  }
  const regions = [...new Set(events.map((e) => e.region))];
  for (const r of regions) {
    const hit = events.find((e) => e.region === r);
    if (hit) add(hit);
  }

  // 补足：优先奖池大的（页面上信息量最大的那些）
  const rest = events.filter((e) => !seen.has(e.id)).sort((a, b) => (b.regs || 0) - (a.regs || 0));
  for (const e of rest) {
    if (picked.length >= LIMIT.events) break;
    add(e);
  }

  return picked.slice(0, LIMIT.events);
}

/**
 * 评测：按分组各取若干榜，保证「综合 / 文本 / 编程 / Agent / 视觉 / 生成」
 * 六个分组都有内容；每个榜只保留前 20 名，行数就下来了。
 */
function pickBench(bench) {
  const boards = bench.boards || {};
  const catalog = bench.catalog || [];
  const groups = [...new Set(catalog.map((c) => c.group))];

  const keepIds = [];
  for (const g of groups) {
    const inGroup = catalog.filter((c) => c.group === g);
    // 每组取 2 个榜，优先行数多的（覆盖更多模型名）
    const top = inGroup
      .slice()
      .sort((a, b) => (boards[b.id]?.rows?.length || 0) - (boards[a.id]?.rows?.length || 0))
      .slice(0, 2);
    for (const c of top) keepIds.push(c.id);
  }

  const kept = keepIds.slice(0, LIMIT.benchBoards);
  const newBoards = {};
  for (const id of kept) {
    const b = boards[id];
    if (!b) continue;
    newBoards[id] = { ...b, rows: (b.rows || []).slice(0, 20) };
  }

  const rows = Object.values(newBoards).reduce((n, b) => n + (b.rows?.length || 0), 0);
  return {
    ...bench,
    boards: newBoards,
    catalog: catalog.filter((c) => newBoards[c.id]),
    stats: { ...bench.stats, boards: Object.keys(newBoards).length, rows },
  };
}

/**
 * 情报：按月均匀抽样，跨多个月，保证月度分片与时间轴都有内容。
 */
function pickNews(archive) {
  const byMonth = new Map();
  for (const n of archive) {
    const m = String(n.d || '').slice(0, 7) || 'unknown';
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(n);
  }

  const months = [...byMonth.keys()].sort();
  const perMonth = Math.max(1, Math.floor(LIMIT.news / Math.max(months.length, 1)));
  const out = [];
  for (const m of months) {
    out.push(...byMonth.get(m).slice(0, perMonth));
  }
  // 不足时按日期从新到旧补齐
  if (out.length < LIMIT.news) {
    const rest = archive
      .filter((n) => !out.includes(n))
      .sort((a, b) => String(b.d).localeCompare(String(a.d)));
    out.push(...rest.slice(0, LIMIT.news - out.length));
  }

  return out
    .slice(0, LIMIT.news)
    .sort(
      (a, b) => String(b.d).localeCompare(String(a.d)) || String(a.u).localeCompare(String(b.u)),
    );
}

/* ────────────────────────── 主流程 ────────────────────────── */

const data = load('data.json');
const bench = load('bench.json');
const archive = load('news-archive.json');
let milestones = null;
try {
  milestones = load('curated/milestones.json');
} catch {
  milestones = null;
}

const models = pickModels(data.models || []);
const events = pickEvents(data.events || []);
const benchSmall = pickBench(bench);
const newsSmall = pickNews(archive);

// data.json 里的 bench 只放目录，boards 只进 bench.json —— 与 collect.mjs 的瘦身规则一致。
// 以前这里整套 `benchSmall`（含 boards）塞回 data.json，把 F02 的根因盖住了：
// 页面测试看到一个「带 boards 的 data.json」，就永远发现不了线上基线是空的。
const benchCatalogOnly = { ...benchSmall };
delete benchCatalogOnly.boards;
benchCatalogOnly.file = 'bench.json';

const outData = {
  ...data,
  // meta 原样保留：页面用 generated_at / counts / fx / collect 渲染状态与口径
  models,
  events,
  bench: benchCatalogOnly,
  news: {
    // data.json 里的 news 只是索引；裁剪后重算，别留全量索引
    ...(data.news || {}),
    total: newsSmall.length,
  },
  // 其余层全保留：它们本来就小，且页面每个区块都要能渲染
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'data.json'), `${JSON.stringify(outData)}\n`);
writeFileSync(join(OUT, 'bench.json'), `${JSON.stringify(benchSmall)}\n`);
writeFileSync(join(OUT, 'news-archive.json'), `${JSON.stringify(newsSmall)}\n`);
if (milestones) {
  writeFileSync(join(OUT, 'news-milestones.json'), `${JSON.stringify(milestones)}\n`);
}

/** 统计目录体积，超过 R9 上限就明确失败。 */
function dirBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const st = statSync(join(dir, name));
    if (st.isFile()) total += st.size;
  }
  return total;
}

const bytes = dirBytes(OUT);
const mb = (bytes / 1024 / 1024).toFixed(2);
console.log(`[make-fixture-data] 写出 ${OUT}`);
console.log(
  `  models ${models.length} · events ${events.length} · bench ${Object.keys(benchSmall.boards).length} 榜 ${benchSmall.stats.rows} 行 · news ${newsSmall.length}`,
);
console.log(`  bench.json 引用的文件：${benchSmall.file || 'bench.json'}`);

if (bytes > 1024 * 1024) {
  console.error(`[make-fixture-data] 总量 ${mb} MB 超过 1 MB 上限（R9），请收紧 LIMIT`);
  process.exit(1);
}
console.log(`  合计 ${mb} MB（上限 1.00 MB）`);
