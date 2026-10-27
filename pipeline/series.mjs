/**
 * 价格序列（T4.8 · S5.3）。
 *
 * ## 为什么只存变化点
 *
 * 一个模型 30 天里可能只变过 2 次价。每天存一行是 30 行，其中 28 行完全一样——
 * 仓库臃肿、diff 全是噪声、页面画线时还要自己压缩。
 *
 * 只存变化点：`[{date, input, output, cacheRead, cacheWrite}]`。
 * 画线时按「上一个已知值延续」还原，视觉上完全等价，体积小一到两个数量级。
 *
 * ## 三类序列
 *
 * | 类型 | 路径 | 值 |
 * |---|---|---|
 * | 模型 | `series/models/<id>.json` | 输入/输出/缓存读/缓存写 |
 * | 中转站 | `series/relays/<domain>.json` | 各旗舰模型的输入价 |
 * | 订阅 | `series/subs/<plan>.json` | 区价 |
 */

import { createHash } from 'node:crypto';

/**
 * 比较两条记录的价格是否相同（相对误差 0.1%）。
 *
 * @param {object} a
 * @param {object} b
 * @param {string[]} fields
 * @returns {boolean}
 */
export function samePrice(a, b, fields) {
  for (const f of fields) {
    const x = a?.[f];
    const y = b?.[f];
    if (x === y) continue;
    if (x == null || y == null) return false;
    const delta = Math.abs(y - x);
    if (delta / Math.max(Math.abs(x), 1e-9) >= 0.001) return false;
  }
  return true;
}

/**
 * 给一条序列追加一个数据点，只在**有变化**时才追加。
 *
 * @param {object[]} series 已有序列（旧→新）
 * @param {object} point 本次的值（含 date）
 * @param {string[]} fields 要比较的字段
 * @returns {object[]} 新的序列（不修改入参）
 */
export function appendPoint(series, point, fields) {
  const list = Array.isArray(series) ? series : [];
  const last = list[list.length - 1];

  /* 第一条永远记：它是序列的起点，没有它画不出线。 */
  if (!last) return [{ date: point.date, ...pick(point, fields) }];

  /* 同一天重复采集：替换而不是追加，否则一天会有多个点。 */
  if (last.date === point.date) {
    if (samePrice(last, point, fields)) return list;
    return [...list.slice(0, -1), { date: point.date, ...pick(point, fields) }];
  }

  // 价格没变：不记
  if (samePrice(last, point, fields)) return list;

  return [...list, { date: point.date, ...pick(point, fields) }];
}

/** 只取指定字段，值缺失时写 null（不留 undefined，JSON 里会消失）。 */
function pick(obj, fields) {
  const out = {};
  for (const f of fields) out[f] = obj?.[f] ?? null;
  return out;
}

/**
 * 从多日快照派生一个实体的序列。
 *
 * @param {Array<{date: string, row: object|null}>} days 按日期正序的快照
 * @param {string[]} fields
 * @returns {object[]}
 */
export function buildSeries(days, fields) {
  let series = [];
  for (const day of days || []) {
    if (!day?.row) continue; // 那天没有这个实体：跳过，不记 null 点
    series = appendPoint(series, { date: day.date, ...day.row }, fields);
  }
  return series;
}

/**
 * 把序列还原成「每天一个点」的稠密形式（画线用）。
 *
 * @param {object[]} series
 * @param {string[]} dates 需要覆盖的日期（正序）
 * @param {string[]} fields
 * @returns {object[]}
 */
export function densify(series, dates, fields) {
  const out = [];
  let cursor = 0;
  let last = null;

  for (const date of dates || []) {
    while (cursor < (series || []).length && series[cursor].date <= date) {
      last = series[cursor];
      cursor += 1;
    }
    out.push(last ? { date, ...pick(last, fields) } : { date, ...pick({}, fields) });
  }
  return out;
}

/* ────────────────────────── 三类序列的字段 ────────────────────────── */

/** 模型序列比较的字段。 */
export const MODEL_SERIES_FIELDS = ['input', 'output', 'cache_read', 'cache_write'];

/** 中转站序列比较的字段（存每个旗舰的输入价）。 */
export const RELAY_SERIES_FIELDS = ['input'];

/** 订阅序列比较的字段。 */
export const SUB_SERIES_FIELDS = ['price'];

/**
 * 从一天的快照里提取某一层的「可比较值」映射。
 *
 * @param {object[]} rows
 * @param {(row: object) => string|null} keyOf
 * @returns {Map<string, object>}
 */
export function indexBy(rows, keyOf) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const k = keyOf(row);
    if (k) map.set(k, row);
  }
  return map;
}

/**
 * 模型 id 到文件名（id 里有 `/`，不能直接当路径）。
 *
 * @param {string} id
 * @returns {string} 安全的文件名（不含 /）
 */
export function seriesFileName(id) {
  const raw = String(id || '');
  // vendor/model → vendor__model：可逆、可读、无路径分隔符
  const safe = raw.replace(/\//g, '__').replace(/[^a-zA-Z0-9._:-]/g, '-');
  return safe || createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

/**
 * 生成序列文件的内容（带 schema 与元信息）。
 *
 * @param {object} opt
 * @param {string} opt.key 实体标识（模型 id / 域名 / 套餐名）
 * @param {object[]} opt.points 变化点
 * @param {string[]} opt.fields
 * @param {string} opt.kind 'models'|'relays'|'subs'
 * @returns {object}
 */
export function seriesDoc(opt) {
  return {
    schema: 'series/v1',
    key: opt.key,
    kind: opt.kind,
    fields: opt.fields,
    // 只有变化点：画线时按「上一个已知值延续」还原
    points: opt.points || [],
    changes: Math.max(0, (opt.points || []).length - 1),
  };
}
