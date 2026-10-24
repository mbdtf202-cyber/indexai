/**
 * fx 层：美元兑人民币汇率。
 *
 * 这是全项目最小的一个数据层，也是新契约的第一块试金石（T3.1c / S4.4）。
 * 层契约要求每层导出同一形状：`id` / `sources` / `budget` / `fetch` / `normalize` /
 * `merge` / `health`。编排器只认这个形状，不认具体层。
 *
 * 本层不读文件、不直接 fetch、不碰 Date.now()——三者都从 ctx 来（INV-11）：
 * 时间走 ctx.now()，网络走 ctx.http，上一版走 ctx.prev。
 */

export default {
  id: 'fx',
  sources: ['open.er-api.com'],
  budget: { ms: 15_000, requests: 2 },

  /**
   * 抓汇率。
   * @param {{http: {json: Function}}} ctx
   * @returns {Promise<{rate: number, asOf: string|null, source: string}>}
   */
  async fetch(ctx) {
    const j = await ctx.http.json('https://open.er-api.com/v6/latest/USD', {
      label: 'fx',
      tries: 2,
    });
    const rate = j?.rates?.CNY;
    if (!rate) throw new Error('汇率响应里没有 CNY');
    return {
      rate: Number(Number(rate).toFixed(4)),
      asOf: (j.time_last_update_utc || '').slice(0, 16) || null,
      source: 'open.er-api.com',
    };
  },

  /**
   * 归一。汇率是单值，没有「坏行」可言——校验失败就抛，交给编排器记 failed。
   * @param {{rate: number, asOf: string|null, source: string}} raw
   * @param {{now: () => Date}} ctx
   */
  normalize(raw, ctx) {
    if (!Number.isFinite(raw?.rate) || raw.rate <= 0) {
      return { records: null, quarantined: [{ reason: '汇率不是正数' }] };
    }
    // 输出形状必须与既有 data.json 的 meta.fx 完全一致：
    // 下游（subs 的 cny 折算、页面汇率条）读的是 USDCNY / as_of。
    // 层内部用可读命名，边界处映射回既有字段，避免「搬家顺手改名」破坏契约。
    return {
      records: {
        USDCNY: raw.rate,
        as_of: raw.asOf,
        source: raw.source,
        fetched_at: ctx.now().toISOString(),
      },
      quarantined: [],
    };
  },

  /**
   * 与上一版合并：抓失败时沿用旧值并标 stale。
   *
   * 兜底汇率（7.1）只在**从来没有成功过**时使用，且 source 写 'fallback'，
   * 门禁据此告警——它是个固定数字，不代表任何时刻的真实汇率。
   *
   * @param {object|null} prev 上一版 meta.fx
   * @param {object|null} next 本次 normalize 的结果（失败时为 null）
   * @param {{now: () => Date}} ctx
   */
  merge(prev, next, ctx) {
    if (next) return next;
    if (prev) return { ...prev, stale: true, fetched_at: ctx.now().toISOString() };
    return {
      USDCNY: 7.1,
      as_of: 'fallback',
      source: 'fallback',
      fetched_at: ctx.now().toISOString(),
    };
  },

  /** 门禁：汇率必须在合理区间内；回退到固定值要能看出来。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'fx-range',
        check: (fx) => {
          if (fx?.source === 'fallback') return { level: 'warn', message: '汇率回退到固定值 7.1' };
          const rate = Number(fx?.USDCNY);
          if (!Number.isFinite(rate) || rate < 5 || rate > 10) {
            return { level: 'red', message: `汇率不在合理区间：${fx?.USDCNY}` };
          }
          return { level: 'ok' };
        },
      },
    ],
  },
};
