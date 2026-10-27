/**
 * 未匹配报告与质量线（T4.6 · S6.4 / S6.5）。
 *
 * ## 为什么需要报告
 *
 * 模型表再全也会有认不出来的名字：源站加了新模型、改了写法、用了内部代号。
 * 静默丢弃会让页面上的「—」越来越多，而且**没人知道为什么**。
 *
 * 报告回答三件事：
 *   1. **哪个源**的哪个名字认不出来（不是全局混在一起）；
 *   2. **出现多少次**（次数多的优先补别名，因为影响面大）；
 *   3. **匹配率是否达标**（S6.5 的质量线，不达标就是回归）。
 *
 * ## 质量线（S6.5）
 *
 * | 范围 | 要求 |
 * |---|---|
 * | OpenRouter 用量前 100 | ≥ 95% |
 * | 全部旗舰 | ≥ 95% |
 * | 每个评测榜前 30 名 | ≥ 90% |
 *
 * 这三条是**硬线**：掉下去说明模型表或匹配器退化了，必须当成 bug 修。
 */

import { matchModel } from './match.js';

/** S6.5 的质量线。 */
export const QUALITY_LINE = {
  /** OpenRouter 用量前 N 名。 */
  openrouterTop: 100,
  /** 评测榜前 N 名。 */
  benchTop: 30,
  /** 前两者的最低匹配率。 */
  minRateUsage: 0.95,
  /** 评测榜的最低匹配率。 */
  minRateBench: 0.9,
};

/**
 * 统计一个源里的未匹配名称。
 *
 * @param {string} source 源名（`openrouter` / `official` / `aa` / `lmaera` …）
 * @param {string[]} names 该源里出现的模型名（可重复）
 * @param {{path?: string}} [opt]
 * @returns {{source: string, total: number, matched: number, unmatched: Array<{name: string, count: number}>}}
 */
export function collectUnmatched(source, names, opt = {}) {
  const counts = new Map();
  let matched = 0;
  let total = 0;

  for (const name of names || []) {
    if (!name) continue;
    total += 1;
    const r = matchModel(name, opt);
    if (r.matched) {
      matched += 1;
      continue;
    }
    counts.set(String(name), (counts.get(String(name)) || 0) + 1);
  }

  const unmatched = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { source, total, matched, unmatched };
}

/**
 * 汇总多个源的未匹配报告（写进 `status/unmatched.json`）。
 *
 * @param {Array<{source: string, names: string[]}>} sources
 * @param {{path?: string, at?: string}} [opt]
 * @returns {object}
 */
export function buildUnmatchedReport(sources, opt = {}) {
  const bySource = (sources || []).map((s) => collectUnmatched(s.source, s.names, opt));

  const total = bySource.reduce((n, s) => n + s.total, 0);
  const matched = bySource.reduce((n, s) => n + s.matched, 0);

  return {
    at: opt.at || null,
    total,
    matched,
    rate: total ? Number((matched / total).toFixed(4)) : 1,
    sources: bySource.map((s) => ({
      source: s.source,
      total: s.total,
      matched: s.matched,
      rate: s.total ? Number((s.matched / s.total).toFixed(4)) : 1,
      // 报告里最多列 50 条：够补别名，体积可控
      unmatched: s.unmatched.slice(0, 50),
      unmatched_total: s.unmatched.length,
    })),
  };
}

/**
 * 算一组名字的匹配率。
 *
 * @param {string[]} names
 * @param {{path?: string}} [opt]
 * @returns {{total: number, matched: number, rate: number, missing: string[], excluded: string[]}}
 */
export function matchRate(names, opt = {}) {
  let matched = 0;
  const missing = [];
  const excluded = [];

  for (const name of names || []) {
    if (!name) continue;
    const r = matchModel(name, opt);
    if (r.matched) matched += 1;
    else if (r.via === 'excluded') excluded.push(String(name));
    else missing.push(String(name));
  }

  /* 分母要扣掉占位行：`Multiple` / `Undisclosed` / `Human Baseline` 不是模型，
   * 把它们算进分母，质量线永远差几个百分点，而且补多少别名都补不上。 */
  const total = (names || []).filter(Boolean).length - excluded.length;
  return { total, matched, rate: total > 0 ? matched / total : 1, missing, excluded };
}

/**
 * 检查一条质量线。
 *
 * @param {string} label 说明（`OpenRouter 用量前 100`）
 * @param {string[]} names
 * @param {number} minRate
 * @param {{path?: string}} [opt]
 * @returns {{label: string, total: number, matched: number, rate: number, minRate: number, pass: boolean, missing: string[]}}
 */
export function checkQualityLine(label, names, minRate, opt = {}) {
  const r = matchRate(names, opt);
  return {
    label,
    total: r.total,
    matched: r.matched,
    rate: Number(r.rate.toFixed(4)),
    minRate,
    pass: r.total === 0 || r.rate >= minRate,
    missing: r.missing.slice(0, 20),
  };
}

/**
 * 按 S6.5 检查全部质量线。
 *
 * @param {object} input
 * @param {string[]} input.openrouterTop OpenRouter 用量前 100 的名字
 * @param {string[]} input.flagship 全部旗舰的名字
 * @param {Record<string, string[]>} input.benchBoards 榜 id → 前 30 名名字
 * @param {{path?: string}} [opt]
 * @returns {{lines: object[], pass: boolean}}
 */
export function checkAllQualityLines(input, opt = {}) {
  const lines = [];

  lines.push(
    checkQualityLine(
      `OpenRouter 用量前 ${QUALITY_LINE.openrouterTop}`,
      (input.openrouterTop || []).slice(0, QUALITY_LINE.openrouterTop),
      QUALITY_LINE.minRateUsage,
      opt,
    ),
  );

  lines.push(checkQualityLine('全部旗舰', input.flagship || [], QUALITY_LINE.minRateUsage, opt));

  for (const [boardId, names] of Object.entries(input.benchBoards || {})) {
    lines.push(
      checkQualityLine(
        `评测榜 ${boardId} 前 ${QUALITY_LINE.benchTop}`,
        (names || []).slice(0, QUALITY_LINE.benchTop),
        QUALITY_LINE.minRateBench,
        opt,
      ),
    );
  }

  return { lines, pass: lines.every((l) => l.pass) };
}
