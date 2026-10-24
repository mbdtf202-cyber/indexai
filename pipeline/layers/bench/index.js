/**
 * bench 层：9 个公开评测源（T3.1c5）。
 *
 * 这一层特殊的地方在于：**重活已经在 `bench.mjs` 里做完了**。
 * 那里有 12 个榜的解析器、逐源回退、LMArena parquet 读取，两千多行。
 * 层的职责不是重写它，而是把它的输出**包成契约形状**：
 * 让编排器只认 `fetch` / `normalize` / `merge` / `health`，不关心里面有几个源。
 *
 * 因此这里刻意很薄——薄到一眼能看完。如果哪天 bench.mjs 被拆成多个文件，
 * 这个层的工作量不会跟着涨。
 */

export default {
  id: 'bench',
  sources: [
    'lmarena.ai',
    'swebench.com',
    'aider.chat',
    'tbench.ai',
    'taubench.com',
    'vals.ai',
    'arcprize.org',
    'simple-bench.com',
    'artificialanalysis.ai',
  ],
  // 12 个榜、其中 LMArena 要下 parquet：预算给得宽，但仍是有限值
  budget: { ms: 600_000, requests: 120 },

  /**
   * 抓取并归一。`bench.mjs` 的 `fetchBenchmarks(prev)` 已经做了逐源并发、
   * 逐源失败沿用旧榜（F02），这里只是转手。
   *
   * @param {{fetchBenchmarks: Function, prev: object|null}} ctx
   * @returns {Promise<object>}
   */
  async fetch(ctx) {
    return ctx.fetchBenchmarks(ctx.prev);
  },

  /**
   * 归一：确认关键字段齐备。缺 `boards` 或 `stats` 说明上游结构变了。
   * @param {object} raw
   */
  normalize(raw) {
    if (!raw || typeof raw !== 'object') {
      return { records: null, quarantined: [{ reason: 'eval 返回空' }] };
    }
    if (!raw.stats || typeof raw.stats !== 'object') {
      return { records: null, quarantined: [{ reason: '缺少 stats' }] };
    }
    return { records: raw, quarantined: [] };
  },

  /**
   * 合并：本次一个榜都没有时沿用上一版。
   *
   * 注意这里**刻意粗粒度**：逐源沿用已经在 `fetchBenchmarks` 内部做了
   * （`oldBoardsFor`）。到这一层还剩下「整层 0 个榜」这一种情况，
   * 那说明所有源都挂了——此时整份沿用上一版快照是对的。
   *
   * @param {object|null} prev 上一版 bench.json
   * @param {object|null} next
   */
  merge(prev, next) {
    const hasNext = next?.stats?.boards > 0;
    if (hasNext) return next;
    if (prev?.stats?.boards > 0) return { ...prev, stale: true };
    return next || null;
  },

  /** 门禁：榜数与源数都在 health.mjs 的层级门禁里管，这里只报结构性问题。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'bench-structure',
        check: (v) => {
          if (!v?.stats) return { level: 'red', message: '评测快照缺 stats' };
          if (!v.stats.boards) return { level: 'red', message: '一个榜都没有' };
          if (!Array.isArray(v.boards)) return { level: 'warn', message: '缺少 boards 明细' };
          return { level: 'ok' };
        },
      },
    ],
  },
};
