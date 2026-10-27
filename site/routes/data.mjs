/**
 * 按路由准备视图数据（T5.2 · S9.2）。
 *
 * ## 为什么不是「每个页面都吃 data.json」
 *
 * 完整的 `data.json` 是 146 KB。给「方法」页加载 461 个模型的价格，
 * 只为了渲染几段说明文字——那是浪费，而且首屏会明显变慢。
 *
 * 这个模块把「路由声明需要什么」翻译成「给渲染函数喂什么」：
 *
 * | `route.data` | 给什么 |
 * |---|---|
 * | `home` | 首页摘要（变化、最新情报、top 模型） |
 * | `models` | 模型列表 + 厂商顺序 |
 * | `bench` | 榜单 |
 * | `relays` | 中转站 |
 * | `all` | 完整数据（订阅 / 免费 / 活动 / 工具 / 信号 / 方法） |
 *
 * 构建期在 Node 里跑，浏览器端不需要它——预渲染已经把 HTML 写好了。
 */

/** 从完整数据里取首页要的子集。 */
export function homeData(full, changes) {
  const models = Array.isArray(full?.models) ? full.models : [];
  const boards = full?.bench?.boards || {};

  /* top 模型：按「出现的榜数」排，同数按价格升序。
   * 不是按分数——各榜量纲不同，加权平均出来的数字没有意义。 */
  const appear = new Map();
  for (const board of Object.values(boards)) {
    for (const row of board?.rows || []) {
      if (!row?.model) continue;
      appear.set(row.model, (appear.get(row.model) || 0) + 1);
    }
  }

  const topModels = models
    .filter((m) => appear.has(m.name))
    .sort((a, b) => {
      const d = (appear.get(b.name) || 0) - (appear.get(a.name) || 0);
      if (d !== 0) return d;
      return (a.input ?? 1e9) - (b.input ?? 1e9);
    })
    .slice(0, 12);

  const latestNews = Array.isArray(full?.news) ? full.news.slice(0, 8) : [];

  return {
    latestNews,
    recentChanges: (changes?.events || []).slice(0, 20),
    topModels,
    benchmarks: Object.entries(boards)
      .slice(0, 3)
      .map(([id, b]) => ({ id, title: b?.title || id, rows: (b?.rows || []).slice(0, 5) })),
  };
}

/**
 * 给一个路由准备数据。
 *
 * @param {string} kind route.data 的值
 * @param {object} full 完整数据
 * @param {object} [extra] 变化数据等
 * @returns {object}
 */
export function dataFor(kind, full, extra = {}) {
  switch (kind) {
    case 'home':
      return homeData(full, extra.changes);
    case 'models':
      return { ...full, vendorOrder: full?.meta?.vendorOrder || [] };
    case 'bench':
      return { ...full, bench: full?.bench ?? extra.bench };
    case 'relays':
      return { ...full, relays: full?.relays || [] };
    default:
      return full || {};
  }
}
