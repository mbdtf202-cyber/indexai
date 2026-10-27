#!/usr/bin/env node
/**
 * 生成 `registry/models.json` 初稿（T4.5 · S6.2）。
 *
 * ## 从哪来
 *
 * - **OpenRouter 目录**：`vendor/model-id` 的规范写法；
 * - **官方价**（`curated/official-prices.json`）：人工核过的 model 名；
 * - **评测各源**：榜单里的模型名（AA / LMArena 的写法）；
 * - **中转站旗舰**：`FLAGSHIP` 里的 key 与正则匹配到的名字。
 *
 * ## 别名只收精确写法（S6.3）
 *
 * 不生成「看起来像」的别名。`claude-sonnet-5` 与 `claude-sonnet-5.5` 是
 * 两个模型，机器不该替人决定它们是不是同一个。人工核对后再提交（D6）。
 *
 * 用法：`node scripts/gen-models-registry.mjs [--write]`
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeModelName, splitVariant } from '../lib/match.js';
import { normalizeVendor } from '../lib/vendors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');

const readJson = (rel) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  } catch {
    return null;
  }
};

/* 1. 收集来源。 */
const sources = [];

// OpenRouter 目录（data.json 里的聚合行保留原始 id）
/* 优先用 golden：fixture 被裁到 80 行，聚合行几乎没了，生成不出有用的初稿。 */
const data =
  readJson('fixtures/golden/data.json') ||
  readJson('fixtures/data/data.json') ||
  readJson('data.json');
const orRows = (data?.models || []).filter((m) => m.channelKind === 'aggregator');
sources.push({
  kind: 'openrouter',
  rows: orRows.map((m) => ({ key: m.id, vendor: m.vendor, name: m.name })),
});

// 官方价
const official = readJson('curated/official-prices.json');
const officialRows = (official?.items || official || []).map((r) => ({
  key: r.model,
  vendor: r.vendor,
  name: r.name || r.model,
}));
sources.push({ kind: 'official', rows: officialRows });

/* 2. 按规范 id 归组。 */
const registry = new Map();

const addAlias = (entry, kind, alias) => {
  if (!alias) return;
  entry.aliases[kind] = entry.aliases[kind] || [];
  if (!entry.aliases[kind].includes(alias)) entry.aliases[kind].push(alias);
};

for (const src of sources) {
  for (const row of src.rows) {
    if (!row.key) continue;

    const v = normalizeVendor(row.vendor);
    const bare = normalizeModelName(row.key);
    /* 变体行不建独立实体（S6.2）：留给第二遍挂到父模型下。
     * 两者都建会导致「kimi-k2」与「kimi-k2-thinking」各算一个模型，
     * 「有多少模型」这个数字被档位灌水。 */
    if (splitVariant(row.key)) continue;

    const id = `${v.id || 'unknown'}/${bare}`;

    if (!registry.has(id)) {
      registry.set(id, {
        id,
        name: row.name || row.key,
        vendor: v.name,
        aliases: {},
        variants: [],
      });
    }
    const entry = registry.get(id);
    addAlias(entry, src.kind, row.key);
    if (row.name && row.name !== entry.name) addAlias(entry, src.kind, row.name);
  }
}

/* 第二遍：把变体挂到父模型下（S6.2）。必须等所有实体建完——
 * 第一遍边建边挂时父模型可能还没进表，has() 永远为 false。 */
const variantRows = [];
for (const src of sources) {
  for (const row of src.rows) {
    if (!row.key) continue;
    const v = normalizeVendor(row.vendor);
    const variant = splitVariant(row.key);
    if (!variant) continue;
    variantRows.push({ src, row, v, variant, parentId: `${v.id || 'unknown'}/${variant.parent}` });
  }
}

for (const { src, row, variant, parentId } of variantRows) {
  const parent = registry.get(parentId);
  if (!parent) continue; // 父模型不在表里就不挂：宁可留一个独立实体，也不凭空造父
  parent.variants = parent.variants || [];
  if (!parent.variants.includes(variant.variant)) parent.variants.push(variant.variant);
  addAlias(parent, src.kind, row.key);
}

const models = [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
for (const m of models) if (!m.variants.length) delete m.variants;

const out = {
  schema: 'registry.models/v1',
  note: '模型实体表（T4.5 · S6.2）。规范 id 形如 vendor/model。别名只收精确写法（S6.3 禁止前缀与模糊匹配）；推理档位挂在父模型的 variants 下。初稿由 scripts/gen-models-registry.mjs 生成，人工核对后提交（D6）。',
  models,
};

console.log(
  `[models] ${models.length} 个实体，来自 ${sources.map((s) => `${s.kind}(${s.rows.length})`).join(' ')}`,
);
const withVariants = models.filter((m) => m.variants?.length).length;
console.log(`[models] 其中 ${withVariants} 个带推理档位`);

if (write) {
  writeFileSync(join(ROOT, 'registry', 'models.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('[models] 已写入 registry/models.json');
} else {
  console.log('[models] 预览模式：加 --write 才会落盘');
}
