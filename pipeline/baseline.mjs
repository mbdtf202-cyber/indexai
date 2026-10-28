/**
 * 历史基线（T4.7 · S4.1 · F33）。
 *
 * ## 为什么不能只看上一版
 *
 * 缩水判定原来是「本次 vs 上一版」。问题：**上一版本身可能是异常低值**。
 * 某天源站只回了 6 条，下一版正常回 460 条——但假如反过来，
 * 某天回到 100 条，拿它当基线就把「正常」判成「缩水」。
 *
 * 正确做法：拿**近 7 次成功快照的中位数**当基线。中位数对单日异常不敏感：
 * 7 次里有 1 次低值，中位数仍是正常水平。
 *
 * ## 历史不够时怎么办
 *
 * 不足 3 次就给不出可信的中位数，退回「只看绝对下限」。
 * **不**用 `min` 或 `mean` 凑：`min` 会被单次异常拉低、`mean` 会被它拉高，
 * 两个都不稳。宁可这一轮只查下限，也不给一个假基线。
 */

/** 算基线至少要几次成功快照。中位数在 3 个点以上才有意义。 */
export const BASELINE_MIN_SAMPLES = 3;

/** 回看多少次。S4.1 规定 7 次。 */
export const BASELINE_WINDOW = 7;

/**
 * 从历史计数里算基线。
 *
 * @param {number[]} counts 历次成功快照的条数（任意顺序）
 * @param {{window?: number, minSamples?: number}} [opt]
 * @returns {{
 *   baseline: number|null,
 *   samples: number,
 *   source: 'median'|'insufficient',
 *   used: number[],
 * }}
 */
export function computeBaseline(counts, opt = {}) {
  const window = opt.window ?? BASELINE_WINDOW;
  const minSamples = opt.minSamples ?? BASELINE_MIN_SAMPLES;

  /* 只取最近 N 次。调用方给的通常是正序（旧→新），取尾部。 */
  const list = (Array.isArray(counts) ? counts : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .slice(-window);

  if (list.length < minSamples) {
    return { baseline: null, samples: list.length, source: 'insufficient', used: list };
  }

  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  return { baseline: median, samples: list.length, source: 'median', used: list };
}

/**
 * 用基线判缩水。
 *
 * @param {number} current 本次条数
 * @param {number[]} history 历次成功快照的条数
 * @param {{shrink: number, window?: number, minSamples?: number}} opt
 * @returns {{
 *   verdict: 'ok'|'shrink'|'unknown',
 *   baseline: number|null,
 *   ratio: number|null,
 *   source: string,
 *   reason: string|null,
 * }}
 */
export function checkShrink(current, history, opt) {
  const base = computeBaseline(history, opt);

  /* 历史不足：不做缩水判定（返回 unknown 而不是 ok）。
   * 说「ok」等于假装检查过了，那是自欺；说「shrink」是误伤。
   * 调用方据此只查绝对下限。 */
  if (base.source === 'insufficient') {
    return {
      verdict: 'unknown',
      baseline: null,
      ratio: null,
      source: base.source,
      reason: `历史只有 ${base.samples} 次，不足 ${opt.minSamples ?? BASELINE_MIN_SAMPLES} 次`,
    };
  }

  const ratio = base.baseline > 0 ? current / base.baseline : 1;

  if (ratio < opt.shrink) {
    return {
      verdict: 'shrink',
      baseline: base.baseline,
      ratio,
      source: base.source,
      reason: `缩水到基线中位数的 ${(ratio * 100).toFixed(0)}%（阈值 ${(opt.shrink * 100).toFixed(0)}%）`,
    };
  }

  return { verdict: 'ok', baseline: base.baseline, ratio, source: base.source, reason: null };
}
