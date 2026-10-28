/**
 * 零依赖的 schema 校验（T3.5 · S3.2）。
 *
 * 为什么自己写而不引入 zod / ajv：INV-6 要求运行时零依赖，而这一层只需要
 * 四种能力——类型、必填、枚举、数值范围——再加 URL 与 ISO 日期两条正则。
 * 为这点需求引一个验证库，会让每日无人值守任务的供应链面白白变大。
 *
 * ## 用法
 *
 * ```js
 * const ROW = {
 *   id: { type: 'string', required: true },
 *   input: { type: 'number', min: 0 },
 *   channelKind: { type: 'enum', values: ['direct', 'aggregator'] },
 * };
 * const { ok, errors } = validateRow(ROW, row);
 * ```
 *
 * ## 与「坏行隔离」的关系
 *
 * 校验失败不是让整层失败（那正是 F03 的病：一行坏数据冻结全站），
 * 而是把这一行放进 `quarantined` 并附原因。层只有在**隔离比例超过阈值**时
 * 才判红——那时说明源站结构变了，不是个别脏数据。
 */

/** 允许的字段类型。`any` 表示不做类型检查（只查必填）。 */
const TYPES = new Set(['string', 'number', 'boolean', 'object', 'array', 'enum', 'any']);

/**
 * 校验单行。
 *
 * @param {Record<string, object>} spec 字段名 → 规则
 * @param {object} row 待校验的数据行
 * @returns {{ok: boolean, errors: string[]}} 失败时 errors 写明"字段: 原因"
 */
export function validateRow(spec, row) {
  const errors = [];

  if (row == null || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, errors: ['不是一个对象'] };
  }

  for (const [field, rule] of Object.entries(spec || {})) {
    const value = row[field];
    const { type, required, values, min, max, pattern, integer } = rule || {};

    if (value === undefined || value === null || value === '') {
      if (required) errors.push(`${field}: 必填但缺失`);
      continue;
    }

    if (type === 'enum') {
      /* enum 是独立类型：它的「类型检查」就是「值在不在列表里」。
       * 之前把 enum 写成 values 的附属属性，于是所有枚举字段都被判成非法类型——
       * 实测把 events/models 全量隔离（2026-10-27）。 */
      if (!Array.isArray(values) || !values.length) {
        errors.push(`${field}: enum 类型必须给 values`);
        continue;
      }
      if (!values.includes(value)) {
        errors.push(`${field}: 不在枚举内（${value}）`);
      }
      continue;
    }

    if (type && type !== 'any') {
      if (!TYPES.has(type)) {
        errors.push(`${field}: spec 里的 type 非法（${type}）`);
        continue;
      }
      const actual = Array.isArray(value) ? 'array' : typeof value;
      if (actual !== type) {
        errors.push(`${field}: 应为 ${type}，实际 ${actual}`);
        continue;
      }
    }

    if (type === 'number') {
      if (!Number.isFinite(value)) {
        errors.push(`${field}: 不是有限数值`);
        continue;
      }
      if (integer && !Number.isInteger(value)) errors.push(`${field}: 应为整数`);
      if (min != null && value < min) errors.push(`${field}: ${value} < 下限 ${min}`);
      if (max != null && value > max) errors.push(`${field}: ${value} > 上限 ${max}`);
    }

    if (pattern && typeof value === 'string' && !pattern.test(value)) {
      errors.push(`${field}: 不匹配 ${pattern}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 批量校验，把坏行挑出来。
 *
 * @param {Record<string, object>} spec
 * @param {object[]} rows
 * @returns {{good: object[], bad: Array<{row: object, errors: string[]}>}}
 */
export function partitionRows(spec, rows) {
  const good = [];
  const bad = [];
  for (const row of rows || []) {
    const r = validateRow(spec, row);
    if (r.ok) good.push(row);
    else bad.push({ row, errors: r.errors });
  }
  return { good, bad };
}

/**
 * 隔离比例是否超过阈值。
 *
 * 默认 2%：一两行脏数据是源站常态，不该让整层变红；
 * 但超过 2% 说明结构变了（或源站在灌垃圾），这时必须响（INV-4）。
 *
 * @param {number} total 本层总行数
 * @param {number} quarantined 被隔离的行数
 * @param {number} [threshold] 阈值比例，默认 0.02
 * @returns {{ratio: number, over: boolean, threshold: number}}
 */
export function quarantineRatio(total, quarantined, threshold = 0.02) {
  if (!total || total <= 0) return { ratio: 0, over: false, threshold };
  const ratio = quarantined / total;
  return { ratio, over: ratio > threshold, threshold };
}

/* ────────────────────────── 通用规则片段 ────────────────────────── */

/** 只放行 http(s) 绝对地址。与 lib/url.js 的 safeUrl 同口径，但这里是声明式的。 */
export const HTTP_URL = /^https?:\/\/[^\s]+$/i;

/** `YYYY-MM-DD`。 */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 完整 ISO 8601（带时分秒）。 */
export const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 数值范围规则：`n >= 0`（价格不能为负）。
 * 单独导出是因为「非负」在价格与条数上出现太多次，写在一处不会各处抄错。
 */
export const NON_NEGATIVE = { type: 'number', min: 0 };
