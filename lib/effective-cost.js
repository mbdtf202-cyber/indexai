/**
 * 有效成本的唯一事实来源（S8.1 · INV-5 · F36）。
 *
 * 同一个公式曾经在四处各写一份，参数还不一样：采集端 `{h:0.7,s:0.3}`、
 * 比价页 `{h:0.7,s:0.2}`、中转页 `s=0.3`、方法页两套都抄了一遍。
 * 任一处改动，另外三处就悄悄错了——而错误的表现是「同一个模型在两张表里价格不同」，
 * 读者只会看到矛盾，不会知道是代码分叉。
 *
 * 现在：**画像只在这里定义**，采集端、页面、方法页都读这一份。
 *
 * 归属说明：拆分时它并进了重写后的 `lib/cost.js`（订阅计算），但没有被保留下来，
 * 于是中转站页的「有效成本」列与比价排序全部失去依据。这里恢复为独立模块——
 * 订阅计算与模型成本是两件事，不该共用一个文件。
 */


/**
 * 用量画像。
 *
 * `h` = 缓存命中比例（命中的输入 token 按 cache_read 计价）
 * `s` = 输出占全部计费 token 的比例
 * `w` = 缓存写入比例（只影响支持 cache_write 计价的渠道）
 *
 * 两套画像**数值不同**，这是历史事实而不是笔误：
 * 比价表按「读多写少」的通用问答画像（输出占 20%），
 * 中转站页按 agent 编程（输出占 30%），因为中转站的主要用户是 coding agent。
 * 先如实收录，未来若要统一，必须同时改页面默认值与方法页说明。
 */
export const PROFILES = {
  compare: {
    h: 0.7,
    s: 0.2,
    w: 0,
    label: '通用问答',
    note: '比价表默认：读多写少，输出占两成。缓存命中按 70% 计。',
  },
  agent: {
    h: 0.7,
    s: 0.3,
    w: 0,
    label: 'agent 编程',
    note: '中转站页默认：coding agent 的典型 token 构成，输出占三成。',
  },
};

/**
 * 默认画像的键。页面与采集端不传画像时用它。
 * @type {string}
 */
export const DEFAULT_PROFILE = 'agent';

/**
 * 公式的展示文本。方法页直接渲染，不再手抄（S11）。
 * @type {string}
 */
export const FORMULA = 'cost_per_1M = (1 − s) · [(1 − h − w) · input + h · cache_read + w · cache_write] + s · output';

/**
 * 同一条公式的中文展示文本（页面表格里的提示条用它，参数名用中文）。
 * @type {string}
 */
export const FORMULA_ZH = '(1−s)·[(1−h)·输入 + h·缓存读] + s·输出';

/**
 * 按画像算 1M token 的有效成本。
 *
 * @param {{kind?: string, input?: number, output?: number, cacheRead?: number, cacheWrite?: number}|null} price
 *   归一后的价格对象；只有 `kind === 'per_1m'` 才参与比较
 * @param {{h: number, s: number, w?: number}} [profile] 不传则用默认画像
 * @returns {number|null} 保留 4 位小数；不可比时返回 null（不补 0）
 */
export function effectiveCost(price, profile = PROFILES[DEFAULT_PROFILE]) {
  if (!price || price.kind !== 'per_1m') return null;
  const { h, s } = profile;
  const w = profile.w ?? 0;
  const input = Number(price.input);
  const output = Number(price.output);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;

  // 缺缓存价时按「没有折扣」处理：命中率不该凭空变出优惠
  const cacheRead = price.cacheRead != null && Number.isFinite(Number(price.cacheRead)) ? Number(price.cacheRead) : input;
  const cacheWrite = price.cacheWrite != null && Number.isFinite(Number(price.cacheWrite)) ? Number(price.cacheWrite) : input;

  const inPart = (1 - h - w) * input + h * cacheRead + w * cacheWrite;
  return Number(((1 - s) * inPart + s * output).toFixed(4));
}

/**
 * 按名字取画像；名字不存在时回落到默认画像（不让调用方拿到 undefined）。
 * @param {string} name
 * @returns {{h: number, s: number, w?: number, label: string, note: string}}
 */
export function profileOf(name) {
  return PROFILES[name] || PROFILES[DEFAULT_PROFILE];
}
