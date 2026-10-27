/**
 * 变化引擎（T4.3 · S5.2 · F29）。
 *
 * 比较「今天」与「上一版」快照，产出类型化事件。这是站点信息密度的来源：
 * 读者不只想看「现在多少钱」，还想知道「今天变了什么」。
 *
 * ## S5.2 的事件表
 *
 * | 层 | 事件 |
 * |---|---|
 * | 模型 | 新增、下架、输入/输出/缓存读/缓存写价格变化、上下文变化 |
 * | 免费额度 | 新增、移除、额度文本变化、到期 |
 * | 订阅 | 任一区价变化超过 1%、新档位、下架 |
 * | 中转站 | 旗舰价变化、上线/下线、新站 |
 * | 评测 | 新榜、各榜前 20 名次变化、同一模型分数下降 |
 * | 活动 | 新增的高价值场次（奖池或报名数超过阈值） |
 *
 * ## 纯函数
 *
 * `computeChanges(prev, current, ctx)` 不读文件、不看时钟——`date` 由调用方传。
 * 这样「两份 fixture 快照 → 确定的 golden」才成立（验收要求）。
 */

/** 订阅区价变化的判定阈值（S5.2：超过 1%）。 */
export const SUB_PRICE_EPSILON = 0.01;

/** 评测榜只看前 N 名的名次变化。 */
export const BENCH_TOP_N = 20;

/** 活动「高价值」阈值：奖池（美元）或报名数。 */
export const EVENT_HIGH_VALUE = { prize: 10_000, regs: 500 };

/**
 * 浅比较两个价格字段，返回变化描述或 null。
 *
 * 价格是浮点，直接 `!==` 会把 0.140845 与 0.1408450001 当成变化。
 * 相对误差 0.1% 以内视为没变——这比绝对误差稳，因为价格量级差两个数量级。
 *
 * @param {number|null|undefined} a 旧值
 * @param {number|null|undefined} b 新值
 * @returns {{old: number|null, new: number|null, delta: number|null, pct: number|null}|null}
 */
export function priceDelta(a, b) {
  const o = a ?? null;
  const n = b ?? null;
  if (o === n) return null;
  if (o == null || n == null) return { old: o, new: n, delta: null, pct: null };

  const delta = Number((n - o).toFixed(6));
  if (delta === 0) return null;

  // 相对误差在 0.1% 内视为没变
  const base = Math.max(Math.abs(o), 1e-9);
  if (Math.abs(delta) / base < 0.001) return null;

  return { old: o, new: n, delta, pct: Number(((n - o) / base).toFixed(4)) };
}

/**
 * 计算变化事件。
 *
 * @param {{data?: object, bench?: object}} prev 上一版
 * @param {{data?: object, bench?: object}} current 本次
 * @param {{date: string}} ctx date 是 `YYYY-MM-DD`，写进事件里
 * @returns {object[]} 事件数组（按类型分组稳定排序）
 */
