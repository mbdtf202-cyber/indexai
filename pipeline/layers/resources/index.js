/**
 * toolkit 层：精选工具箱，星数与最近推送按 GitHub 校准（T3.1c3）。
 *
 * 这是第一个**逐条请求**的层：人工名单里每个 repo 发一次 API 请求。
 * 因此它也是第一个真正用上 `budget.requests` 的层——预算不是摆设：
 * 名单变长到几百条时，这里必须能提前停下并交出部分结果，而不是把 CI 拖死。
 *
 * 层的边界（INV-11）：不读文件、不直接 fetch、不碰 Date.now()。
 * 人工名单与请求头由编排器经 ctx 注入（名单来自 curated/toolkit.json）。
 */

/** GitHub API 基址。 */
export const API_BASE = 'https://api.github.com/repos';

export default {
  // id 与既有数据键一致：meta.collect 与 data.resources 都叫这个
  id: 'resources',
  sources: ['api.github.com/repos'],
  // 90ms 节流 + 逐条请求：60 条名单约 6 秒。预算取宽松值，超了交部分结果。
  /** 合并策略（T3.6 · S3.3）：人工型（S3.3）：直接读 curated/，校验到期日。 */
  mergeStrategy: 'curated',

  budget: { ms: 90_000, requests: 200 },

  /**
   * 逐条抓仓库元数据。
   *
   * 每条失败**不中断整层**：把 status 记在行上继续下一条。
   * 「20 条里 3 条 404」是有用信息，比整层 failed 好得多。
   *
   * @param {{http: object, curated: {toolkit: object[]}, testProfile: boolean, now: Function}} ctx
   * @returns {Promise<object[]>}
   */
  async fetch(ctx) {
    const list = ctx.curated?.toolkit || [];
    // 测试档位只取前三条：回放数据不必覆盖全部 21 条
    const targets = ctx.testProfile ? list.slice(0, 3) : list;
    const headers = { ...(ctx.githubHeaders || {}) };

    const out = [];
    for (const item of targets) {
      const row = { ...item };
      try {
        const res = await ctx.http.get(`${API_BASE}/${item.repo}`, {
          headers,
          label: `github/${item.repo}`,
        });
        if (!res.ok) {
          out.push({ ...row, status: `http_${res.status}` });
        } else {
          const j = await res.json();
          out.push({
            ...row,
            desc: j.description || '',
            stars: j.stargazers_count ?? null,
            forks: j.forks_count ?? null,
            updated: (j.pushed_at || '').slice(0, 10),
            license: j.license?.spdx_id || null,
            archived: !!j.archived,
            lang: j.language || null,
            topics: Array.isArray(j.topics) ? j.topics.slice(0, 6) : [],
            url: j.html_url,
            status: 'ok',
          });
        }
      } catch (e) {
        out.push({ ...row, status: 'error', error: e.message });
      }
    }
    // 按人工排序（谁更值得先看），不按星数
    return out;
  },

  /**
   * 归一：补上展示用的 useLabel，隔离没有 repo 的条目。
   * @param {object[]} raw
   * @param {{useLabel: Record<string,string>}} ctx
   */
  normalize(raw, ctx) {
    const records = [];
    const quarantined = [];
    for (const item of raw || []) {
      if (!item || !item.repo) {
        quarantined.push({ reason: '缺 repo 字段' });
        continue;
      }
      // 键序与既有 data.json 一致：useLabel 紧跟 use（在 why 之前）。
      // JSON 键序会进逐字节比对，也会让 diff 里看不出到底改了什么。
      const { id, repo, use, title, why, ...rest } = item;
      records.push({
        id,
        repo,
        use,
        useLabel: ctx.useLabel?.[use] || use || '',
        title,
        why,
        ...rest,
      });
    }
    return { records, quarantined };
  },

  /**
   * 合并：本次某条失败时，用上一版同 repo 的数据补齐。
   *
   * 这一层最容易「悄悄变差」：GitHub 限流时会有一半 repo 拿到 403，
   * 列表看起来还在，但一半的星数变成了 null。所以按 repo 逐条沿用，
   * 而不是整层沿用。
   *
   * @param {object[]|null} prev
   * @param {object[]} next
   */
  merge(prev, next) {
    const before = new Map((prev || []).map((x) => [x.repo, x]));
    return (next || []).map((item) => {
      if (item.status === 'ok') return item;
      const old = before.get(item.repo);
      if (!old || old.status !== 'ok') return item;
      // 保留人工名单里的字段（顺序、use），其余取上一版已验证的值
      return { ...item, ...old, status: 'ok', stale: true };
    });
  },

  /** 门禁：成功的条目太少说明被限流或名单坏了。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'toolkit-calibration',
        check: (rows) => {
          const list = Array.isArray(rows) ? rows : [];
          if (!list.length) return { level: 'red', message: '工具箱为空' };
          const ok = list.filter((x) => x.status === 'ok' && !x.stale).length;
          const ratio = ok / list.length;
          // 阈值取 80%：一半成功意味着「一半的星数是旧值或缺失」，列表已经开始骗人。
          // 用 stale 的条目不算成功——沿用是对的，但不该算作「本次验证过」。
          if (ratio < 0.8) {
            return { level: 'warn', message: `只有 ${ok}/${list.length} 条本次校准成功` };
          }
          return { level: 'ok' };
        },
      },
    ],
  },
};
