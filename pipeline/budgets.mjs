/**
 * 性能预算（T5.7 · S9.7）。
 *
 * ## 四条硬线
 *
 * | 指标 | 上限 |
 * |---|---|
 * | 任一路由首屏传输（HTML + CSS + JS，brotli，不含字体） | 120 KB |
 * | 任一懒加载数据请求（brotli） | 300 KB |
 * | CLS（e2e 实测） | 0.05 |
 * | 首屏渲染期间的长任务（4 倍 CPU 降速） | ≤ 200 ms |
 *
 * ## 为什么按 brotli 算
 *
 * 未压缩的字节数没有意义：CDN 一定会压。按 brotli 算才是读者真正下载的量。
 * 字体不算在内——它是并行请求，且 `font-display: swap` 不阻塞首屏。
 *
 * ## 为什么「只有超预算才考虑引入压缩工具」
 *
 * S9.7 原文如此。现在没有任何压缩步骤：源码直接发布。
 * 如果哪天真超了，先量清楚是哪一块（HTML 内联样式？主脚本？），
 * 再决定要不要上 esbuild——而不是一上来就加一层构建。
 */

import { brotliCompressSync, constants } from 'node:zlib';

/** S9.7 的四条线。 */
export const BUDGET = {
  /** 首屏传输（HTML + CSS + JS，brotli，不含字体），字节。 */
  firstPaintBytes: 120 * 1024,
  /** 单个懒加载数据请求（brotli），字节。 */
  lazyDataBytes: 300 * 1024,
  /** 累计布局偏移。 */
  cls: 0.05,
  /** 4 倍 CPU 降速下首屏渲染期间的长任务总时长，毫秒。 */
  longTaskMs: 200,
};

/**
 * brotli 压缩后的字节数。
 *
 * @param {Buffer|string} input
 * @returns {number}
 */
export function brotliSize(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  /* quality 5 与 Cloudflare 一类的边缘压缩接近；11 太慢，用它算等于过度乐观。 */
  return brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
  }).length;
}

/**
 * 判断一条预算。
 *
 * @param {string} label
 * @param {number} actual
 * @param {number} limit
 * @returns {{label: string, actual: number, limit: number, pass: boolean, ratio: number}}
 */
export function checkBudget(label, actual, limit) {
  return {
    label,
    actual,
    limit,
    pass: actual <= limit,
    ratio: limit > 0 ? Number((actual / limit).toFixed(3)) : 0,
  };
}

/**
 * 从一组文件算某个路由的首屏传输量。
 *
 * @param {object} opt
 * @param {string} opt.html 页面 HTML
 * @param {string[]} [opt.css] CSS 文本列表
 * @param {string[]} [opt.js] JS 文本列表
 * @returns {{html: number, css: number, js: number, total: number}}
 */
export function firstPaintBytes(opt) {
  const html = brotliSize(opt.html || '');
  const css = (opt.css || []).reduce((n, s) => n + brotliSize(s), 0);
  const js = (opt.js || []).reduce((n, s) => n + brotliSize(s), 0);
  return { html, css, js, total: html + css + js };
}

/**
 * 把一组检查结果渲染成表格（构建日志与 job summary 都用）。
 *
 * @param {object[]} checks
 * @returns {string}
 */
export function renderBudgetTable(checks) {
  const lines = ['| 项目 | 实际 | 上限 | 占比 | 结论 |', '|---|---:|---:|---:|:---:|'];
  for (const c of checks) {
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    lines.push(
      `| ${c.label} | ${kb(c.actual)} | ${kb(c.limit)} | ${(c.ratio * 100).toFixed(0)}% | ${c.pass ? '✅' : '❌'} |`,
    );
  }
  return lines.join('\n');
}
