/**
 * 状态视图的数据契约（T4.2 · S4.4）。
 *
 * ## 页面要回答的问题
 *
 * 「这几天采集是不是稳的？」
 * 读者看不到 cron 日志，只能看这里：每层最近 30 次的状态、计数趋势、耗时、
 * 请求账目、被限流次数。异常要能一眼看出来，正常也要能证明自己正常。
 *
 * ## 为什么单独一个模块
 *
 * 数据整形（从 ndjson 到视图要的数组）与渲染分开：M5 会把页面拆成 `/status/`，
 * 那时只要换渲染层；整形逻辑与得出来的结论不该跟着搬。
 */

import { readAttempts } from '../scripts/data-scripts.mjs';

/** 视图最多显示最近多少次运行。 */
export const WINDOW = 30;

/**
 * 一层的状态摘要。
 *
 * @param {string} layer
 * @param {{root?: string}} [opt]
 * @returns {{
 *   layer: string,
 *   runs: number,
 *   statuses: string[],
 *   okRate: number,
 *   trend: number[],
 *   msAvg: number|null,
 *   last: object|null,
 *   consecutiveBad: number,
 *   healthy: boolean,
 * }}
 */
export function layerStatus(layer, opt = {}) {
  const all = readAttempts(layer, { root: opt.root });
  // 只留最近 WINDOW 次，但要按时间正序给页面（左旧右新）
  const rows = all.slice(-WINDOW);

  const statuses = rows.map((r) => r.status);
  const okCount = statuses.filter((s) => s === 'ok').length;

  const trend = rows.map((r) => Number(r.count) || 0);
  const msList = rows.map((r) => Number(r.ms) || 0).filter((n) => n > 0);
  const msAvg = msList.length
    ? Math.round(msList.reduce((a, b) => a + b, 0) / msList.length)
    : null;

  /* 连续异常按「最新往前数」算，与告警同一口径——两处口径不一致时，
   * 页面显示「正常」而告警已经开了 issue，那才是最糟的体验。 */
  let consecutiveBad = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const s = rows[i].status;
    if (s === 'ok') break;
    consecutiveBad += 1;
  }

  return {
    layer,
    runs: rows.length,
    statuses,
    okRate: rows.length ? Number((okCount / rows.length).toFixed(3)) : 1,
    trend,
    msAvg,
    last: rows.at(-1) || null,
    consecutiveBad,
    healthy: consecutiveBad === 0,
  };
}

/**
 * 全部层的摘要，异常的排前面。
 *
 * @param {string[]} layers
 * @param {{root?: string}} [opt]
 * @returns {object[]}
 */
export function statusOverview(layers, opt = {}) {
  const list = (layers || []).map((l) => layerStatus(l, opt));
  return list.sort((a, b) => {
    if (a.healthy !== b.healthy) return a.healthy ? 1 : -1;
    return b.consecutiveBad - a.consecutiveBad;
  });
}

/**
 * 把摘要压成一段终端文本（CI job summary 与本地排查都用它）。
 *
 * @param {object[]} overview
 * @returns {string}
 */
export function renderStatusText(overview) {
  const lines = [];
  lines.push('| 层 | 最近 | 连续异常 | 成功率 | 平均耗时 | 最新计数 |');
  lines.push('|---|---:|---:|---:|---:|---:|');

  for (const s of overview) {
    const mark = s.healthy ? '✅' : '⚠️';
    lines.push(
      `| ${mark} ${s.layer} | ${s.runs} | ${s.consecutiveBad} | ${(s.okRate * 100).toFixed(0)}% | ${
        s.msAvg == null ? '—' : `${s.msAvg}ms`
      } | ${s.last?.count ?? '—'} |`,
    );
  }

  return lines.join('\n');
}
