/**
 * 主机策略表（T3.2 · S2.1 · INV-8）。
 *
 * 每个上游的「怎么请求才不会被封」都不同，这些数字是线上实测出来的，不是猜的：
 *
 * - **Luma** 有状态封禁：并发就会被封，封后约 3 分钟才解。所以并发 1、间隔 900 ms、
 *   冷却 180 s，且冷却累计有 6 分钟上限（超过就停手，见 sources/luma.mjs）。
 * - **Devpost / Devfolio / HF** 并发 2 足够，再高会被判为爬虫。
 * - **GitHub** 并发 4 在限流边缘，但 unauthenticated 时仍然要慢。
 * - **AIHOT / HN** 是公开查询接口，间隔 250 / 120 ms 已足够客气。
 * - **中转站**：全局并发 5，但**同一站只许 1**——一个站连着打两个请求，
 *   轻则 429 重则直接封 IP。
 *
 * 层代码里**不该再出现 sleep**：排队与限速都由这里负责。层说「我要请求这个 URL」，
 * 什么时候发、隔多久发，是策略表与 http.js 的事。
 */

/** 默认值：未登记的站点按这个来。 */
export const DEFAULT_POLICY = { concurrency: 4, minGapMs: 0, cooldownMs: 0, cooldownCapMs: 0 };

/**
 * 主机 → 策略。
 *
 * 键是 hostname（`bucket()` 用的那个），不是完整 URL。
 * @type {Record<string, {concurrency: number, minGapMs: number, cooldownMs?: number, cooldownCapMs?: number}>}
 */
export const HOST_POLICY = {
  'api.lu.ma': { concurrency: 1, minGapMs: 900, cooldownMs: 180_000, cooldownCapMs: 360_000 },
  'lu.ma': { concurrency: 1, minGapMs: 900, cooldownMs: 180_000, cooldownCapMs: 360_000 },
  'devpost.com': { concurrency: 2, minGapMs: 0 },
  'api.devfolio.co': { concurrency: 2, minGapMs: 0 },
  'huggingface.co': { concurrency: 2, minGapMs: 0 },
  'api.github.com': { concurrency: 4, minGapMs: 0 },
  'aihot.news': { concurrency: 1, minGapMs: 250 },
  'hn.algolia.com': { concurrency: 1, minGapMs: 120 },
  'data.aibijia.org': { concurrency: 2, minGapMs: 200 },
  'openrouter.ai': { concurrency: 2, minGapMs: 300 },
  'open.er-api.com': { concurrency: 1, minGapMs: 0 },

  /* 中转站是通配：每个站的 /api/pricing 都要一个独立名额，
   * 靠下面 isRelayHost() 判定，而不是逐个列站名（名单每天变）。 */
};

/** 中转站的默认策略：全局并发 5，单站 1。 */
export const RELAY_POLICY = { concurrency: 1, minGapMs: 0 };

/** 该主机是不是中转站（不在册名单里、但走 `/api/pricing` 的那些域）。 */
export function isRelayHost(host) {
  if (!host) return false;
  if (HOST_POLICY[host]) return false;
  // 中转站名单由 curated/relays.json 提供，编排器会把域名经 registerRelayHosts 注册进来
  return registeredRelayHosts.has(host);
}

const registeredRelayHosts = new Set();

/** 编排器启动时把 curated/relays.json 的域名注册进来。 */
export function registerRelayHosts(hosts) {
  registeredRelayHosts.clear();
  for (const h of hosts || []) {
    const host = String(h || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (host) registeredRelayHosts.add(host);
  }
}

/** 取某个主机的策略（中转站走 RELAY_POLICY，其余走表，未登记的走默认）。 */
export function policyFor(host) {
  if (!host) return DEFAULT_POLICY;
  const hit = HOST_POLICY[host];
  if (hit) return { ...DEFAULT_POLICY, ...hit };
  if (registeredRelayHosts.has(host)) return { ...DEFAULT_POLICY, ...RELAY_POLICY };
  return DEFAULT_POLICY;
}

/** 全部已登记的主机（排障与报告用）。 */
export function knownHosts() {
  return [...new Set([...Object.keys(HOST_POLICY), ...registeredRelayHosts])].sort();
}
