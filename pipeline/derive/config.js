/**
 * Derive 侧的站点常量。
 *
 * 唯一消费者是 `generate-feed.js` / `changes.js`：Atom 的 `self`、`alternate` 链接
 * 与 `tag:` 形式的条目 id 需要绝对地址与 host。
 *
 * 站点地址的唯一来源是 `package.json` 的 `homepage`（S9.9 / F52），
 * 这里不存第二份手抄值，直接从 `lib/config.js` 转出。
 */

export { BASE_URL, HOST, SITE } from '../../lib/config.js';
