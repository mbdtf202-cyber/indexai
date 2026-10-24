/**
 * news 层：三路情报源 + 只增不删的归档（T3.1c4）。
 *
 * 这是第一个**读写仓库文件**的层，也是最容易把边界弄糊的一个：
 * 归档（news-archive.json）要读上一版、合并、再写回去。按契约层不碰文件系统，
 * 所以归档的读写由编排器经 `ctx.archive.read()` / `ctx.archive.write()` 注入。
 * 层只负责「三路抓什么、怎么并、怎么算新鲜度」。
 *
 * 三路源的分工（与既有实现一致）：
 * - frontline：官方精选，每天约 50 条，摘要最全 → 合并时优先级最高
 * - aihot：全量流，按分类逐个翻页 → 分类用源站标签兜底
 * - seed：存档补回的早期条目（可选文件）
 */

const AIHOT_CATEGORY = {
  'ai-models': 'model',
  'ai-products': 'product',
  industry: 'funding',
  paper: 'research',
  tip: 'other',
};

/**
 * 统一成一条记录。
 * @param {{date?: string, time?: string, title?: string, summary?: string, url?: string}} x
 */
function toRow(x) {
  return { date: x.date, time: x.time, title: x.title, summary: x.summary, url: x.url };
}

export default {
  id: 'news',
  sources: ['data.aibijia.org/news-frontline.yaml', 'aihot.news/api/v1/items'],
  budget: { ms: 300_000, requests: 250 },

  /**
   * 抓三路源。任一路失败**不拖累其它两路**——只有三路全空才算这一层失败。
   *
   * @param {object} ctx
   * @returns {Promise<{frontline: object[], bulk: object[], seed: object[]}>}
   */
  async fetch(ctx) {
    const [frontline, bulk, seed] = await Promise.all([
      this.fetchFrontline(ctx),
      this.fetchBulk(ctx),
      ctx.readSeed(),
    ]);
    return { frontline, bulk, seed };
  },

  /** 官方精选：每天约 50 条，摘要最全，优先用它 */
  async fetchFrontline(ctx) {
    try {
      const res = await ctx.http.text(ctx.urls.frontline, { label: 'news/frontline' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = ctx.parseYaml(res.text);
      ctx.log(`frontline ${rows.length} 条`);
      return rows;
    } catch (e) {
      // 单路失败只记日志，交给上层看「有没有新条目」而不是「这一路成不成」
      ctx.log(`frontline 失败：${e.message}`, { level: 'warn' });
      return [];
    }
  },

  /**
   * 全量流：window 只接受 24h / 7d，游标翻页。
   * mode=all 才给全部；selected 只给人工精选的 50 条。
   * 分类之间不重叠，所以要逐个分类翻，不然会漏掉一大半。
   */
  async fetchBulk(ctx) {
    const cats = [null, 'ai-models', 'ai-products', 'industry', 'paper', 'tip'];
    const seen = new Map();
    let requests = 0;

    // 测试档位只翻主分类的第 1 页：够覆盖解析与去重，又不拉整个 7 天窗口
    const catsToFetch = ctx.testProfile ? [null] : cats;
    const maxPages = ctx.testProfile ? 1 : 40;

    for (const cat of catsToFetch) {
      let cursor = null;
      for (let page = 0; page < maxPages; page += 1) {
        const url = new URL(ctx.urls.aihot);
        url.searchParams.set('window', '7d');
        url.searchParams.set('mode', 'all');
        if (cat) url.searchParams.set('category', cat);
        if (cursor) url.searchParams.set('cursor', cursor);
        let d;
        try {
          const res = await ctx.http.get(url, { label: `news/aihot${cat ? `/${cat}` : ''}` });
          requests += 1;
          if (!res.ok) break;
          d = await res.json();
        } catch {
          break;
        }
        for (const it of d.items || []) {
          if (!it.id || !it.title) continue;
          const pub = it.publishedAt || it.discoveredAt || '';
          seen.set(it.id, {
            date: pub.slice(0, 10),
            time: pub.slice(11, 16),
            title: it.title,
            summary: it.summary || '',
            url:
              ctx.keepSafeUrl(it.link || `https://aihot.news/items/${it.id}`, 'news:aihot') ?? '',
            cat: it.category || null,
          });
        }
        if (!d.page?.hasMore || !d.page.nextCursor) break;
        cursor = d.page.nextCursor;
        await ctx.sleep(250);
      }
      await ctx.sleep(250);
    }
    ctx.log(`aihot 全量 ${seen.size} 条 / ${requests} 次请求`);
    return [...seen.values()];
  },

  /**
   * 归一：三路合并成待并入归档的 fresh 列表。
   * 精选在前，合并时它的摘要不会被全量流的短版覆盖。
   * @param {{frontline: object[], bulk: object[], seed: object[]}} raw
   */
  normalize(raw) {
    const fresh = [
      ...(raw?.frontline || []).map(toRow),
      ...(raw?.bulk || []).map((x) => ({
        ...toRow(x),
        topic: AIHOT_CATEGORY[x.cat] || undefined,
      })),
      ...(raw?.seed || []).map(toRow),
    ];
    // 三路全空才算「没抓到」——单路失败不该让整层判定为空
    const quarantined = fresh.length ? [] : [{ reason: '三路源都没有可用条目' }];
    return { records: fresh, quarantined };
  },

  /**
   * 并入归档。
   *
   * 返回的是**合并后的归档**（只增不删），以及本次真正新增的条数。
   * `freshCount` 让上层能判断「情报层是否新鲜」——三路源全挂时归档照样很大，
   * 只看归档大小会被骗（F09）。
   *
   * @param {object[]|null} prev 上一版归档
   * @param {object[]} next 本次 fresh
   * @param {object} ctx 需要 ctx.archive、ctx.mergeArchive、ctx.today
   */
  merge(prev, next, ctx) {
    const archive = Array.isArray(prev) ? prev : [];
    const before = archive.length;
    const merged = ctx.mergeArchive(archive, next || [], { today: ctx.today() });
    const freshCount = merged.length - before;

    ctx.log(`news 归档 ${before} → ${merged.length} 条（新增 ${freshCount}）`);

    // 不可枚举的元信息：不改 JSON 形态（golden 逐字节不受影响），
    // 但让编排器能看见「本次到底抓到了没有」
    Object.defineProperty(merged, '__freshCount', { value: freshCount, enumerable: false });
    return merged;
  },

  /** 门禁：新鲜度与跨度由 health.mjs 的既有逻辑负责，这里只报 obvious 问题。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'news-not-empty',
        check: (archive) => {
          const list = Array.isArray(archive) ? archive : [];
          if (!list.length) return { level: 'red', message: '归档为空' };
          return { level: 'ok' };
        },
      },
    ],
  },
};