export function computeChanges(prev, current, ctx) {
  const date = ctx?.date || null;
  const events = [];
  const push = (type, payload) => events.push({ type, date, ...payload });

  const pd = prev?.data || {};
  const cd = current?.data || {};

  /* ────────────────────────── 模型 ────────────────────────── */
  const prevModels = new Map((pd.models || []).map((m) => [m.id, m]));
  const currModels = new Map((cd.models || []).map((m) => [m.id, m]));

  for (const [id, m] of currModels) {
    const old = prevModels.get(id);
    if (!old) {
      push('model_new', { id, name: m.name, vendor: m.vendor, channel: m.channel });
      continue;
    }

    // 四类价格各自独立：一次改了输入价不该把输出价也报一遍
    for (const [field, type] of [
      ['input', 'model_price_input'],
      ['output', 'model_price_output'],
      ['cache_read', 'model_price_cache_read'],
      ['cache_write', 'model_price_cache_write'],
    ]) {
      const d = priceDelta(old[field], m[field]);
      if (d) push(type, { id, name: m.name, vendor: m.vendor, channel: m.channel, change: d });
    }

    if (old.ctx !== m.ctx) {
      push('model_ctx', {
        id,
        name: m.name,
        vendor: m.vendor,
        change: { old: old.ctx ?? null, new: m.ctx ?? null },
      });
    }
  }

  for (const [id, m] of prevModels) {
    if (!currModels.has(id)) push('model_removed', { id, name: m.name, vendor: m.vendor });
  }

  /* ────────────────────────── 免费额度 ────────────────────────── */
  const prevOffers = new Map((pd.offers || []).map((o) => [o.id, o]));
  const currOffers = new Map((cd.offers || []).map((o) => [o.id, o]));

  for (const [id, o] of currOffers) {
    const old = prevOffers.get(id);
    if (!old) {
      push('offer_new', { id, product: o.product, vendor: o.vendor, claim: o.claim });
      continue;
    }
    /* 额度文本变化：免费额度是会缩水的，「$5 额度」变成「$2 额度」
     * 是读者最该知道的那类变化。 */
    const oldText = String(old.quota ?? '');
    const newText = String(o.quota ?? '');
    if (oldText !== newText) {
      push('offer_quota', {
        id,
        product: o.product,
        change: { old: oldText || null, new: newText || null },
      });
    }
  }

  for (const [id, o] of prevOffers) {
    if (!currOffers.has(id)) push('offer_removed', { id, product: o.product, vendor: o.vendor });
  }

  /* ────────────────────────── 订阅 ────────────────────────── */
  const prevSubs = new Map((pd.subs || []).map((s) => [s.id, s]));
  const currSubs = new Map((cd.subs || []).map((s) => [s.id, s]));

  for (const [id, s] of currSubs) {
    const old = prevSubs.get(id);
    if (!old) {
      push('sub_new', {
        id,
        product: s.product,
        tier: s.tier,
        price: s.price,
        currency: s.currency,
      });
      continue;
    }
    // 阈值 1%：区价常有一分钱的汇率抖动，不该每次都报
    const d = priceDelta(old.price, s.price);
    if (d && Math.abs(d.pct ?? 0) >= SUB_PRICE_EPSILON) {
      push('sub_price', {
        id,
        product: s.product,
        tier: s.tier,
        currency: s.currency,
        change: d,
      });
    }
  }

  for (const [id, s] of prevSubs) {
    if (!currSubs.has(id)) push('sub_removed', { id, product: s.product, tier: s.tier });
  }

  /* ────────────────────────── 中转站 ────────────────────────── */
  const prevRelays = new Map((pd.relays || []).map((r) => [r.domain, r]));
  const currRelays = new Map((cd.relays || []).map((r) => [r.domain, r]));

  for (const [domain, r] of currRelays) {
    const old = prevRelays.get(domain);
    if (!old) {
      push('relay_new', { domain, name: r.name, status: r.status });
      continue;
    }

    // 上线 / 下线：status 从 ok 变别的，或反过来
    const wasOk = old.status === 'ok';
    const isOk = r.status === 'ok';
    if (wasOk !== isOk) {
      push(isOk ? 'relay_up' : 'relay_down', {
        domain,
        name: r.name,
        change: { old: old.status ?? null, new: r.status ?? null },
      });
    }

    /* 旗舰价逐个比：中转站的价格是「某几个旗舰模型多少钱」，
     * 整体比没有意义（站与站的模型集合不同）。 */
    for (const [key, price] of Object.entries(r.prices || {})) {
      const oldPrice = old.prices?.[key];
      if (!oldPrice || !price) continue;
      const d = priceDelta(oldPrice.input, price.input);
      if (d) {
        push('relay_price', {
          domain,
          name: r.name,
          flagship: key,
          change: d,
        });
      }
    }
  }

  /* ────────────────────────── 评测 ────────────────────────── */
  const prevBoards = new Map(Object.entries(prev?.bench?.boards || {}));
  const currBoards = new Map(Object.entries(current?.bench?.boards || {}));

  for (const [boardId, board] of currBoards) {
    if (!prevBoards.has(boardId)) {
      push('bench_new_board', { boardId, title: board?.title ?? boardId });
      continue;
    }

    const oldBoard = prevBoards.get(boardId);
    const oldRank = new Map((oldBoard?.rows || []).map((r, i) => [r.model, { ...r, rank: i + 1 }]));
    const currRows = board?.rows || [];

    currRows.slice(0, BENCH_TOP_N).forEach((row, i) => {
      const before = oldRank.get(row.model);
      if (!before) return;

      /* 名次变化：只报前 N 名的进出与移动，整榜几百行的抖动没有意义。 */
      const rankNow = i + 1;
      const rankWas = before.rank;
      if (rankNow !== rankWas && rankWas <= BENCH_TOP_N) {
        push('bench_rank', {
          boardId,
          model: row.model,
          change: { old: rankWas, new: rankNow },
        });
      }

      /* 分数下降（F29 的承诺）：同一模型同一榜，分数掉了就报。
       * 这通常意味着换了题目版本或重新评测，读者需要知道。 */
      const scoreNow = Number(row.score);
      const scoreWas = Number(before.score);
      if (Number.isFinite(scoreNow) && Number.isFinite(scoreWas) && scoreNow < scoreWas) {
        const d = Number((scoreNow - scoreWas).toFixed(4));
        if (Math.abs(d) / Math.max(Math.abs(scoreWas), 1e-9) >= 0.001) {
          push('bench_score_down', {
            boardId,
            model: row.model,
            change: { old: scoreWas, new: scoreNow, delta: d },
          });
        }
      }
    });
  }

  /* ────────────────────────── 活动 ────────────────────────── */
  const prevEvents = new Set((pd.events || []).map((e) => e.id));
  for (const e of pd.events ? cd.events || [] : []) {
    if (prevEvents.has(e.id)) continue;
    /* 只报「高价值」新场次：每天新增几十个活动，全报等于没报。 */
    const prize = Number(String(e.prize ?? '').replace(/[^0-9.]/g, '')) || 0;
    const regs = Number(e.regs) || 0;
    if (prize >= EVENT_HIGH_VALUE.prize || regs >= EVENT_HIGH_VALUE.regs) {
      push('event_high_value', {
        id: e.id,
        title: e.title,
        url: e.url,
        prize: prize || null,
        regs: regs || null,
        start: e.start ?? null,
      });
    }
  }

  /* 稳定排序：先按类型，再按主键。同一份数据两次算出来的顺序必须一致，
   * 否则 golden 无法逐字节比较、Atom 源的条目顺序也会抖。 */
  const KEY = (e) => String(e.id ?? e.domain ?? `${e.boardId}|${e.model}` ?? e.product ?? '');
  events.sort((a, b) =>
    a.type === b.type ? KEY(a).localeCompare(KEY(b)) : a.type.localeCompare(b.type),
  );

  return events;
}

