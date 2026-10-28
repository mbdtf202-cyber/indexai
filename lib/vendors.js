/**
 * 厂商归一（T4.4 · S6.1）。
 *
 * ## 为什么需要一张表
 *
 * 同一个厂在不同源里有十种写法：`x-ai` / `xAI` / `grok` / `SpaceXAI` 都是 xAI；
 * `z-ai` / `Z.ai` / `Zhipu` / `GLM` 都是智谱。不归一，页面上会出现
 * 五个「不同的」厂商，各自只有一两个模型，排序完全失真。
 *
 * ## 三个消费者
 *
 * 1. **归一**：各层把 `vendor` 换成 `name`；
 * 2. **排序**：页面按 `rank` 排（数字小的在前），新厂商自动排在末尾；
 * 3. **未匹配报告**：认不出来的进报告，人工补表——不能静默当成「新厂商」，
 *    那会让表越来越脏。
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = join(ROOT, 'registry', 'vendors.json');

/** 表缓存（读一次就够）。 */
let cache = null;

/**
 * 读厂商表。
 *
 * @param {string} [path] 覆盖默认路径（测试用）
 * @returns {{vendors: object[], byKey: Map<string, object>}}
 */
export function loadVendors(path = REGISTRY_PATH) {
  if (cache && path === REGISTRY_PATH) return cache;

  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const vendors = Array.isArray(raw.vendors) ? raw.vendors : [];

  /* 索引键：id、name、以及每一个 alias，全部小写、去掉空格与下划线。
   * 只做「归一化后的精确匹配」，不做模糊匹配——模糊匹配会把
   * 「Mistral」与「Mistral AI」之外的近名（如 Meta / Metamind）混到一起。 */
  const byKey = new Map();
  const key = (s) =>
    String(s || '')
      .toLowerCase()
      // OpenRouter 的变体前缀：~openai 与 openai 是同一家
      .replace(/^~/, '')
      .replace(/[\s_.]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  for (const v of vendors) {
    byKey.set(key(v.id), v);
    byKey.set(key(v.name), v);
    for (const a of v.aliases || []) byKey.set(key(a), v);
  }

  const loaded = { vendors, byKey };
  if (path === REGISTRY_PATH) cache = loaded;
  return loaded;
}

/** 重置缓存（测试用）。 */
export function resetVendorCache() {
  cache = null;
}

/**
 * 把一个厂商名归一到表里的规范名。
 *
 * @param {string} raw 源里的写法
 * @param {{path?: string}} [opt]
 * @returns {{name: string, id: string, rank: number, matched: boolean, raw: string}}
 */
export function normalizeVendor(raw, opt = {}) {
  const { byKey } = loadVendors(opt.path);
  const original = String(raw || '').trim();

  const key = original
    .toLowerCase()
    .replace(/^~/, '')
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const hit = byKey.get(key);
  if (hit) {
    return { name: hit.name, id: hit.id, rank: hit.rank, matched: true, raw: original };
  }

  /* 认不出来：原样返回，标 matched:false。
   * rank 给一个大于所有已知厂商的值，让它排在末尾——
   * 而不是给 0 把它顶到最前面。 */
  return { name: original || 'Unknown', id: null, rank: Number.MAX_SAFE_INTEGER, matched: false, raw: original };
}

/**
 * 排序权重：rank 小的在前。
 *
 * @param {string} name
 * @param {{path?: string}} [opt]
 * @returns {number}
 */
export function vendorRank(name, opt = {}) {
  return normalizeVendor(name, opt).rank;
}

/**
 * 给一组行做厂商归一，返回归一后的行与未匹配清单。
 *
 * @param {object[]} rows
 * @param {{field?: string, path?: string}} [opt]
 * @returns {{rows: object[], unmatched: Array<{raw: string, count: number}>, matched: number}}
 */
export function normalizeRows(rows, opt = {}) {
  const { field = 'vendor', path } = opt;
  const counts = new Map();
  let matched = 0;

  const out = (Array.isArray(rows) ? rows : []).map((row) => {
    const r = normalizeVendor(row[field], { path });
    if (r.matched) matched += 1;
    else if (r.raw) counts.set(r.raw, (counts.get(r.raw) || 0) + 1);

    return { ...row, vendor: r.name, vendorId: r.id ?? row.vendorId };
  });

  const unmatched = [...counts.entries()]
    .map(([raw, count]) => ({ raw, count }))
    .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));

  return { rows: out, unmatched, matched };
}

/**
 * 页面排序用的厂商顺序（替代 `VENDOR_RANK` 常量）。
 *
 * @param {{path?: string}} [opt]
 * @returns {string[]}
 */
export function vendorOrder(opt = {}) {
  const { vendors } = loadVendors(opt.path);
  return [...vendors].sort((a, b) => a.rank - b.rank).map((v) => v.name);
}
