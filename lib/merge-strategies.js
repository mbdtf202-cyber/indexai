/**
 * 四种合并策略的实现（T3.6 · S3.3 · F38）。
 *
 * 拆层时最容易丢的就是合并语义：层还在、`merge` 还叫这个名字，
 * 但里面只剩「本次有就用本次，没有就用上次」。那是**整层回退**，不是合并，
 * 后果是部分采集直接把数量打塌（F38：Luma 掉一半 → 活动数掉一半）。
 *
 * 四种策略来自 S3.3：
 *
 * | 策略 | 适用层 | 规则 |
 * |---|---|---|
 * | 目录型 | 模型、中转站、订阅 | 今天没拿到的条目沿用上一版并记 `lastOk`；超过 TTL 才移除 |
 * | 场次型 | 活动 | 与上一版里未结束、`lastSeen` 不超过 3 天的场次取**并集** |
 * | 归档型 | 情报 | 只增不删 |
 * | 人工型 | 额度、官方价、信号、工具箱、大事件 | 直接读 `curated/`，校验到期日 |
 *
 * 这里只放纯函数：不读写文件、不看时钟（`today` 由调用方传 JSON 字符串）。
 * 层拿到它就能保证行为一致，不必各自重写一遍边界条件。
 */

/** 一天的毫秒数。 */
const DAY = 86_400_000;

/**
 * 两个 ISO 日期相差几天（`b - a`）。
 * @param {string} a `YYYY-MM-DD`
 * @param {string} b `YYYY-MM-DD`
 * @returns {number} 无法解析时返回 `Infinity`（视为「太旧」）
 */
