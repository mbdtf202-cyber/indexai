/**
 * 第三方挂单的统计口径（S7.6 · D3 · F49）。
 *
 * 采集端原本把每条挂单原样下发，**包括商品页直链**——209 条，条条能点进发卡平台。
 * 这在页面上是个矛盾：一边写「不推荐、不保证可用」，一边把购买入口摆在旁边。
 *
 * D3 的结论是只呈现**区间**：某个产品有多少条挂单、多少条在售、价格从多少到多少、
 * 来自几个平台。这些数字足以判断「行情大概在什么位置」，而不构成导流。
 * 链接在采集端就被丢掉，不进 data.json——不是渲染时藏起来。
 */

/** 中位数：偶数个取中间两个的平均。空数组返回 null。 */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
}

/**
 * 按产品把挂单折成统计行。
 *
 * @param {Array<{product?: string, platform?: string, price?: number|null, status?: string}>|null} list
 * @returns {Array<{product: string, listings: number, inStock: number, platforms: number,
 *                  min: number|null, median: number|null, max: number|null}>}
 */
export function subsThirdStats(list) {
  if (!Array.isArray(list) || !list.length) return [];

  const byProduct = new Map();
  for (const row of list) {
    const product = String(row?.product || '').trim();
    if (!product) continue;
    if (!byProduct.has(product)) {
      byProduct.set(product, { platforms: new Set(), listings: 0, inStock: 0, prices: [] });
    }
    const acc = byProduct.get(product);
    acc.listings += 1;
    if (row.platform) acc.platforms.add(String(row.platform));
    // 「在售」只看 status，不猜库存文案
    if (row.status === 'in_stock') acc.inStock += 1;
    const price = Number(row.price);
    if (Number.isFinite(price) && price > 0) acc.prices.push(price);
  }

  return [...byProduct.entries()]
    .map(([product, acc]) => ({
      product,
      listings: acc.listings,
      inStock: acc.inStock,
      platforms: acc.platforms.size,
      // 没有可比较的价格时给 null，不补 0（INV-4：缺值不补）
      min: acc.prices.length ? Number(Math.min(...acc.prices).toFixed(2)) : null,
      median: median(acc.prices),
      max: acc.prices.length ? Number(Math.max(...acc.prices).toFixed(2)) : null,
    }))
    .sort((a, b) => b.listings - a.listings || a.product.localeCompare(b.product));
}

/**
 * 全站汇总：挂单总数、在售总数、涉及平台数。
 *
 * 平台数**必须**从原始挂单算：同一平台常常卖多个产品，把各产品的平台数相加会重复计数。
 * 因此这个函数接收原始列表而不是聚合行——参数类型不同是刻意的，
 * 免得有人拿聚合结果再调一次，得到一个「看着对其实错」的平台数。
 *
 * @param {Array<{product?: string, platform?: string, status?: string}>|null} list 原始挂单
 * @returns {{listings: number, inStock: number, platforms: number}}
 */
export function subsThirdTotal(list) {
  const rows = Array.isArray(list) ? list : [];
  const platforms = new Set();
  let inStock = 0;
  for (const row of rows) {
    if (row?.platform) platforms.add(String(row.platform));
    if (row?.status === 'in_stock') inStock += 1;
  }
  return { listings: rows.length, inStock, platforms: platforms.size };
}
