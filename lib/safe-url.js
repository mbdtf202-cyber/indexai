/**
 * 外链白名单的采集侧包装（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * `lib/url.js` 的 `safeUrl` 是纯函数；这里补的是「被挡下时要可观测」（INV-4、INV-14）：
 * 丢弃计数与样例进 `meta.dropped.unsafeUrl`，页面与排障都能看到。
 *
 * 为什么在 normalize 阶段就丢，而不是留到页面再挡：
 * 下游去重键、情报归档都拿 url 当主键，脏 url 会污染这些不变量。
 */

import { safeUrl } from './url.js';

/** 被丢弃的不安全外链计数（模块级：一次采集内累加，编排器读完写进 meta）。 */
const unsafeUrl = { dropped: 0, samples: [] };

/** 过一遍外链白名单。不安全时记一次并返回 null，调用方据此丢掉整行。 */
export function keepSafeUrl(u, where) {
  const ok = safeUrl(u);
  if (ok) return ok;
  unsafeUrl.dropped += 1;
  if (unsafeUrl.samples.length < 5) {
    unsafeUrl.samples.push({ where, url: String(u ?? '').slice(0, 120) });
  }
  return null;
}

/** 读取当前计数（编排器写 meta 用）。 */
export function unsafeUrlStats() {
  return { dropped: unsafeUrl.dropped, samples: unsafeUrl.samples.slice() };
}

/** 重置计数（测试用；也用于一次采集开始前清账）。 */
export function resetUnsafeUrlStats() {
  unsafeUrl.dropped = 0;
  unsafeUrl.samples.length = 0;
}
