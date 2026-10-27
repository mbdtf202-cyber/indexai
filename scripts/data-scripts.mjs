/**
 * data 分支的读写（T4.1 · D1 · S5.1）。
 *
 * ## 布局
 *
 * ```
 * snapshots/<layer>.json      每层的最新快照（稳定排序，一行一条记录）
 * status/<layer>.ndjson       每次尝试一行（成功或失败都记）
 * news/<YYYY-MM>.json         情报按月分片（只增不删）
 * series/<layer>.ndjson       价格/计数序列，给趋势图用
 * changes/<date>.json         变化事件（T4.3 产出）
 * ```
 *
 * `snapshots/` 存的是「最新的完整状态」，`status/` 存的是「每次尝试的历史」。
 * 两者分开是因为用途完全不同：构建只读前者，告警与状态页只读后者。
 *
 * ## 为什么这里会有 `require` / `new Date()`
 *
 * 上一版这三个函数是坏的：在 ESM 里调 `require`（直接 ReferenceError）、
 * `appendFileSync` 前不建目录（首次运行必崩）、时间用 `new Date()`（违反 R2b，
 * 回放测试下输出不确定）。这里全部修掉。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { nowISO } from '../lib/clock.js';

/** data 分支检出目录的默认位置（已被 .gitignore 忽略）。 */
export const DATA_ROOT = process.env.INDEXAI_DATA_DIR || '.data';

/**
 * 解析数据根目录（绝对路径）。
 *
 * @param {string} [root] 覆盖默认值
 * @returns {string}
 */
export function dataRoot(root) {
  return resolve(root || DATA_ROOT);
}

/** 确保子目录存在并返回它的路径。 */
function ensure(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/* ────────────────────────── 快照 ────────────────────────── */

/**
 * 写一层的快照。
 *
 * 「稳定排序」的意思是：同一个输入永远产出同一个字节序列。
 * 记录按 `id` 排序（没有 id 就按 domain / product / 完整 JSON 字符串），
 * 这样两次采集若数据相同，git 上看不到 diff。
 *
 * @param {string} layer
 * @param {object[]|object} data
 * @param {{root?: string}} [opt]
 * @returns {string} 写入的路径
 */
export function snapshotLayer(layer, data, opt = {}) {
  const dir = ensure(join(dataRoot(opt.root), 'snapshots'));
  const path = join(dir, `${layer}.json`);

  const rows = Array.isArray(data) ? [...data] : data;
  if (Array.isArray(rows)) {
    const keyOf = (r) =>
      String(r?.id ?? r?.domain ?? r?.product ?? r?.repo ?? r?.u ?? JSON.stringify(r));
    rows.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  }

  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * 读一层的快照。没有就返回 null（不抛错——首次运行是正常情况）。
 *
 * @param {string} layer
 * @param {{root?: string}} [opt]
 * @returns {object[]|object|null}
 */
export function loadSnapshot(layer, opt = {}) {
  const path = join(dataRoot(opt.root), 'snapshots', `${layer}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/* ────────────────────────── 状态日志 ────────────────────────── */

/**
 * 追加一次尝试到 `status/<layer>.ndjson`。
 *
 * 一行一次尝试，只追加不修改——告警要读「连续两次 red」，
 * 改写历史会让这个判断失去依据。
 *
 * @param {string} layer
 * @param {{status: string, count?: number, ms?: number, error?: string, reason?: string}} attempt
 * @param {{root?: string, at?: string}} [opt]
 * @returns {string} 写入的路径
 */
export function recordAttempt(layer, attempt, opt = {}) {
  const dir = ensure(join(dataRoot(opt.root), 'status'));
  const path = join(dir, `${layer}.ndjson`);

  const line = {
    // 时间走 clock（R2b）：回放模式下是固定值，golden 才能逐字节比较
    at: opt.at || nowISO(),
    layer,
    status: attempt.status,
    count: attempt.count ?? 0,
    ms: attempt.ms ?? 0,
    ...(attempt.error ? { error: attempt.error } : {}),
    ...(attempt.reason ? { reason: attempt.reason } : {}),
  };

  appendFileSync(path, `${JSON.stringify(line)}\n`, 'utf8');
  return path;
}

/**
 * 读一层的尝试日志（按时间正序）。
 *
 * @param {string} layer
 * @param {{root?: string, limit?: number}} [opt] limit 取最近 N 条
 * @returns {object[]}
 */
export function readAttempts(layer, opt = {}) {
  const path = join(dataRoot(opt.root), 'status', `${layer}.ndjson`);
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const rows = text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (opt.limit && rows.length > opt.limit) return rows.slice(-opt.limit);
  return rows;
}

/* ────────────────────────── 情报按月分片 ────────────────────────── */

/**
 * 把归档条目按月分组，写进 `news/<YYYY-MM>.json`。
 *
 * 归档只增不删，所以这里做的是**合并**：已有的月份并进来，不覆盖。
 * 同一条目按 URL（短键 `u`）去重，新值覆盖旧值。
 *
 * @param {object[]} archive 完整的归档条目
 * @param {{root?: string}} [opt]
 * @returns {{months: string[], total: number}}
 */
export function writeNewsShards(archive, opt = {}) {
  const dir = ensure(join(dataRoot(opt.root), 'news'));
  const byMonth = new Map();

  for (const item of archive || []) {
    const d = String(item?.d ?? item?.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}/.test(d)) continue;
    const month = d.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const key = item.u || item.url || JSON.stringify(item);
    byMonth.get(month).set(key, item);
  }

  const months = [];
  let total = 0;

  for (const [month, items] of [...byMonth.entries()].sort()) {
    const path = join(dir, `${month}.json`);

    // 先读旧的（可能是上次运行写的），按 key 合并
    let existing = new Map();
    try {
      const old = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(old))
        existing = new Map(old.map((r) => [r.u || r.url || JSON.stringify(r), r]));
    } catch {
      // 没有旧文件就是首次写这个月
    }

    for (const [k, v] of items) existing.set(k, { ...existing.get(k), ...v });

    const merged = [...existing.values()].sort((a, b) =>
      String(`${a.d}${a.tm || ''}`).localeCompare(String(`${b.d}${b.tm || ''}`)),
    );
    writeFileSync(path, `${JSON.stringify(merged, null, 0)}\n`, 'utf8');
    months.push(month);
    total += merged.length;
  }

  return { months, total };
}

/**
 * 读回全部月度分片，合成一个归档数组。
 *
 * @param {{root?: string}} [opt]
 * @returns {object[]}
 */
export function readNewsShards(opt = {}) {
  const dir = join(dataRoot(opt.root), 'news');
  if (!existsSync(dir)) return [];

  const out = [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  for (const name of [...names].sort()) {
    if (!/^\d{4}-\d{2}\.json$/.test(name)) continue;
    try {
      const rows = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (Array.isArray(rows)) out.push(...rows);
    } catch {
      // 单个分片坏了不该拖垮整个归档
    }
  }
  return out;
}
