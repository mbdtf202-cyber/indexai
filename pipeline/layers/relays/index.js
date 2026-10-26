/**
 * relays 层：中转站探测（T3.1c9）。
 *
 * 51 个站、每个站一个 `/api/pricing`；5 个并发、逐站记账、单站失败不影响其它站。
 * 这一层是**唯一有并发**的层，所以它同时承担着「限速不许把 CI 拖死」的责任：
 * 并发度与超时都在这里定，而不是散落在调用方。
 *
 * 解析与定价逻辑（`pickFlagship` / `groupRatioTable` / `relayPrice` / `FLAGSHIP`）
 * 留在 `collect.mjs`——它们有独立测试且互相引用，经 ctx 注入。
 * 层负责的是「怎么探测、失败算什么、样本怎么取」。
 */

export default {
  id: 'relays',
  sources: ['*/api/pricing'],
  // 51 站 × 2 次尝试 × 9 秒超时，按 5 并发算约 3 分钟；预算给到 10 分钟留余量
  budget: { ms: 600_000, requests: 120 },

  /**
   * 探测所有站。返回 Map<domain, row>，与既有实现一致。
   *
   * @param {{entries: object[], probe: Function, concurrency?: number}} ctx
   */
  async fetch(ctx) {
    const entries = ctx.entries || [];
    const concurrency = Math.max(1, ctx.concurrency || 5);
    const out = new Map();
    const queue = [...entries];

    // 固定数量的 worker 消费同一个队列：并发度可控、顺序不决定结果
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        out.set(item.domain, await ctx.probe(item));
      }
    });
    await Promise.all(workers);
    return out;
  },

  /**
   * 归一：确认每个站的行有两个必需字段。
   *
   * 这里**不校验价格内容**——价格由 pickFlagship 决定，它已经有测试。
   * 层只挑出「连基本形状都不对」的行，避免下游炸在更深的地方。
   *
   * @param {Map<string, object>} raw
   */
  normalize(raw) {
    const rows = [];
    const quarantined = [];
    for (const [domain, row] of raw || new Map()) {
      if (!row || typeof row !== 'object') {
        quarantined.push({ reason: '探测结果不是对象', domain });
        continue;
      }
      if (row.domain !== domain) {
        quarantined.push({ reason: 'domain 与键不一致', domain });
        continue;
      }
      rows.push(row);
    }
    return { records: rows, quarantined };
  },

  /**
   * 合并：**逐站沿用**，而不是整层沿用。
   *
   * 51 个站里今天挂了 3 个，不该让另外 48 个也用旧值。判据与既有实现一致：
   * 探测失败、但上一版有价、且上次成功在 TTL（14 天）内 → 沿用并标 stale，
   * 同时保留「上次真的成功」的日期；超过 TTL 就清空，宁可少一条也不展示两周前的价。
   *
   * @param {object[]|null} prev 上一版 relays
   * @param {object[]} next 本次探测结果
   * @param {{ttlDays: number, today: string, enrich: Function}} ctx
   */
  merge(prev, next, ctx) {
    const before = new Map((prev || []).map((r) => [r.domain, r]));
    const ttl = ctx.ttlDays ?? 14;
    const daysSince = (iso) => {
      if (!iso) return Number.POSITIVE_INFINITY;
      const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
      if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
      return Math.round((Date.parse(`${ctx.today}T00:00:00Z`) - t) / 86_400_000);
    };

    return (next || []).map((r) => {
      // 探测成功：用新价，交给 enrich 补 eff / vsOfficial 等派生字段
      if (r.status === 'ok')
        return ctx.enrich({ ...r, stale: false, checked_at: r.checked_at || null });

      const old = before.get(r.domain);
      const hasPrices = old?.prices && Object.keys(old.prices).length > 0;
      const age = daysSince(old?.checked_at);

      if (hasPrices && age <= ttl) {
        return ctx.enrich({
          ...r,
          stale: true,
          staleDays: age,
          prices: old.prices || {},
          models: old.models || 0,
          groups: old.groups || null,
          checked_at: old.checked_at || null,
        });
      }
      // 超过 TTL 或者从来没有过价：清空，不展示旧数字
      return ctx.enrich({
        ...r,
        stale: false,
        staleDays: null,
        prices: {},
        models: 0,
        groups: null,
        checked_at: null,
      });
    });
  },

  /** 门禁：全站探测失败说明网络或源站整体不可用。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'relays-not-all-dead',
        check: (rows) => {
          const list = Array.isArray(rows) ? rows : [];
          if (!list.length) return { level: 'red', message: '中转站列表为空' };
          const live = list.filter((r) => r.status === 'ok').length;
          if (!live) return { level: 'red', message: '所有中转站都探测失败' };
          if (live / list.length < 0.3) {
            return { level: 'warn', message: `只有 ${live}/${list.length} 个站可用` };
          }
          return { level: 'ok' };
        },
      },
    ],
  },
};
