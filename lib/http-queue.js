/**
 * 每主机的排队闸（T3.2 · INV-8）。
 *
 * 层代码里不再出现 sleep：什么时候能发由这里决定。
 * 两级限制：
 *   - concurrency：同一主机同时在途的请求数上限
 *   - minGapMs：两次请求之间的最小间隔（上一个发起的时刻起算）
 *
 * 状态是模块级的：一次采集只有一个进程，请求天然串成一条线。
 * 拆成独立模块是为了让 http.js 只关心「一次请求怎么做」、
 * 这里只关心「什么时候轮到它」。
 */

import { policyFor } from './http-policy.js';
import { sleep } from './clock.js';

const hostQueue = new Map();

function queueState(host) {
  let q = hostQueue.get(host);
  if (!q) {
    q = { inFlight: 0, waiters: [], lastAt: 0 };
    hostQueue.set(host, q);
  }
  return q;
}

/** 等到本主机允许发下一个请求（拿到名额 + 满足最小间隔）。 */
export async function acquire(host) {
  const policy = policyFor(host);
  const q = queueState(host);

  // 名额满了就排队
  while (q.inFlight >= policy.concurrency) {
    await new Promise((resolve) => q.waiters.push(resolve));
  }
  q.inFlight += 1;

  // 最小间隔：从上一个请求发起的时刻算
  if (policy.minGapMs > 0) {
    const wait = q.lastAt + policy.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
  }
  q.lastAt = Date.now();
}

/** 归还名额并把下一个等着的放进来。 */
export function release(host) {
  const q = queueState(host);
  q.inFlight = Math.max(0, q.inFlight - 1);
  const next = q.waiters.shift();
  if (next) next();
}

/** 重置所有主机的排队状态（测试用）。 */
export function resetHttpQueues() {
  hostQueue.clear();
}
