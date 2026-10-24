/**
 * 外链白名单（S10.2 · INV-14 · F46）。
 *
 * 全项目只此一处判定「这个地址能不能放进 href / src」。
 * HTML 转义解决的是「引号逃逸」，**不解决协议本身可执行**：
 * `javascript:alert(1)` 完全不需要引号就能跑，`data:text/html,<script>` 同理。
 * 所以渲染前必须过这里，不安全的当纯文本处理，而不是加个属性糊过去。
 *
 * 规则只有一条：**绝对地址，且协议是 http 或 https**。
 * - 相对地址不放行：外链场景下它几乎一定是拼错的或攻击者构造的；
 * - 前后空白与大小写先归一，` JAVASCRIPT:` 与 `javascript:` 是同一件事；
 * - 不追加重定向校验（那是 lib/http.js 的事），这里只管「这个字符串能不能用」。
 */

/** 允许的协议白名单。刻意写死，不接受调用方扩展。 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * 这个字符串能不能安全地放进 href/src。
 * @param {unknown} input
 * @returns {boolean}
 */
export function isSafeUrl(input) {
  return safeUrl(input) !== null;
}

/**
 * 归一化并校验；不通过返回 null。
 *
 * 返回的是 `URL#href`（协议与主机名小写、路径保持原样），
 * 这样同一个地址在页面上只有一种写法，也便于做去重键。
 * @param {unknown} input
 * @returns {string|null}
 */
export function safeUrl(input) {
  if (typeof input !== 'string') return null;

  // 先去掉前后空白：` javascript:` 在浏览器里照样会被当成脚本执行
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 浏览器会把制表符与换行从 URL 里剔除，`java\tscript:` 依然可执行。
  // 这里一并剔除，避免「看起来不是 javascript:，其实是」的情况。
  const cleaned = trimmed.replace(/[\t\n\r]/g, '');
  if (!cleaned) return null;

  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    // 相对地址、空协议、乱七八糟的字符串都落到这里
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  // 只要主机名：`http://` 后面什么都没有的地址不能当外链
  if (!parsed.hostname) return null;

  return parsed.href;
}

/**
 * 渲染用：安全就返回地址，不安全返回 null，由调用方决定渲染成纯文本。
 * 与 safeUrl 同义，名字更贴合模板里的用法。
 * @param {unknown} input
 * @returns {string|null}
 */
export function hrefOrNull(input) {
  return safeUrl(input);
}
