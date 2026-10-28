/**
 * 模型键与价格档位的纯函数。
 *
 * 这几个函数原先只存在于单文件 `collect.mjs`。T3.1 拆层时它们没有被搬出来，
 * 层的 ctx 仍旧引用 `ctx.band` / `ctx.familyKey` / `ctx.slugify`，于是编排器一跑
 * 就 `ctx.fetch is not a function` / `undefined is not a function`。
 *
 * 从 `41dec66:collect.mjs`（collect.mjs 最后一个完整版本）原样搬出，语义不变。
 * 归属：这是「同一模型怎么归一、价格落在哪个档」的唯一判定点（INV-5），
 * 采集端与页面都从 ctx 注入这一份，不再各自实现。
 */

/** 把「每百万 token 的价格」规范化；非有限值与非正数一律 null（-1 表示纯路由产品，不计价）。 */
export const per1M = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number((n * 1e6).toFixed(6));
};

/** 厂商标识归一：小写、非字母数字压成单个连字符、去首尾连字符。 */
export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');

/** 同模型归一：去掉厂商前缀、`:free` 后缀、日期尾巴与变体标记。 */
export function familyKey(vendorId, id, name) {
  let base = id.replace(/^[^/]+\//, '').replace(/:free$/, '');

  /* 日期尾巴（F24）。
   *
   * 论文与聚合站给同一个模型加日期后缀表示快照：`claude-opus-5-5-20260101`、
   * `gpt-6-2026-01-01`、`kimi-k2-260101`。这些都是**同一个模型**的不同快照，
   * 不剥掉会让「同族」永远匹配不上。
   *
   * 三种写法都要认：\`YYYY-MM-DD\`、\`YYYYMMDD\`（8 位连写）、\`YYMMDD\`（6 位）。
   * 只剥**末尾**的，不动中间——\`claude-2026-preview\` 里的日期是名字的一部分。
   */
  base = base.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{6})$/, '');
  base = base.replace(/-(?:latest)$/, '');
  base = base.replace(
    /[-_ ]?(preview|exp|experimental|beta|alpha|thinking|reasoning|high|low|mini-beta)$/,
    '',
  );
  base = base.replace(/\./g, '-');
  if (!base) base = slugify(name || id);
  return `${vendorId}::${base}`;
}

/** 价格档位：只看输入价，免费单独一档。 */
export function band(input, free) {
  if (free) return 'free';
  if (input == null) return 'unknown';
  if (input < 0.25) return 'budget';
  if (input < 1.5) return 'standard';
  return 'premium';
}

/** 峰谷价：OpenRouter 用 overrides 表达分时价，取最小/最大 prompt 价做提示。 */
export function peakNote(pricing) {
  const ov = pricing?.overrides;
  if (!Array.isArray(ov) || !ov.length) return null;
  const vals = ov.map((o) => per1M(o.prompt)).filter((n) => n != null);
  const base = per1M(pricing.prompt);
  const all = [base, ...vals].filter((n) => n != null);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  if (!(hi > lo)) return null;
  const weekend = ov.every(
    (o) => Array.isArray(o.utc_days) && o.utc_days.length && o.created_at == null,
  );
  return {
    label: weekend ? '分时/分日价' : '分时价',
    min: lo,
    max: hi,
    ratio: Number((hi / lo).toFixed(2)),
    note: `同一模型在不同时段/日期标价 $${lo}–$${hi} /1M input`,
  };
}
