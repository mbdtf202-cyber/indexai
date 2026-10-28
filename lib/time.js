/**
 * 时间口径（T3.4 · F13 · S2.2）。
 *
 * ## 各源的时间到底是什么时区（用回放数据实测，2026-10-26）
 *
 * | 源 | 字段 | 格式 |
 * |---|---|---|
 * | Luma | `start_at` / `end_at` + `timezone` | **UTC ISO**（`2026-11-05T00:00:00.000Z`）+ IANA 时区名 |
 * | Devfolio | `starts_at` / `ends_at` | **UTC ISO**，**没有**时区字段 |
 * | AIHOT | `publishedAt` / `discoveredAt` | **UTC ISO** |
 * | Devpost | `submission_period_dates` | 纯文本日期（`Oct 05 - 25, 2026`），无时区 |
 *
 * ## 为什么不能直接 `slice(0, 10)`
 *
 * 东京 19:00 开始的场次，UTC 是当天 10:00 —— 取前 10 位恰好还是同一天，看着没问题。
 * 但**悉尼 09:00** 的场次 UTC 是前一天 23:00，取前 10 位就变成前一天；
 * 洛杉矶 23:00 的场次 UTC 是次日 07:00，取前 10 位就变成次日。两头都会错。
 *
 * 正确做法：按**活动所在时区**算出本地日期。活动没给时区时（Devfolio），
 * 用源的地理信息兜底，再不行就按 UTC 记（并标 `tz: null`，让页面知道这是估算）。
 */

/** 一天的毫秒数。 */
const DAY = 86_400_000;

/** 默认时区：本站的主要读者在东八区。 */
export const SITE_TZ = 'Asia/Shanghai';

/**
 * 把一个时刻按给定时区格式化成 `YYYY-MM-DD`。
 *
 * @param {string|number|Date|null} at ISO 字符串、时间戳或 Date
 * @param {string|null} tz IANA 时区名；null / 非法时按 UTC
 * @returns {string|null} 无法解析时返回 null（不编造日期）
 */
export function localDate(at, tz) {
  if (at == null || at === '') return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;

  // 已经是「纯日期」字符串（Devpost 那种）就没必要再换算
  if (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at;

  const zone = tz || 'UTC';
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA 给 YYYY-MM-DD
    return fmt.format(d);
  } catch {
    // 非法时区名：退回 UTC，不猜
    return d.toISOString().slice(0, 10);
  }
}

/**
 * 某个时刻在给定时区里「是几号」——用来判定活动的「今天」。
 *
 * 与 `localDate` 的区别：这个函数存在的意义是让调用方明确「我在按哪个时区的日历看」。
 *
 * @param {string|number|Date|null} at
 * @param {string|null} tz
 * @returns {string|null}
 */
export function localToday(at, tz) {
  return localDate(at, tz);
}

/**
 * 两个日期字符串之间差几天（`b - a`）。
 *
 * 只做日期相减（都按 UTC 零点），避开夏令时把 23 小时算成「差 0 天」的坑。
 *
 * @param {string} a `YYYY-MM-DD`
 * @param {string} b `YYYY-MM-DD`
 * @returns {number|null}
 */
export function daysBetween(a, b) {
  const ta = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round((tb - ta) / DAY);
}

/**
 * 把 UTC ISO 拆成「本地日期 + 时刻」，给页面显示用。
 *
 * @param {string|null} at ISO
 * @param {string|null} tz
 * @returns {{date: string, time: string}|null}
 */
export function localDateTime(at, tz) {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const zone = tz || 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}:${get('minute')}`,
    };
  } catch {
    return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
  }
}
