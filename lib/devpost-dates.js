/**
 * Devpost 的 `submission_period_dates` 解析（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * 三种写法都要认：
 *   "Oct 05 - Nov 12, 2026"   跨月
 *   "Oct 05 - 27, 2026"       同月，结束日只有日号
 *   "Oct 23, 2026"            单日活动（实测 192 条里 37 条，占 19%）
 * 旧实现漏了第三种，一批真实活动因此从 open/upcoming 里消失。
 */

export function parseDevpostDates(s) {
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const str = String(s || '');
  const iso = (y, mo, d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);

  // 拆出所有 (月份, 日, 年份?) 片段，按出现顺序
  const re = /\b([A-Z][a-z]{2})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/g;
  const parts = [];
  let m;
  while ((m = re.exec(str))) {
    const mo = MONTHS[m[1]];
    if (mo == null) continue;
    parts.push({ mo, day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  }
  if (!parts.length) return { start: null, end: null };

  // 末尾单独的年份（"Oct 05 - Nov 12, 2026" 的年份会挂到最后一段上）
  const tail = str.match(/,\s*(\d{4})\s*$/);
  const tailYear = tail ? Number(tail[1]) : null;

  // "Oct 05 - 27, 2026"：只有孤立的日号，结束日继承起点的月
  // 单日活动（"Oct 23, 2026"）走同一个分支但**没有** `-`，旧实现拿不到 bare 就直接
  // return null，把 37 条源里明明带日期的活动判成「未知」。实测 Devpost 192 条里
  // 单日格式就有 37 条，占 19%，一批真实活动因此从 open/upcoming 里消失。
  if (parts.length === 1) {
    const bare = str.match(/-\s*(\d{1,2})(?:,\s*(\d{4}))?\s*$/);
    if (!bare) {
      // 单日活动：start = end = 当天
      const y = parts[0].year ?? tailYear;
      if (y == null) return { start: null, end: null };
      const day = iso(y, parts[0].mo, parts[0].day);
      return { start: day, end: day };
    }
    const y = Number(bare[2]) || parts[0].year || tailYear;
    if (y == null) return { start: null, end: null };
    const a = parts[0];
    return { start: iso(y, a.mo, a.day), end: iso(y, a.mo, Number(bare[1])) };
  }

  const a = { ...parts[0] };
  const b = { ...parts[1] };
  // 年份补全：自身 > 尾随年份 > 另一端
  if (b.year == null) b.year = tailYear ?? a.year;
  if (a.year == null) a.year = b.year ?? tailYear;
  if (a.year == null && b.year == null) return { start: null, end: null };

  // 跨年纠正：起点月晚于终点月且只有终点带年份，说明起点在上一年
  let y1 = a.year;
  const y2 = b.year;
  if (y1 == null) y1 = y2;
  if (y2 != null && a.mo > b.mo && y1 >= y2) y1 = y2 - 1;

  return { start: iso(y1, a.mo, a.day), end: iso(y2 ?? y1, b.mo, b.day) };
}

