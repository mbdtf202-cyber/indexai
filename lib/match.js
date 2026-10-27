/**
 * 模型实体匹配（T4.5 · S6.2 / S6.3 · F24）。
 *
 * ## F24 是什么
 *
 * 散点图与中转站旗舰曾经用**前缀匹配**找对应的模型：
 * `pool.find((m) => bnorm(m.name).startsWith(key))`。后果：
 * `Claude Sonnet 5` 会匹配到 `Claude Sonnet 5.5`，`GPT-6` 会匹配到 `GPT-6.1 Sol`。
 * 图上那个点看着像对的，其实是另一个模型的数据。
 *
 * S6.3 因此明确禁止前缀与模糊匹配。只允许三级：
 *
 * | 优先级 | 规则 |
 * |---|---|
 * | 1 | **精确别名**（各源登记的写法，见 `registry/models.json` 的 `aliases`） |
 * | 2 | **归一后精确相等**（小写、去厂商前缀、统一分隔符） |
 * | 3 | 都不中 → **未匹配**（进报告，不猜） |
 *
 * ## 推理档位
 *
 * `claude-opus-5.5-thinking` 不是新模型，是 `claude-opus-5.5` 的一个 `variant`。
 * 挂到父模型下，而不是当成独立实体——否则「有多少模型」这个数字会被档位灌水。
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_PATH = join(ROOT, 'registry', 'models.json');

/**
 * 推理档位的标记。
 *
 * 只认「明确表示推理档」的词。不收 max / high / low / medium 这类
 * 也可能是模型名一部分的词——qwen3.8-max 是模型不是档位；
 * mistral-medium-3-5 的 medium 也是名字。误判会把两个不同的模型
 * 合成一个，那是比未匹配更糟的错误（S6.3 的同一原则：不猜）。
 */
export const VARIANT_MARKERS = ['thinking', 'reasoning', 'reasoner', 'nothink', 'non-thinking'];
/**
 * 归一一个模型名。
 *
 * 三步：小写 → 去掉厂商前缀（`anthropic/`）→ 统一分隔符（`_` `.` → `-`）。
 * **不做**任何截断或前缀裁剪——那正是 F24 的错。
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeModelName(name) {
  return String(name || '')
    .toLowerCase()
    // 厂商前缀：anthropic/claude-... → claude-...
    .replace(/^[^/]+\//, '')
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 判断一个名字是不是父模型的变体，返回父模型名。
 *
 * @param {string} name
 * @returns {{parent: string, variant: string}|null}
 */
export function splitVariant(name) {
  const norm = normalizeModelName(name);
  const parts = norm.split('-');

  /* 只切「最后一段是档位标记」的名字：claude-opus-5.5-thinking。
   * 中间出现标记的一律不动——thinking-machines/model 是厂商名。 */
  const last = parts[parts.length - 1];
  if (parts.length > 1 && VARIANT_MARKERS.includes(last)) {
    return { parent: parts.slice(0, -1).join('-'), variant: last };
  }

  return null;
}

/* ────────────────────────── 匹配器 ────────────────────────── */

/** 表缓存。 */
let cache = null;

/**
 * 读模型表。
 *
 * @param {string} [path]
 * @returns {{models: object[], byAlias: Map<string, object>, byNorm: Map<string, object>}}
 */
export function loadModels(path = MODELS_PATH) {
  if (cache && path === MODELS_PATH) return cache;

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    raw = { models: [] };
  }
  const models = Array.isArray(raw.models) ? raw.models : [];

  const byAlias = new Map();
  const byNorm = new Map();

  for (const m of models) {
    // 规范 id 与显示名都能当别名
    byAlias.set(String(m.id || '').toLowerCase(), m);
    byNorm.set(normalizeModelName(m.id), m);

    if (m.name) {
      byAlias.set(String(m.name).toLowerCase(), m);
      byNorm.set(normalizeModelName(m.name), m);
    }

    for (const group of Object.values(m.aliases || {})) {
      for (const alias of Array.isArray(group) ? group : [group]) {
        if (!alias) continue;
        const key = String(alias).toLowerCase();
        if (!byAlias.has(key)) byAlias.set(key, m);
        const nk = normalizeModelName(alias);
        if (!byNorm.has(nk)) byNorm.set(nk, m);
      }
    }
  }

  const loaded = { models, byAlias, byNorm };
  if (path === MODELS_PATH) cache = loaded;
  return loaded;
}

/** 重置缓存（测试用）。 */
export function resetModelCache() {
  cache = null;
}

/**
 * 匹配一个源里的模型名到实体。
 *
 * @param {string} raw 源里的写法
 * @param {{path?: string}} [opt]
 * @returns {{
 *   id: string|null,
 *   name: string|null,
 *   matched: boolean,
 *   via: 'alias'|'normalized'|'none',
 *   variant: string|null,
 *   raw: string,
 * }}
 */
export function matchModel(raw, opt = {}) {
  const original = String(raw || '').trim();
  const { byAlias, byNorm } = loadModels(opt.path);

  // 1. 精确别名
  const hit = byAlias.get(original.toLowerCase());
  if (hit) {
    return { id: hit.id, name: hit.name, matched: true, via: 'alias', variant: null, raw: original };
  }

  // 2. 归一后精确相等
  const norm = normalizeModelName(original);
  const normHit = byNorm.get(norm);
  if (normHit) {
    return { id: normHit.id, name: normHit.name, matched: true, via: 'normalized', variant: null, raw: original };
  }

  /* 3. 变体：切掉推理档位后再试一次。仍然只做精确比较——
   * `claude-opus-5.5-thinking` 去掉 `thinking` 后必须**完整等于** `claude-opus-5.5`。 */
  const v = splitVariant(original);
  if (v) {
    const parentHit = byNorm.get(v.parent) || byAlias.get(v.parent);
    if (parentHit) {
      return {
        id: parentHit.id,
        name: parentHit.name,
        matched: true,
        via: 'normalized',
        variant: v.variant,
        raw: original,
      };
    }
  }

  // 4. 未匹配：不猜
  return { id: null, name: null, matched: false, via: 'none', variant: null, raw: original };
}

/**
 * 批量匹配，返回命中行与未匹配清单。
 *
 * @param {string[]} names
 * @param {{path?: string}} [opt]
 * @returns {{matched: object[], unmatched: string[], byId: Map<string, object[]>}}
 */
export function matchMany(names, opt = {}) {
  const matched = [];
  const unmatched = [];
  const byId = new Map();

  for (const name of names || []) {
    const r = matchModel(name, opt);
    if (!r.matched) {
      unmatched.push(r.raw);
      continue;
    }
    matched.push(r);
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }

  return { matched, unmatched, byId };
}

/**
 * 页面的实体查找（替代 `modelFor` 的前缀匹配）。
 *
 * @param {string} name
 * @param {object[]} pool 候选行（每行有 id / name）
 * @param {{path?: string}} [opt]
 * @returns {object|null}
 */
export function modelForEntity(name, pool, opt = {}) {
  const r = matchModel(name, opt);
  if (!r.matched) return null;
  return (pool || []).find((m) => m.id === r.id) ?? null;
}
