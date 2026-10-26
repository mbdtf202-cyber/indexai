/**
 * 逐行 schema 校验与坏行隔离（T3.5 · S3.2 · F03）。
 *
 * ## 为什么需要这一层
 *
 * F03 的现场：OpenRouter 出现一行 `input=0 && output>0`，语义校验在**整次采集**
 * 层面判定失败，于是全站当天不更新。一行脏数据冻结十几个源，这是最贵的一种脆弱。
 *
 * 现在的分工：
 *   - `lib/schema.js`：零依赖的字段校验（类型 / 必填 / 枚举 / 范围 / 正则）
 *   - `pipeline/schemas/*.js`：每层一份行契约 + 跨字段语义规则
 *   - **本文件**：把两者接起来，逐行过，坏行挑出，算隔离比例
 *
 * 判红条件只有一个：**隔离比例超过该层阈值**（默认 2%）。一两行脏数据是源站常态，
 * 不该变红；超过 2% 说明结构变了或源站在灌垃圾，那时必须响（INV-4）。
 */

import { validateRow, quarantineRatio } from '../lib/schema.js';

/**
 * 校验一层的行。
 *
 * @param {object[]} rows 该层产出（已 dedupe 之后）
 * @param {{schema?: object, rules?: Array<{id: string, check: Function}>, threshold?: number}} spec
 * @returns {{
 *   rows: object[],
 *   quarantined: Array<{row: object, reasons: string[]}>,
 *   total: number,
 *   kept: number,
 *   ratio: number,
 *   overThreshold: boolean,
 *   threshold: number,
 * }}
 */
export function quarantineLayer(rows, spec) {
  const list = Array.isArray(rows) ? rows : [];
  const { schema = null, rules = [], threshold = 0.02 } = spec || {};

  /* 层没声明 schema 就不校验：这不是「静默通过」，而是「这一层还没有行契约」。
   * 有 schema 的层才会在这里被逐行过一遍。 */
  if (!schema) {
    return {
      rows: list,
      quarantined: [],
      total: list.length,
      kept: list.length,
      ratio: 0,
      overThreshold: false,
      threshold,
    };
  }

  const good = [];
  const bad = [];

  for (const row of list) {
    const reasons = [];

    const fieldResult = validateRow(schema, row);
    if (!fieldResult.ok) reasons.push(...fieldResult.errors);

    /* 跨字段语义规则。字段已经不合法的行不再跑语义规则——
     * 否则同一行会被报两次原因，排障时看不出哪个是真问题。 */
    if (!reasons.length) {
      for (const rule of rules) {
        const why = rule.check(row);
        if (why) reasons.push(`${rule.id}: ${why}`);
      }
    }

    if (reasons.length) bad.push({ row, reasons });
    else good.push(row);
  }

  const q = quarantineRatio(list.length, bad.length, threshold);

  return {
    rows: good,
    quarantined: bad,
    total: list.length,
    kept: good.length,
    ratio: q.ratio,
    overThreshold: q.over,
    threshold: q.threshold,
  };
}

/**
 * 把隔离结果压成报告里能用的形状（不含整行数据，只留 id 与原因）。
 *
 * 报告里塞整行会让 run-report.json 膨胀到几 MB，而且绝大多数时候只想知道
 * 「哪几行、为什么」，不关心那行的完整内容。
 *
 * @param {ReturnType<typeof quarantineLayer>} result
 * @returns {object} 可直接进 run-report 的摘要
 */
export function summarizeQuarantine(result) {
  const samples = result.quarantined.slice(0, 5).map((q) => ({
    id: String(q.row?.id ?? q.row?.domain ?? q.row?.product ?? '(无 id)'),
    reasons: q.reasons,
  }));

  return {
    total: result.total,
    kept: result.kept,
    quarantined: result.quarantined.length,
    ratio: Number(result.ratio.toFixed(4)),
    threshold: result.threshold,
    over_threshold: result.overThreshold,
    // 只留前 5 条样例：排障够用，体积可控
    samples,
  };
}
