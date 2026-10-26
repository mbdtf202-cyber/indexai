/**
 * 官方价的币种与折算（T3.8 · F14 · 第 2 条）。
 *
 * ## 为什么不能把美元价写死在 `curated/`
 *
 * DeepSeek 与 MiniMax 的官方价是**人民币**（1 元 / 4 元 每百万 token），
 * 过去 `curated/official-prices.json` 里同时存了 `cny` 与一个手算的 `in`/`out`（美元）。
 * 那个美元值是按某一天的汇率（实测约 7.10）算出来的常数。
 *
 * 后果：汇率一动（7.10 → 7.30），页面上的「官方价」就悄悄错了 3%，
 * 而它还是全部比价、折扣、vsOfficial 的分母。一个过期常数污染整张表。
 *
 * ## 现在的分工
 *
 * - `curated/` 只存**原币与原数字**（`cny.input` / `usd.input`），不存折算结果；
 * - 派生阶段（本模块）用**当天汇率**折算，并把用到的汇率与日期一起记下来；
 * - 上游没给原币时，才退回手填的美分值，并标 `derived: false`。
 *
 * 这样「这个美元价是怎么来的」永远可追：要么 `cny ÷ rate`，要么手填。
 */

/** 人民币的币种代码。 */
export const CNY = 'CNY';
/** 美元的币种代码。 */
export const USD = 'USD';

/**
 * 把一条人工官方价拆成「原币价 + 派生的美元价」。
 *
 * @param {object} row `curated/official-prices.json` 的一条
 * @param {{rate: number, date: string}|null} fx 当天汇率（1 USD = rate CNY）
 * @returns {{
 *   input: number|null, output: number|null, cache_read: number|null,
 *   currency: string, native: object|null, usdRate: number|null, rateDate: string|null,
 *   derived: boolean,
 * }}
 */
export function priceInUsd(row, fx) {
  const native = row.cny
    ? {
        currency: CNY,
        input: row.cny.input ?? null,
        output: row.cny.output ?? null,
        cache_read: row.cny.cache_read ?? null,
      }
    : row.usd
      ? {
          currency: USD,
          input: row.usd.input ?? null,
          output: row.usd.output ?? null,
          cache_read: row.usd.cache_read ?? null,
        }
      : null;

  /* 人民币价：必须用当天汇率折算。没有汇率就**不给美元价**——
   * 用旧常数会让比价表整体偏 3%，而读者看不出来。 */
  if (native?.currency === CNY) {
    const rate = fx?.rate;
    if (!Number.isFinite(rate) || rate <= 0) {
      return {
        input: null,
        output: null,
        cache_read: null,
        currency: CNY,
        native,
        usdRate: null,
        rateDate: null,
        derived: false,
      };
    }
    const conv = (v) => (v == null ? null : Number((v / rate).toFixed(6)));
    return {
      input: conv(native.input),
      output: conv(native.output),
      cache_read: conv(native.cache_read),
      currency: CNY,
      native,
      usdRate: rate,
      rateDate: fx.date || null,
      derived: true,
    };
  }

  /* 本来就是美元：直接用原值，不需要折算。 */
  if (native?.currency === USD) {
    return {
      input: native.input,
      output: native.output,
      cache_read: native.cache_read,
      currency: USD,
      native,
      usdRate: null,
      rateDate: null,
      derived: false,
    };
  }

  /* 只有手填的美分值（历史数据）：照用，但标 derived: false —— 它不是算出来的。 */
  return {
    input: row.in ?? null,
    output: row.out ?? null,
    cache_read: row.cr ?? null,
    currency: USD,
    native: null,
    usdRate: null,
    rateDate: null,
    derived: false,
  };
}

/**
 * 从汇率层的结果里取「1 USD = ? CNY」。
 *
 * 汇率层的 `meta.fx` 形如 `{ USDCNY: 7.11, source: 'open.er-api.com', date: '...' }`。
 * 取不到就返回 null——上层会因此不给美元价，而不是拿常数凑。
 *
 * @param {object|null} fxMeta
 * @returns {{rate: number, date: string|null, source: string}|null}
 */
export function fxFrom(fxMeta) {
  const rate = Number(fxMeta?.USDCNY);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    rate,
    date: fxMeta?.date || fxMeta?.as_of || null,
    source: fxMeta?.source || 'unknown',
  };
}

/**
 * 分档价（`tiers`）与分时价（`schedule`）的判定。
 *
 * 规格要求：
 * - 分档价（按上下文长度）写 `tiers`；
 * - 分时价（DeepSeek 工作日高峰 ×2）写 `schedule`。
 *
 * @param {object} row
 * @returns {{tiers: object[]|null, schedule: object[]|null}}
 */
export function priceShape(row) {
  return {
    tiers: Array.isArray(row.tiers) && row.tiers.length ? row.tiers : null,
    schedule: Array.isArray(row.schedule) && row.schedule.length ? row.schedule : null,
  };
}

/**
 * 有效期判定（Gemini 4 Argon 的 `valid_until` / `valid_from`，规格第 2 条）。
 *
 * @param {object} row
 * @param {string} today `YYYY-MM-DD`
 * @returns {{active: boolean, reason: string|null}}
 */
export function validity(row, today) {
  const from = row.valid_from ? String(row.valid_from).slice(0, 10) : null;
  const until = row.valid_until ? String(row.valid_until).slice(0, 10) : null;

  if (from && today < from) return { active: false, reason: `尚未生效（${from} 起）` };
  if (until && today > until) return { active: false, reason: `已过期（${until} 止）` };
  return { active: true, reason: null };
}

/**
 * 复核状态（规格第 3 条）：`review_by` 进入 7 天内为 warn；过期标「待复核」。
 *
 * @param {object} row
 * @param {string} today
 * @returns {{state: 'ok'|'due'|'overdue', daysLeft: number|null}}
 */
export function reviewState(row, today) {
  const by = row.review_by ? String(row.review_by).slice(0, 10) : null;
  if (!by) return { state: 'ok', daysLeft: null };

  const t1 = Date.parse(`${today}T00:00:00Z`);
  const t2 = Date.parse(`${by}T00:00:00Z`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return { state: 'ok', daysLeft: null };

  const daysLeft = Math.round((t2 - t1) / 86_400_000);
  if (daysLeft < 0) return { state: 'overdue', daysLeft };
  if (daysLeft <= 7) return { state: 'due', daysLeft };
  return { state: 'ok', daysLeft };
}
