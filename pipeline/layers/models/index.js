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

import { mergeCatalog } from '../../../lib/merge-strategies.js';

/**
 * OpenRouter 的 id 前缀 → 可读厂商名。
 *
 * `moonshotai` → `MoonshotAI`、`deepseek` → `DeepSeek`、`x-ai` → `xAI`。
 * 只做首字母大写与连字符处理，不做词典映射——推不出来就是推不出来，
 * 比维护一张永远不全的对照表可靠。
 */
function prettyVendor(prefix) {
  const s = String(prefix || '').trim();
  if (!s) return 'Unknown';
  // 已知的品牌写法（都来自 OpenRouter 实际出现的前缀）
  const KNOWN = {
    'x-ai': 'xAI',
    'z-ai': 'Z AI',
    moonshotai: 'MoonshotAI',
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    meta: 'Meta',
    mistralai: 'Mistral',
    qwen: 'Alibaba Qwen',
    alibaba: 'Alibaba',
    xiaomi: 'Xiaomi',
    nvidia: 'NVIDIA',
    cohere: 'Cohere',
    perplexity: 'Perplexity',
  };
  const key = s.toLowerCase();
  if (KNOWN[key]) return KNOWN[key];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default {
  id: 'models',
  sources: ['openrouter.ai/api/v1/models', 'curated/official-prices.json'],
  /** 合并策略（T3.6 · S3.3）：目录型（S3.3）：本次没拿到的条目沿用上一版并记 lastOk，超过 TTL 才移除。 */
  mergeStrategy: 'catalog',

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
    const rawCatalog =
      raw?.catalog && Array.isArray(raw.catalog.rows)
        ? raw.catalog
        : { rows: [], dropped: 0, unpriced: 0, stale: false };

    /* 聚合行补骨架字段（T3.5 发现的真缺口）。
     *
     * `fetchCatalog` 只给 id / name / created / 价格，而行契约还要求
     * vendor / vendorId / channel / channelKind / band / family。
     * 以前这些字段靠「人工官方价那半边」带进来，聚合行自己是裸的——
     * schema 一上线就把 469 行隔离掉了，正好暴露它。
     *
     * 厂商名从 OpenRouter 的 id 前缀推（`moonshotai/kimi-k3.1-pro` → MoonshotAI），
     * 推不出来标 Unknown，不编造。 */
    const catalog = {
      ...rawCatalog,
      rows: rawCatalog.rows.map((m) => {
        const prefix = String(m.id || '').split('/')[0] || '';
        const vendorId = ctx.slugify(prefix) || 'unknown';
        return {
          ...m,
          vendor: m.vendor || prettyVendor(prefix),
          vendorId: m.vendorId || vendorId,
          channel: m.channel || 'OpenRouter',
          channelKind: m.channelKind || 'aggregator',
          band: m.band || ctx.band(m.input, m.input === 0 && m.output === 0),
          family: m.family || ctx.familyKey(vendorId, String(m.id || ''), m.name),
          free: m.free ?? (m.input === 0 && m.output === 0),
          src: m.src || 'https://openrouter.ai/api/v1/models',
          srcType: m.srcType || 'api',
          conf: m.conf || 'med',
          ...(m.seen ? {} : { seen: ctx.today() }),
        };
      }),
    };

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
  merge(prev, next, ctx) {
    const rows = next?.rows || [];
    const direct = rows.filter((m) => m.channelKind !== 'aggregator');
    const aggregator = rows.filter((m) => m.channelKind === 'aggregator');

    /* 目录型（T3.6 · S3.3）：**逐条**合并，不是「全空才回退」。
     *
     * 旧实现只在聚合目录整个为空时沿用；只要源站给了 400 条（平时 480 条），
     * 那 80 个模型就从比价表里消失，而且没人知道是「下架了」还是「这次没翻到」。
     *
     * 现在：本次出现的用本次，没出现的沿用上一版并标 stale，超过 TTL（3 天）
     * 才真正移除。人工官方价（direct）永远用本次的——那是手写的，不该被沿用逻辑碰。 */
    const prevAgg = (prev || []).filter((m) => m.channelKind === 'aggregator');
    const merged = mergeCatalog(prevAgg, aggregator, {
      keyOf: (m) => m.id,
      ttlDays: 3,
      today: ctx.today(),
    });

    const staleCount = merged.filter((m) => m.stale).length;
    if (staleCount) ctx.log(`models 沿用上一版 ${staleCount} 个未出现的模型`);

    return { ...next, rows: [...direct, ...merged] };
  },

  /** 门禁：一个模型都没有说明两个源都坏了。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'models-not-empty',
        /* 门禁收到的是「行数组」（pipeline/manifest.mjs 统一传入），
         * 不是 normalize 的 {rows} 包装——两种形状都认，否则会误判整层为空。 */
        check: (v) => {
          const n = Array.isArray(v) ? v.length : (v?.rows?.length ?? 0);
          if (!n) return { level: 'red', message: '模型目录为空' };
          return { level: 'ok' };
        },
      },
    ],
  },
};
