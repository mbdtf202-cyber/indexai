/**
 * events 层：AI 活动（T3.1c10）。
 *
 * 四个源同层：Devpost、Luma、Devfolio、AIOS（本机可选）。
 * 它们**分别抓、分别记账**——一个源挂了不该拖累其它源，这些源的数据量
 * 差两个数量级（Devpost 与 Luma 上百条，Devfolio 只有个位数）。
 *
 * ## 契约扩展：ctx.state
 *
 * 这是唯一需要运行期可变状态的层。Luma 有**有状态封禁**：429 之后继续试探
 * 会把解封时间往后推（实测 +180s 才恢复），所以层必须记住「本次已经冷却多久、
 * 是否该停手」。按 S4.4，层不能持有可变模块级状态——那样同一进程里两次调用
 * 会互相污染，测试也无法重置。
 *
 * 做法：状态经 `ctx.state` 显式传入。层只是把它转交给 `ctx.fetchLuma`，
 * 不自己读写；编排器负责创建、重置与最终读出来写进 `meta.net`。
 * 这样依赖是**声明式的**：看得见、能测、不会跨层串味。
 */

import { mergeSessions } from '../../../lib/merge-strategies.js';

export default {
  id: 'events',
  sources: ['devpost.com/api/hackathons', 'api.lu.ma', 'api.devfolio.co', 'AIOS_OPPORTUNITIES'],
  // 四源并发；Luma 有 geo 预算（6 分钟）与冷却，Devpost 最多翻 40 页
  /** 合并策略（T3.6 · S3.3）：场次型（S3.3）：与上一版里未结束、lastSeen 不超 TTL 的场次取并集。 */
  mergeStrategy: 'sessions',

  budget: { ms: 900_000, requests: 400 },

  /**
   * 四源并发抓取。任一源抛错都收敛成空数组——**单源失败不等于整层失败**。
   *
   * @param {object} ctx
   * @returns {Promise<{devpost: object[], luma: object[], devfolio: object[], aios: object[]}>}
   */
  async fetch(ctx) {
    // AIOS 读仓库外的本机文件，内容不在版本控制里：测试档位跳过，保证回放输出确定
    const aiosPromise = ctx.testProfile ? Promise.resolve([]) : ctx.fetchAios();

    const [devpost, luma, devfolio, aios] = await Promise.all([
      // 包一层：把「这个源挂了」变成空数组 + 一行日志，而不是让 Promise.all 整体 reject
      ctx
        .fetchDevpost()
        .catch((e) => {
          ctx.log(`devpost 失败：${e.message}`, { level: 'warn' });
          return [];
        }),
      ctx.fetchLuma(ctx.state).catch((e) => {
        ctx.log(`luma 失败：${e.message}`, { level: 'warn' });
        return [];
      }),
      ctx.fetchDevfolio().catch((e) => {
        ctx.log(`devfolio 失败：${e.message}`, { level: 'warn' });
        return [];
      }),
      aiosPromise.catch((e) => {
        ctx.log(`aios 失败：${e.message}`, { level: 'warn' });
        return [];
      }),
    ]);

    return { devpost, luma, devfolio, aios };
  },

  /**
   * 归一：四个源拼成一条列表。
   *
   * 顺序与原实现一致（devpost → luma → aios → devfolio），因为后续的
   * 去重与排序在同分时的行为依赖这个顺序（INV-7：输出必须确定）。
   *
   * @param {{devpost: object[], luma: object[], devfolio: object[], aios: object[]}} raw
   */
  normalize(raw) {
    const records = [
      ...(raw?.devpost || []),
      ...(raw?.luma || []),
      ...(raw?.aios || []),
      ...(raw?.devfolio || []),
    ];
    return {
      records,
      quarantined: records.length ? [] : [{ reason: '四个源都没有活动' }],
    };
  },

  /**
   * 合并：**场次型并集**（T3.6 · S3.3 · F38）。
   *
   * 旧实现是「本次有就用本次」——Luma 只拿到一半时活动数直接腰斩，
   * 读者看到的是「今天活动少了」，而不是「今天有个源没跑完」。这是 F38。
   *
   * 现在与上一版里**未结束**且 lastSeen 不超过 TTL（3 天）的场次取并集：
   * - 已结束的场次不留（既不在时间轴上，也不该占搜索位置）；
   * - 连着 3 天没再出现的场次视为下架，丢掉。
   *
   * @param {object[]|null} prev
   * @param {object[]} next
   * @param {object} ctx 需要 today
   */
  merge(prev, next, ctx) {
    return mergeSessions(prev, next, { today: ctx.today(), ttlDays: 3 });
  },

  /** 门禁：一个活动都没有通常是全源失败；量级门槛由 health.mjs 的分源规则管。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'events-not-empty',
        check: (rows) => {
          const list = Array.isArray(rows) ? rows : [];
          if (!list.length) return { level: 'warn', message: '没有任何活动' };
          return { level: 'ok' };
        },
      },
    ],
  },
};
