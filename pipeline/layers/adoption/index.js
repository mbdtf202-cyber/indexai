/**
 * adoption 层：OpenRouter 的实际调用量排行（谁在用哪个工具）。
 *
 * 这是第二个按契约落地的层（T3.1c2）。比 fx 复杂一点：一个源、两条记录流
 * （apps 与 models），并且解析依赖页面里内嵌的 JSON 片段。
 *
 * 层的边界（INV-11）：不读文件、不直接 fetch、不碰 Date.now()。
 * 解析函数从 collect.mjs 借用——本层只负责「抓 + 校验 + 合并」，
 * 解析逻辑等 T3.8 结构化时再整批搬迁，避免这一步同时改行为和结构。
 */

/** 排行页地址。 */
export const RANKINGS_URL = 'https://openrouter.ai/rankings';

/**
 * 解析排行页里内嵌的 JSON。
 *
 * 这个函数目前仍定义在 collect.mjs（它被多处引用，且测试直接覆盖它）。
 * 层通过注入的方式拿到它，这样搬迁本层不需要改动解析逻辑本身。
 *
 * @param {(html: string) => {apps: object[], models: object[]}} parse
 * @param {(url: string, opt?: object) => Promise<{ok: boolean, status: number, text: string}>} text
 * @returns {(ctx: object) => Promise<{apps: object[], models: object[]}>}
 */
export function makeFetch(parse, _text) {
  return async function fetchRankings(ctx) {
    const res = await ctx.http.text(RANKINGS_URL, { label: 'openrouter-rankings' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.text.length < 10_000) {
      // 页面过短通常是被拦或改版：当成失败，而不是当成「今天没人用」
      throw new Error(`页面过短（${res.text.length}），可能被拦`);
    }
    const parsed = parse(res.text);
    if (!parsed.apps.length && !parsed.models.length) {
      throw new Error('解析出 0 条——页面结构可能变了');
    }
    return parsed;
  };
}

export default {
  id: 'adoption',
  sources: ['openrouter.ai/rankings'],
  /** 合并策略（T3.6 · S3.3）：目录型（S3.3）：本次没拿到的条目沿用上一版并记 lastOk，超过 TTL 才移除。 */
  mergeStrategy: 'catalog',

  budget: { ms: 30_000, requests: 1 },

  /**
   * 抓取。实现由 `makeFetch` 注入，默认导出这份是给编排器用的占位：
   * 它读 ctx.parse，这样层本身不 import collect.mjs（避免循环依赖）。
   * @param {{http: object, parse: Function}} ctx
   */
  async fetch(ctx) {
    return makeFetch(ctx.parse, ctx.http.text)(ctx);
  },

  /**
   * 归一：只保留有标题与名次的条目，其余隔离。
   * @param {{apps?: object[], models?: object[]}} raw
   */
  normalize(raw) {
    const apps = [];
    const quarantined = [];

    for (const a of raw?.apps || []) {
      if (!a || typeof a.title !== 'string' || !a.title) {
        quarantined.push({ reason: '应用缺标题' });
        continue;
      }
      if (!Number.isFinite(a.rank)) {
        quarantined.push({ reason: '应用缺名次', title: a.title });
        continue;
      }
      apps.push(a);
    }

    // models 不再交付（T2.2 删掉 orModels）：解析器仍然产出它，
    // 但层不把它写进 data.json——没有消费者的字段不该占据计数与体积。
    return { records: { apps }, quarantined };
  },

  /**
   * 合并：本次为空但上一版有内容时沿用上一版并标 stale。
   *
   * **只交付 apps**。models 在 T2.2 已经被删（页面从不读它），
   * 原实现却把它一起算进 `meta.collect[].n`——那个 44 是「对象里数组长度之和」的
   * 副产品，不是真的交付了 44 条数据。现在 n 如实等于页面能看到的条数。
   *
   * @param {{apps?: object[]}|null} prev
   * @param {{apps: object[]}|null} next
   */
  merge(prev, next) {
    if (next?.apps?.length) return { apps: next.apps };
    if (prev?.apps?.length) return { apps: prev.apps, stale: true };
    return { apps: [] };
  },

  /** 门禁：抓不到就是抓不到——但「0 条应用」不足以判红，页面本来就不强依赖它。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'adoption-empty',
        /* 门禁收到的是行数组；此层的 normalize 产物是 {apps}（对象而非数组）。
         * 两种形状都认，否则会误判整层为空。 */
        check: (v) => {
          const n = Array.isArray(v) ? v.length : (v?.apps?.length ?? 0);
          if (!n) return { level: 'warn', message: '没有应用到任何调用量数据' };
          return { level: 'ok' };
        },
      },
    ],
  },
};
