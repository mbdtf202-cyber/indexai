/**
 * models 层：模型目录（T3.1c8）。
 *
 * 两个源，性质完全不同：
 * - **聚合目录**（OpenRouter）：每天实时抓，几百行，可能整体失败 → 走分层记账
 * - **人工官方价**（`curated/official-prices.json`）：人核过的直连价，不参与抓取失败
 *
 * 这个区别贯穿全层：基线与沿用**只针对聚合部分**。官方价是人工核实的，
 * 不该因为「今天 OpenRouter 挂了」就被一起标成 stale——那会把「我核实过」
 * 和「源站没响应」混成一件事。
 *
 * 去重、familyKey、价格档位这些纯函数留在 `collect.mjs`（有独立测试），
 * 经 ctx 注入；层负责的是「两个源怎么合、谁该沿用谁不该」。
 */

export default {
  id: 'models',
  sources: ['openrouter.ai/api/v1/models', 'curated/official-prices.json'],
  budget: { ms: 120_000, requests: 6 },

  /**
   * 抓聚合目录 + 取人工官方价。
   * @param {{fetchCatalog: Function, curated: {official: object[]}, log: Function}} ctx
   */
  async fetch(ctx) {
    const catalog = await ctx.fetchCatalog();
    return { catalog, curated: ctx.curated?.official || [] };
  },

  /**
   * 归一：把两个源拉成同一形状，再合并去重。
   *
   * @param {{catalog: object, curated: object[]}} raw
   * @param {object} ctx 需要 band / familyKey / dedupeModels / slugify / today
   */
  normalize(raw, ctx) {
    const catalog =
      raw?.catalog && Array.isArray(raw.catalog.rows)
        ? raw.catalog
        : { rows: [], dropped: 0, unpriced: 0, stale: false };

    const curated = (raw?.curated || []).map((r) => ({
      id: r.model,
      name: r.name || r.model,
      vendor: r.vendor,
      vendorId: ctx.slugify(r.vendor),
      channel: r.channel || '官方直连',
      channelKind: 'direct',
      ctx: r.ctx ? r.ctx * 1000 : null,
      input: r.in ?? null,
      output: r.out ?? null,
      cache_read: r.cr ?? null,
      cache_write: r.cw ?? null,
      free: (r.in === 0 && r.out === 0) || false,
      band: ctx.band(r.in, r.in === 0),
      family: ctx.familyKey(ctx.slugify(r.vendor), `${r.model}`, r.model),
      modality: 'text->text',
      peak: null,
      cny: r.cny || null,
      url: r.src,
      src: r.src,
      srcType: 'official',
      conf: r.conf || 'high',
      cm: r.cm || '官方页未说明',
      note: r.note || '',
      seen: ctx.today(),
    }));

    /* 发布时间补齐：同一 family 里只要有一行带 created，其余行（含人工价）
     * 都继承它。否则「人工核实的官方价」在按发布时间排序时会永远排最后。 */
    const createdByFamily = new Map();
    for (const m of catalog.rows) {
      if (!m.created) continue;
      createdByFamily.set(m.family, Math.max(createdByFamily.get(m.family) || 0, m.created));
    }
    for (const m of curated) {
      if (!m.created && createdByFamily.has(m.family)) m.created = createdByFamily.get(m.family);
    }

    const deduped = ctx.dedupeModels([...catalog.rows, ...curated]);
    return {
      records: {
        rows: deduped.rows,
        dropped: deduped.dropped,
        // 聚合源的统计要一起带出去：meta.dedupe 用它
        catalog: { dropped: catalog.dropped || 0, unpriced: catalog.unpriced || 0 },
      },
      quarantined: catalog.rows.length ? [] : [{ reason: '聚合目录本次为空' }],
    };
  },

  /**
   * 合并：**只对聚合部分沿用**，人工官方价永远用本次的。
   *
   * 这一条很容易写错：如果整层沿用，官方价会被替换成上一版的值、并被打上 stale，
   * 于是「我核实于 2026-10-01」变成「源站今天没响应」——两件不同的事。
   *
   * @param {object[]|null} prev 上一版 models（只有 aggregator 行会被用上）
   * @param {object} next normalize 的产物
   */
  merge(prev, next) {
    const rows = next?.rows || [];
    const aggregator = rows.filter((m) => m.channelKind === 'aggregator');
    if (aggregator.length) return next;

    // 本次聚合目录为空：沿用上一版的 aggregator 行，人工价仍用本次的
    const prevAgg = (prev || []).filter((m) => m.channelKind === 'aggregator');
    if (!prevAgg.length) return next;

    const direct = rows.filter((m) => m.channelKind !== 'aggregator');
    return {
      ...next,
      rows: [...prevAgg.map((m) => ({ ...m, stale: true })), ...direct],
      stale: true,
    };
  },

  /** 门禁：一个模型都没有说明两个源都坏了。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'models-not-empty',
        check: (v) => {
          if (!v?.rows?.length) return { level: 'red', message: '模型目录为空' };
          return { level: 'ok' };
        },
      },
    ],
  },
};
