/**
 * offers 层：免费额度（T3.1c7）。
 *
 * 这一层没有网络请求：数据全部来自人工核校的 `curated/offers.json`。
 * 因此它是**最简单的一层**，也是唯一一层「失败原因只有两种」的：
 * 要么名单读不到（部署错误），要么名单为空（数据问题）。
 *
 * 但它不是纯搬运——有一个真实存在的处理：按产品去重。
 * 同一个产品可能有多条记录（不同渠道、不同时期），要去重并合并 entries 与 sources。
 * 去重函数留在 `collect.mjs`（它被多处引用且有测试），经 ctx 注入。
 */

export default {
  id: 'offers',
  sources: ['curated/offers.json'],
  // 没有网络请求：预算只表达「这条路径不该发请求」
  /** 合并策略（T3.6 · S3.3）：人工型（S3.3）：直接读 curated/，校验到期日。 */
  mergeStrategy: 'curated',

  budget: { ms: 1_000, requests: 1 },

  /**
   * 「抓取」在这里是读人工名单。
   * @param {{curated: {offers: object[]}}} ctx
   */
  async fetch(ctx) {
    return ctx.curated?.offers || [];
  },

  /**
   * 归一：补默认置信度与来源类型，再做去重。
   *
   * 三个默认值的来历：人工数据写法不统一（有的写 `conf`，有的写 `confidence`），
   * 归一在这里把它们拉平，下游只用一种名字。
   *
   * @param {object[]} raw
   * @param {{dedupeOffers: Function}} ctx
   */
  normalize(raw, ctx) {
    const list = Array.isArray(raw) ? raw : [];
    if (!list.length) {
      return { records: null, quarantined: [{ reason: 'curated/offers.json 为空' }] };
    }
    // 每条都必须有 source：这是 INV-2（每个数字可回溯）在这一层的落地
    const withBacking = [];
    const quarantined = [];
    for (const o of list) {
      const sources = o.sources?.length ? o.sources : o.source ? [o.source] : [];
      if (!sources.length) {
        quarantined.push({ reason: '缺少 source，无法回溯', product: o?.product });
        continue;
      }
      withBacking.push({
        ...o,
        conf: o.conf || o.confidence || 'med',
        srcType: o.srcType || o.source_type || 'official',
        sources,
      });
    }
    const deduped = ctx.dedupeOffers(withBacking);
    return { records: { rows: deduped.rows, merged: deduped.merged }, quarantined };
  },

  /**
   * 合并：本次为空时沿用上一版。
   *
   * 这一层的「上一版」几乎总是空——人工名单不在 data.json 里循环。
   * 但接口要保持一致：调用方不该为某一层记住特殊情况。
   *
   * @param {{rows?: object[]}|null} prev
   * @param {{rows: object[], merged: number}|null} next
   */
  merge(prev, next) {
    if (next?.rows?.length) return next;
    if (prev?.rows?.length) return { ...prev, stale: true };
    return next || { rows: [], merged: 0 };
  },

  /** 门禁：免费额度层为空说明名单出了问题。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'offers-not-empty',
        /* 门禁收到的是行数组；normalize 的产物是 {rows}。两种形状都认。 */
        check: (v) => {
          const n = Array.isArray(v) ? v.length : (v?.rows?.length ?? 0);
          if (!n) return { level: 'red', message: '免费额度为空' };
          return { level: 'ok' };
        },
      },
    ],
  },
};