function daysBetween(a, b) {
  const ta = Date.parse(`${String(a || '').slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${String(b || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.round((tb - ta) / DAY);
}

/* ────────────────────────── 目录型 ────────────────────────── */

/**
 * 目录型合并：本次没拿到的条目，沿用上一版（带 `lastOk`），超 TTL 才丢。
 *
 * 「没拿到」有两种，处理不同：
 * - 本次**完全没出现**这个 key：源站没给（可能只是这次没翻到）→ 沿用；
 * - 本次出现了但**状态失败**：探测过了但失败 → 沿用旧价并标 stale（只有 relays 有这形态）。
 *
 * @param {object[]} prev 上一版
 * @param {object[]} next 本次
 * @param {{keyOf?: (r: object) => string, ttlDays?: number, today: string, lastOkField?: string}} opt
 * @returns {object[]} 合并结果
 */
export function mergeCatalog(prev, next, opt) {
  const { keyOf = (r) => r.id || r.domain || r.product, ttlDays = 3, today, lastOkField = 'lastOk' } = opt || {};

  const prevList = Array.isArray(prev) ? prev : [];
  const nextList = Array.isArray(next) ? next : [];
  const nextKeys = new Set(nextList.map(keyOf).filter(Boolean));
  const kept = [];

  for (const row of prevList) {
    const key = keyOf(row);
    if (!key || nextKeys.has(key)) continue;

    /* 上次成功是哪天：优先用行自带的字段，其次看 seen / checked_at。
     * 拿不到日期就当作「今天刚成功」——宁可多留一轮，也不要因为字段缺失就清库。 */
    const lastOk = row[lastOkField] || row.checked_at || row.seen || today;
    const age = daysBetween(lastOk, today);

    if (age > ttlDays) continue; // 太旧，丢掉

    kept.push({ ...row, stale: true, [lastOkField]: lastOk });
  }

  /* 本次的行给一个 lastOk 标记：这一次它是新鲜的。
   * 只补不覆盖—— relays 自己有 checked_at，不该被抹掉。 */
  const fresh = nextList.map((r) => (r[lastOkField] ? r : { ...r, [lastOkField]: r.checked_at || today }));

  return [...fresh, ...kept];
}

/* ────────────────────────── 场次型 ────────────────────────── */

/**
 * 场次型合并：与上一版里**还没结束**、且 `lastSeen` 不超过 3 天的场次取并集。
 *
 * 这是 F38 的正解。旧写法「本次有就用本次」在 Luma 只拿到一半时，
 * 活动数会直接腰斩——读者看到的是「今天活动少了」，而不是「今天有个源没跑完」。
 *
 * 判定用**场次自己的日期**而不是抓取时间：
 * - 已经结束的场次（`end`/`start` 早于今天）不再保留，没有意义；
 * - 抓取时间只看 `lastSeen`，超过 3 天没再出现的场次视为已下架。
 *
 * @param {object[]} prev
 * @param {object[]} next
 * @param {{today: string, ttlDays?: number, keyOf?: (r: object) => string}} opt
 * @returns {object[]}
 */
export function mergeSessions(prev, next, opt) {
  const { today, ttlDays = 3, keyOf = (r) => r.id } = opt || {};

  const prevList = Array.isArray(prev) ? prev : [];
  const nextList = Array.isArray(next) ? next : [];
  const nextKeys = new Set(nextList.map(keyOf).filter(Boolean));

  const carried = [];

  for (const row of prevList) {
    const key = keyOf(row);
    if (!key || nextKeys.has(key)) continue;

    /* 已经结束的场次不必再留：既不在时间轴上，也不该占搜索位置。 */
    const last = String(row.end || row.start || '').slice(0, 10);
    if (last && last < today) continue;

    /* lastSeen 超过 TTL：这活动连着几天没出现，大概率已下架或取消。 */
    const seen = String(row.lastSeen || row.start || '').slice(0, 10);
    if (seen && daysBetween(seen, today) > ttlDays) continue;

    carried.push({ ...row, stale: true, lastSeen: row.lastSeen || row.start || today });
  }

  const fresh = nextList.map((r) => (r.lastSeen ? r : { ...r, lastSeen: today }));

  return [...fresh, ...carried];
}

/* ────────────────────────── 归档型 ────────────────────────── */

/**
 * 归档型的「按 key 去重合并」，与目录型的区别是**永不因超时而删**。
 *
 * 情报条目一旦发布就留在归档里，这是「攒出来就补不回来」的东西。
 * 真正的去重与按月分片在 `lib/news.js` 的 `mergeArchive`（那边的键更复杂），
 * 这里只提供一个通用版本，给将来的归档型层用。
 *
 * @param {object[]} prev
 * @param {object[]} next
 * @param {{keyOf?: (r: object) => string}} opt
 * @returns {object[]}
 */
export function mergeArchiveRows(prev, next, opt) {
  const { keyOf = (r) => r.id || r.u } = opt || {};
  const map = new Map();
  for (const r of Array.isArray(prev) ? prev : []) {
    const k = keyOf(r);
    if (k) map.set(k, r);
  }
  for (const r of Array.isArray(next) ? next : []) {
    const k = keyOf(r);
    if (k) map.set(k, { ...map.get(k), ...r });
  }
  return [...map.values()];
}

/* ────────────────────────── 人工型 ────────────────────────── */

/**
 * 人工型校验：`curated/` 是手写的，所以错误以「写错」为主，不是「源站挂了」。
 *
 * 这里只做两件事：
 * 1. 丢掉过期条目（人工数据常带 `expires` / `until` 之类的到期日）；
 * 2. 把没有到期日但明显太旧的标 `stale`，让页面能提示「这条核实于很久以前」。
 *
 * 不校验业务字段——那是各层 schema 的活（T3.5）。
 *
 * @param {object[]} rows
 * @param {{today: string, expireField?: string, maxAgeDays?: number, seenField?: string}} opt
 * @returns {object[]}
 */
export function validateCurated(rows, opt) {
  const { today, expireField = 'expires', maxAgeDays = 180, seenField = 'verified' } = opt || {};
  const out = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const expires = String(row[expireField] || '').slice(0, 10);
    if (expires && expires < today) continue; // 已过期，直接丢

    const verified = String(row[seenField] || '').slice(0, 10);
    if (verified && daysBetween(verified, today) > maxAgeDays) {
      out.push({ ...row, stale: true });
      continue;
    }
    out.push(row);
  }

  return out;
}

/**
 * 策略名 → 实现。层只声明名字，编排器据此校验（T3.6 的「每层声明合并策略」）。
 */
export const MERGE_STRATEGIES = {
  catalog: mergeCatalog,
  sessions: mergeSessions,
  archive: mergeArchiveRows,
  curated: validateCurated,
};
