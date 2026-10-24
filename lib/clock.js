/**
 * 时钟与睡眠的唯一出口（UPGRADE_PLAN S2.2 · INV-7 · R2b）。
 *
 * 采集端所有「取当前时间」与「等待」都必须经过这里：
 * - `INDEXAI_NOW` 设定时，`now()` 固定返回该时刻，输出才可复现。
 * - `INDEXAI_HTTP=replay` 时，`sleep()` 立即返回，并把请求的总时长累加起来，
 *   供测试断言「某段逻辑想要的等待是否被上界约束」（T1.3 用）。
 *
 * 浏览器端有独立出口 `site/client/clock.js`（T5.2 建立），两者互不引用。
 */

/** 回放模式检测：只看环境变量，不猜运行上下文。 */
export function isReplay() {
  return String(process.env.INDEXAI_HTTP || '').toLowerCase() === 'replay';
}

/** 解析固定的当前时刻；未设置返回 null。 */
function fixedNow() {
  const raw = process.env.INDEXAI_NOW;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`INDEXAI_NOW 不是合法时间：${raw}`);
  }
  return d;
}

/**
 * 当前时刻。固定时钟下每次都返回同一毫秒。
 * @returns {Date}
 */
export function now() {
  const fixed = fixedNow();
  return fixed ? new Date(fixed.getTime()) : new Date();
}

/** 当前时刻的 ISO 字符串。 */
export function nowISO() {
  return now().toISOString();
}

/**
 * 今天（YYYY-MM-DD）。默认按 UTC 取，与旧行为一致：
 * 旧代码大量使用 `new Date().toISOString().slice(0, 10)`。
 * @param {string} [tz] IANA 时区，例如 'Asia/Shanghai'；省略即 UTC
 */
export function todayISO(tz) {
  const d = now();
  if (!tz) return d.toISOString().slice(0, 10);
  // 用 Intl 拿到目标时区的本地日期，避免手算偏移
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d);
}

/** 毫秒计时起点。固定时钟下多次调用返回同一值，耗时为 0。 */
export function mark() {
  return isReplay() ? 0 : Date.now();
}

/** 从 mark() 到现在经过的毫秒数。回放模式恒为 0。 */
export function since(startMark) {
  if (isReplay()) return 0;
  return Date.now() - startMark;
}

/* ────────────────────────── 睡眠 ────────────────────────── */

/** 被请求的睡眠总时长（毫秒）。回放模式下累加，用于断言上界。 */
let requestedSleepMs = 0;

/** 读取并清零累计的睡眠请求量。 */
export function takeRequestedSleepMs() {
  const v = requestedSleepMs;
  requestedSleepMs = 0;
  return v;
}

/** 只读当前累计值，不清零。 */
export function peekRequestedSleepMs() {
  return requestedSleepMs;
}

/** 重置计数器（测试用）。 */
export function resetSleepCounter() {
  requestedSleepMs = 0;
}

/**
 * 睡眠指定毫秒。
 *
 * 回放模式不真的等待，只记账 —— 让测试既确定又快，
 * 同时保留「这段代码本来打算睡多久」的可观测性。
 * @param {number} ms
 */
export async function sleep(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return;

  requestedSleepMs += n;
  if (isReplay()) return;

  await new Promise((resolve) => setTimeout(resolve, n));
}

/** 默认导出，方便 `import clock from '../lib/clock.js'`。 */
export default { now, nowISO, todayISO, mark, since, sleep, isReplay };