/**
 * 按类型汇总计数（Atom 与首页模块都用）。
 *
 * @param {object[]} events
 * @returns {Record<string, number>}
 */
export function countByType(events) {
  const out = {};
  for (const e of events || []) out[e.type] = (out[e.type] || 0) + 1;
  return out;
}

/**
 * 事件的人类可读描述（Atom 的 title 与首页列表用）。
 *
 * @param {object} e
 * @returns {string}
 */
export function describeChange(e) {
  const ch = e.change || {};
  const g = (k, d = '') => ch[k] ?? d;

  switch (e.type) {
    case 'model_new':
      return `新模型：${e.name}`;
    case 'model_removed':
      return `下架：${e.name}`;
    case 'model_price_input':
      return `${e.name} 输入价 $${g('old')} → $${g('new')}`;
    case 'model_price_output':
      return `${e.name} 输出价 $${g('old')} → $${g('new')}`;
    case 'model_price_cache_read':
      return `${e.name} 缓存读价 $${g('old')} → $${g('new')}`;
    case 'model_price_cache_write':
      return `${e.name} 缓存写价 $${g('old')} → $${g('new')}`;
    case 'model_ctx':
      return `${e.name} 上下文 ${g('old')} → ${g('new')}`;
    case 'offer_new':
      return `新免费额度：${e.product}`;
    case 'offer_removed':
      return `免费额度下线：${e.product}`;
    case 'offer_quota':
      return `${e.product} 额度 ${g('old') || '—'} → ${g('new') || '—'}`;
    case 'sub_new':
      return `新订阅档位：${e.product} ${e.tier}`;
    case 'sub_removed':
      return `订阅下架：${e.product} ${e.tier}`;
    case 'sub_price':
      return `${e.product} ${e.tier} ${e.currency} ${g('old')} → ${g('new')}`;
    case 'relay_new':
      return `新中转站：${e.name || e.domain}`;
    case 'relay_up':
      return `${e.name || e.domain} 恢复可用`;
    case 'relay_down':
      return `${e.name || e.domain} 不可用`;
    case 'relay_price':
      return `${e.name || e.domain} 的 ${e.flagship} $${g('old')} → $${g('new')}`;
    case 'bench_new_board':
      return `新评测榜：${e.title}`;
    case 'bench_rank':
      return `${e.boardId} · ${e.model} 第 ${g('old')} → 第 ${g('new')}`;
    case 'bench_score_down':
      return `${e.boardId} · ${e.model} 分数 ${g('old')} → ${g('new')}`;
    case 'event_high_value':
      return `高价值活动：${e.title}`;
    default:
      return e.type;
  }
}
