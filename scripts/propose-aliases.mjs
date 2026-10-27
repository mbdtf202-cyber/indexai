#!/usr/bin/env node
/**
 * 从数据里提「可能的别名」（T4.6 · S6.4）。
 *
 * ## 这是提议不是决定
 *
 * S6.4 说得很清楚：LLM 可以离线提议别名，**经审阅后提交**，运行时不调 LLM。
 * 这个脚本做的是机械的那部分——把「归一后相等」的名字对列出来，让人过一眼。
 *
 * ## 只提议「归一后完全相等」的对
 *
 * 不做任何模糊或前缀匹配。`Claude 4.5 Opus` 与 `anthropic/claude-opus-4-5`
 * 归一后都是 `claude-opus-4-5`，这是可以提议的；
 * `Claude 4.6 Opus` 与 `claude-opus-4-5` 归一后不等，不提议（那是两个模型）。
 *
 * 用法：`node scripts/propose-aliases.mjs [--write]`
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeModelName, loadModels, resetModelCache } from '../lib/match.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');

const readJson = (rel) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  } catch {
    return null;
  }
};

/* 占位符不算模型名，永远不提议。 */
const PLACEHOLDERS = new Set(['Multiple', 'Undisclosed', 'N/A', '-', 'Unknown', 'Various', '']);

/* 1. 收集每个源的原始名字。 */
const bySource = new Map();
const add = (src, name) => {
  if (!name || PLACEHOLDERS.has(name)) return;
  if (!bySource.has(src)) bySource.set(src, new Set());
  bySource.get(src).add(String(name));
};

const golden = readJson('fixtures/golden/data.json') || readJson('data.json');
for (const m of golden?.models || []) {
  add(m.channelKind === 'aggregator' ? 'openrouter' : 'official', m.id);
  add(m.channelKind === 'aggregator' ? 'openrouter' : 'official', m.name);
}

const official = readJson('curated/official-prices.json');
for (const r of official?.items || official || []) {
  add('official', r.model);
  if (r.name) add('official', r.name);
}

const bench = readJson('fixtures/golden/bench.json');
for (const board of Object.values(bench?.boards || {})) {
  for (const row of board.rows || []) add('bench', row.model);
}

/* 2. 按归一 key 分组，找出「表里已有实体 + 未登记的写法」。 */
resetModelCache();
const { models, byNorm } = loadModels();

const proposals = [];

for (const [source, names] of bySource) {
  for (const name of names) {
    const key = normalizeModelName(name);
    if (!key) continue;

    const hit = byNorm.get(key);
    if (!hit) continue; // 归一后对不上任何实体：这不是别名问题，是新模型

    // 已经是登记过的别名就不提议
    const registered = new Set();
    for (const g of Object.values(hit.aliases || {})) {
      for (const a of Array.isArray(g) ? g : [g]) registered.add(String(a).toLowerCase());
    }
    if (registered.has(name.toLowerCase())) continue;
    if (hit.id.toLowerCase() === name.toLowerCase()) continue;
    if (String(hit.name).toLowerCase() === name.toLowerCase()) continue;

    proposals.push({ source, alias: name, id: hit.id, key });
  }
}

/* 3. 按实体分组输出，方便一条条看。 */
const grouped = new Map();
for (const p of proposals) {
  if (!grouped.has(p.id)) grouped.set(p.id, []);
  grouped.get(p.id).push(p);
}

console.log(`[alias] ${proposals.length} 条提议，涉及 ${grouped.size} 个实体`);
for (const [id, list] of [...grouped.entries()].slice(0, 15)) {
  console.log(`  ${id}`);
  for (const p of list) console.log(`    + ${p.source}: ${p.alias}`);
}
if (grouped.size > 15) console.log(`  … 还有 ${grouped.size - 15} 个实体`);

if (write && proposals.length) {
  const reg = readJson('registry/models.json');
  const byId = new Map(reg.models.map((m) => [m.id, m]));

  for (const p of proposals) {
    const m = byId.get(p.id);
    if (!m) continue;
    m.aliases = m.aliases || {};
    m.aliases[p.source] = m.aliases[p.source] || [];
    if (!m.aliases[p.source].includes(p.alias)) m.aliases[p.source].push(p.alias);
  }

  for (const m of reg.models) {
    for (const k of Object.keys(m.aliases || {})) {
      m.aliases[k].sort();
    }
  }

  writeFileSync(join(ROOT, 'registry', 'models.json'), `${JSON.stringify(reg, null, 2)}\n`);
  console.log('[alias] 已写入 registry/models.json');
} else if (!write) {
  console.log('[alias] 预览模式：加 --write 才会落盘');
}
