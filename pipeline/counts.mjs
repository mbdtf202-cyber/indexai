/**
 * 页面计数（T5.9 · S9.10）。
 *
 * ## 为什么单独一个模块
 *
 * S9.10 要求「页面上的统计数字一律来自数据」。这句话的反面是：
 * 每个数字都得有一个**算得出来的**来源，不能是页面自己数、也不能是写死的。
 *
 * 把这些计算集中在这里的好处是能一处看全：页面要哪些数字、每个数字怎么算的。
 * 散在编排器里时，漏一个就是页面上一个 `undefined`——而 `undefined`
 * 不会报错，只会安静地出现在读者眼前。
 */

/** 今天（`YYYY-MM-DD`）。 */
const dayOf = (now) => String(now || '').slice(0, 10);

/**
 * 算出页面要的全部计数。
 *
 * @param {object} out 各层产出
 * @param {object} opt
 * @param {string} opt.now 本次运行时刻（ISO）
 * @param {number} opt.sources 源数量
 * @returns {object}
 */
export function buildCounts(out, opt = {}) {
  const now = opt.now || '';
  const today = dayOf(now);
  const models = Array.isArray(out.models) ? out.models : [];
  const events = Array.isArray(out.events) ? out.events : [];
  const relays = Array.isArray(out.relays) ? out.relays : [];
  const boards = out.bench?.boards || {};

  /** 活动按截止日分开放 / 已结束。 */
  const endOf = (e) => String(e.end || e.endAt || '');
  const isPast = (e) => endOf(e) && endOf(e) < today;

  /* 需要复核：review_by 已过期。三处人工数据都查。 */
  let outdated = 0;
  for (const layer of ['offers', 'subs', 'relays']) {
    for (const row of Array.isArray(out[layer]) ? out[layer] : []) {
      const by = row?.review_by;
      if (by && String(by).slice(0, 10) <= today) outdated += 1;
    }
  }

  const subsRegionsRows = Array.isArray(out.subsRegions) ? out.subsRegions : [];
  const regionPrices = subsRegionsRows.reduce(
    (n, r) => n + (Array.isArray(r.rows) ? r.rows.length : 0),
    0,
  );
  const cachePriced = models.filter((m) => Number(m.cache_read) > 0).length;

  return {
    models: models.length,
    /* 渠道拆分：聚合（OpenRouter 这类）与直连（官方价）。
     * 两者不互斥——同一家厂商可能既有官方价也有聚合挂牌价。 */
    aggregator: models.filter((m) => m.channelKind === 'aggregator').length,
    direct: models.filter((m) => m.channelKind !== 'aggregator').length,

    events: events.length,
    eventsOpen: events.filter((e) => !isPast(e)).length,
    eventsPast: events.filter(isPast).length,

    relays: relays.length,
    relaysLive: relays.filter((r) => r.status === 'ok').length,
    relayComparable: relays.filter(
      (r) => r.status === 'ok' && r.prices && Object.keys(r.prices).length,
    ).length,

    news: Array.isArray(out.news) ? out.news.length : 0,
    resources: Array.isArray(out.resources) ? out.resources.length : 0,
    offers: Array.isArray(out.offers) ? out.offers.length : 0,
    subs: Array.isArray(out.subs) ? out.subs.length : 0,
    /* 订阅的两个派生形状（T3.1c6）：区价组数与第三方挂单条数。
     * 它们是数组，页面曾经直接当数字用，于是显示 undefined。 */
    subsRegions: Array.isArray(out.subsRegions) ? out.subsRegions.length : 0,
    subsThird: Array.isArray(out.subsThird) ? out.subsThird.length : 0,
    signals: Array.isArray(out.signals) ? out.signals.length : 0,

    /* 评测：榜数才是读者关心的量，行数是次要的。 */
    benchBoards: Object.keys(boards).length,
    benchRows: Object.values(boards).reduce((n, b) => n + (b.rows?.length || 0), 0),
    /* 上榜模型去重数：同一个模型可能出现在多个榜里，只算一次。 */
    benchModels: (() => {
      const seen = new Set();
      for (const b of Object.values(boards)) {
        for (const row of b?.rows || []) if (row?.model) seen.add(row.model);
      }
      return seen.size;
    })(),

    /* 带缓存价的模型数。页面用 withCache 这个名字，同一个值发两份，
     * 免得为改一个字段名去动模板。 */
    cachePriced,
    withCache: cachePriced,

    /* 区价总条数（不是套餐数）：订阅页「N 个套餐 · M 条区价」。
     * 页面用 subsRegionsRaw 这个名字。 */
    regionPrices,
    subsRegionsRaw: regionPrices,

    /* 主页那句「N 个榜」：与 benchBoards 同值，但页面用的是 `bench` 这个短名。
     * 保留两个名字是为了不改页面——两个字段同一个来源，不会不一致。 */
    bench: Object.keys(boards).length,

    /* 厂商去重数（比价页右上角「N 家厂商」）。 */
    vendors: (() => {
      const seen = new Set();
      for (const m of models) if (m.vendor) seen.add(m.vendor);
      return seen.size;
    })(),

    outdated,
    sources: opt.sources ?? 0,
  };
}
