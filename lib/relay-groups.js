/**
 * 中转站分组名的灰白判定（S7.6 · D3 · F49）。
 *
 * 中转站的分组名里有一类明说自己是「逆向」或「特价」：
 * 逆向 = 破解客户端协议的通道，特价 = 明显低于成本的引流价。
 * 这两种价格不代表真实行情——把它们算进「代表价」或「最低可达价」，
 * 会让读者以为正常渠道也能拿到那个价。
 *
 * 规则只做一件事：**判断一个分组名是不是灰色**，由调用方决定怎么处置
 * （当前处置是：不参与代表价与最低可达价的计算，但保留在分母里计数）。
 */

/** 命中的词。中英各一组，避免只认一种写法。 */
const GRAY = [/逆向/, /特价/, /reverse/i, /逆向工程/, /破解/, /毛坯/, /掺水/];

/**
 * 这个分组名是不是灰色分组。
 *
 * 注意：空字符串、default、纯分组倍率名（0.5x）都不算——那种归「未知」，不归「灰色」，
 * 把它们一起排除会让排除数虚高，读者反而看不出真正的问题在哪。
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isGrayGroup(name) {
  const s = String(name ?? '').trim();
  if (!s) return false;
  return GRAY.some((re) => re.test(s));
}

/**
 * 从一个站点的分组列表里分出灰色与正常两组。
 * @param {Array<{name?: string, ratio?: number}>|null} groups
 * @returns {{normal: Array<object>, gray: Array<object>, grayCount: number}}
 */
export function splitGroups(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const normal = [];
  const gray = [];
  for (const g of list) {
    if (isGrayGroup(g?.name)) gray.push(g);
    else normal.push(g);
  }
  return { normal, gray, grayCount: gray.length };
}
