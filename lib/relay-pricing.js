/**
 * 中转站（OneAPI / NewAPI）零售价解析。
 *
 * 从 `41dec66:collect.mjs` 原样搬出（拆层时这一整套没有归属，层里只有骨架）。
 * 逻辑一行未改——它是被生产验证过的判定，重写只会引入回归。
 *
 * ## 两套并存的价格写法，优先级从高到低
 *
 * ① `billing_expr` 表达式计费（NewAPI 新版，实测 183/1308 行使用）
 *      `tier("base", p * 2 + c * 10 + cr * 0.1)`
 *      p=输入 c=输出 cr=缓存读 cc=缓存写；这是真实挂牌价。
 * ② `model_ratio × group_ratio × 2` 倍率计费（老版 OneAPI）
 *      到手价 = model_ratio × 分组倍率 × 2
 *      output = 上式 × completion_ratio
 *      缓存读 = 上式 × cache_ratio
 *
 * ## 踩过的坑（本项目最严重的一次）
 *
 * - 只采 `model_ratio`，把它当唯一价格 → 全行业都是同一个常量，页面「所有站一个价」；
 * - 站点同时给了 `billing_expr` 和 `model_ratio` 时优先信 `model_ratio` → 得到 75/75
 *   这种与真实价（$2/$10）毫无关系的数，再把它们当「口径?异常」标出来，属于自己造异常；
 * - 分组倍率跨站差 20–220 倍（Nova 0.0001→2，年华 0.05→11），不采就等于丢弃真实价差。
 */

import { isGrayGroup, splitGroups } from './relay-groups.js';
import { FLAGSHIP, VARIANT_RE, DATED_RE, FREE_RE } from './relay-flagships.js';

export { FLAGSHIP };


/** 分组倍率表：顶层 `group_ratio` 是 {组名: 倍率}，也见过数组形式。 */
export function groupRatioTable(j) {
  const raw = j?.group_ratio ?? j?.groupRatio;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const map = {};
    for (const g of raw) {
      const nm = g?.name ?? g?.group ?? g?.key;
      const v = Number(g?.ratio ?? g?.value);
      if (nm != null && Number.isFinite(v) && v > 0) map[String(nm)] = v;
    }
    return Object.keys(map).length ? map : null;
  }
  if (typeof raw === 'object') {
    const map = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) map[k] = n;
    }
    return Object.keys(map).length ? map : null;
  }
  return null;
}

/** 该行可用的分组倍率（只看 `enable_groups` 里列出的）。 */
export function rowGroups(row, table) {
  const names = Array.isArray(row.enable_groups) ? row.enable_groups.map(String) : [];
  const all = table
    ? names.filter((n) => table[n] != null).map((n) => ({ name: n, ratio: table[n] }))
    : names.map((n) => ({ name: n, ratio: null }));
  const fallback = () =>
    table && table.default != null
      ? [{ name: 'default', ratio: table.default }]
      : [{ name: 'default', ratio: null }];
  if (!all.length) return fallback();

  /*
   * 代表分组的选择。三种站点命名习惯都要覆盖：
   *  ① 有 default / 自动 / auto   → 直接用（最常见）
   *  ② 组名里写倍率，如「a全模型综合组-1倍率」「纯Azure稳定无审核-0.6倍率」
   *  ③ 只有一堆渠道名          → 取倍率最接近 1 的
   *
   * 绝不能直接取最小值：最便宜的分组往往是「测试」「逆向」「特价」这类
   * 不可靠或功能受限的渠道，拿它做跨站比较等于用别人的地板价充自己的招牌价。
   * 也绝不能按字母序取第一个：GGWK 的 enable_groups 首位是「a全模型综合组」，
   * 但别的站首位可能是「特殊逆向claude」。
   */
  const NAME_RATIO = /[-_]?\s*([\d.]+)\s*(?:倍率|x|×)/i;
  const reliable = (g) => {
    if (g.ratio == null) return false;
    if (/(测试|调试|probation|dummy|演示|free|免费)/i.test(g.name)) return false;
    return true;
  };

  const byDefault = all.filter((g) => /^(default|自动|auto|默认)$/i.test(g.name) && g.ratio != null);
  let rep;
  if (byDefault.length) {
    rep = byDefault[0];
  } else {
    // 组名里的倍率优先于「接近 1」的经验值
    const named = all
      .map((g) => {
        const m = g.name.match(NAME_RATIO);
        const declared = m ? Number(m[1]) : null;
        return { ...g, declared: Number.isFinite(declared) ? declared : null };
      })
      .filter((g) => g.ratio != null);
    const withDeclared = named.filter((g) => g.declared != null);
    const pool = (withDeclared.length ? withDeclared : named).filter(reliable);
    const usable = pool.length ? pool : named;
    usable.sort((a, b) => {
      // 声明倍率离 1 越近越好；没声明的按实际倍率离 1 远近
      const ka = a.declared != null ? Math.abs(Math.log(a.declared)) : Math.abs(Math.log(a.ratio));
      const kb = b.declared != null ? Math.abs(Math.log(b.declared)) : Math.abs(Math.log(b.ratio));
      return ka - kb;
    });
    rep = usable[0] || all[0];
  }

  /* 「最低可达价」排除两类分组（F49 / D3）：
   * 1. 测试/调试类渠道 —— 不是给人用的；
   * 2. 逆向 / 特价 类渠道 —— 破解协议或低于成本的引流价，不代表真实行情。
   *
   * 灰色分组**保留在 count 里**（用户该知道这家有 12 个分组，其中 3 个是灰色的），
   * 但不出现在 lo / hi 与代表价里。页面会显示被排除的数量。 */
  const USABLE_SKIP = /(测试|调试|probation|dummy|演示)/i;
  const usableGroups = all.filter(
    (g) => g.ratio != null && g.ratio > 0 && !USABLE_SKIP.test(g.name) && !isGrayGroup(g.name),
  );
  const lo = usableGroups.length ? usableGroups.reduce((m, g) => (g.ratio < m.ratio ? g : m)) : null;
  const hi = usableGroups.length ? usableGroups.reduce((m, g) => (g.ratio > m.ratio ? g : m)) : null;
  const grayCount = splitGroups(all).grayCount;
  return [
    {
      ...rep,
      lo: lo?.ratio ?? null,
      loName: lo?.name ?? null,
      hi: hi?.ratio ?? null,
      hiName: hi?.name ?? null,
      count: all.length,
      // 被排除的灰色分组数（页面据此显示「另有 N 个灰色分组未计入」）
      grayGroups: grayCount,
    },
  ];
}

/** 从表达式里抠系数：先长后缀再单字母，避免 c 命中 cc / cr 的开头。 */
export function exprCoefficients(body) {
  const num = (re) => {
    const m = body.match(re);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    p: num(/\bp\s*\*\s*([\d.]+)/),
    c: num(/\bc\s*\*\s*([\d.]+)/),
    cr: num(/\bcr\s*\*\s*([\d.]+)/),
    cc: num(/\bcc(?!1h)\s*\*\s*([\d.]+)/) ?? num(/\bcc1h\s*\*\s*([\d.]+)/),
    fixed: num(/fixed\s*\(\s*([\d.]+)\s*\)/),
    secs: num(/\bu\("seconds"\)\s*\*\s*([\d.]+)/),
  };
}

/** 切出所有 `tier("name", ...)`，括号按深度平衡（表达式里有嵌套三元）。 */
export function tierBranches(expr) {
  const out = [];
  const re = /tier\s*\(\s*"([^"]+)"\s*,/g;
  let m;
  while ((m = re.exec(expr))) {
    let i = re.lastIndex;
    let depth = 1;
    const start = i;
    for (; i < expr.length && depth > 0; i++) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out.push({ name: m[1], body: expr.slice(start, i - 1).trim() });
  }
  return out;
}

const TIER_PRIORITY = ['base', 'standard', 'auto', 'default', 'off_peak', 'peak', 'short', 'none'];

/**
 * 解析 `billing_expr`。选档 base > standard > 其他，
 * 避免取到 long_context（长上下文档通常直接翻倍）。
 */
/**
 * @typedef {{kind: string, input?: number, output?: number, comp?: number, cacheRead?: number,
 *   cacheWrite?: number, usd?: number, unit?: string, perUnit?: number, tier?: string,
 *   via: string, branches?: object[], longContext?: object,
 *   group?: string|null, groupKnown?: boolean, tiered?: boolean, cacheRatio?: number}} Price
 */

/**
 * @param {string} expr
 * @returns {Price|null}
 */
export function parseBillingExpr(expr) {
  if (!expr || typeof expr !== 'string') return null;
  const branches = tierBranches(expr);
  if (!branches.length) return null;

  const priced = [];
  for (const b of branches) {
    const co = exprCoefficients(b.body);
    if (co.p == null && co.fixed == null && co.secs == null) continue;
    priced.push({ name: b.name, ...co });
  }
  if (!priced.length) return null;

  const rank = (n) => {
    const i = TIER_PRIORITY.indexOf(String(n).toLowerCase());
    return i < 0 ? 50 : i;
  };
  const sorted = priced.slice().sort((a, b) => rank(a.name) - rank(b.name));
  const main = sorted[0];
  const alt = sorted.find((x) => x !== main && x.p != null);
  const branchesNote =
    priced.length > 1
      ? priced.map((x) => ({ name: x.name, input: x.p, output: x.c, cacheRead: x.cr }))
      : null;

  if (main.fixed != null) return { kind: 'per_call', usd: Number(main.fixed.toFixed(4)), via: 'expr' };
  if (main.secs != null)
    return { kind: 'per_unit', unit: 'second', perUnit: Number(main.secs.toFixed(6)), via: 'expr' };
  if (main.p == null) return null;

  return {
    kind: 'per_1m',
    input: Number(main.p.toFixed(4)),
    output: Number((main.c ?? main.p).toFixed(4)),
    ...(main.cr != null ? { cacheRead: Number(main.cr.toFixed(4)) } : {}),
    ...(main.cc != null ? { cacheWrite: Number(main.cc.toFixed(4)) } : {}),
    comp: main.c != null && main.p > 0 ? Number((main.c / main.p).toFixed(4)) : 1,
    tier: main.name,
    via: 'expr',
    ...(branchesNote ? { branches: branchesNote } : {}),
    ...(alt ? { longContext: { name: alt.name, input: alt.p, output: alt.c } } : {}),
  };
}

/**
 * 单价。优先 `billing_expr`（真实挂牌价），退回 `model_ratio` 倍率法。
 *
 * 这是「所有站一个价」和「11 家 75/75 异常」两个 bug 的正解：
 * 有 `billing_expr` 的站点，其 `model_ratio` 是废弃占位字段，
 * 拿它算出来的 $75 与挂牌 $2 毫无关系，必须让表达式优先。
 */
/**
 * @param {object} row
 * @param {{ratio?: number, name?: string}|null} group
 * @returns {Price|null}
 */
export function relayPrice(row, group) {
  const n = (x) => (x == null || x === '' ? null : Number(x));
  const g = group?.ratio == null ? 1 : group.ratio;

  // ① 表达式计费
  const viaExpr = parseBillingExpr(row.billing_expr);
  if (viaExpr) {
    if (viaExpr.kind !== 'per_1m') return { ...viaExpr, group: group?.name ?? null };
    // 表达式里的系数已是美元价，不再乘分组倍率（分组倍率只作用于 model_ratio 体系）
    return {
      ...viaExpr,
      comp: viaExpr.comp ?? 1,
      group: group?.name ?? null,
      groupKnown: group?.ratio != null,
    };
  }

  // ② 倍率计费
  const perCall = n(row.model_price ?? row.modelPrice);
  if (perCall && perCall > 0)
    return { kind: 'per_call', usd: Number(perCall.toFixed(4)), group: group?.name ?? null, via: 'price' };
  const ratio = n(row.model_ratio ?? row.modelRatio ?? row.ratio);
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null;
  const comp = n(row.completion_ratio ?? row.completionRatio) || 1;
  const cache = n(row.cache_ratio);
  const out = {
    kind: 'per_1m',
    input: Number((ratio * 2 * g).toFixed(4)),
    output: Number((ratio * comp * 2 * g).toFixed(4)),
    comp: Number(comp.toFixed(4)),
    group: group?.name ?? 'default',
    groupKnown: group?.ratio != null,
    via: 'ratio',
  };
  if (cache != null && Number.isFinite(cache) && cache >= 0) {
    out.cacheRead = Number((ratio * cache * 2 * g).toFixed(4));
    out.cacheRatio = Number(cache.toFixed(4));
  }
  return out;
}

/** 宽松 JSON 解析：有的站会先输出一行提示再给 JSON。 */
export function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {}
  try {
    return JSON.parse(text.split('\n')[0]);
  } catch {}
  const i = text.indexOf('{');
  if (i < 0) return null;
  try {
    return JSON.parse(text.slice(i));
  } catch {
    return null;
  }
}

/**
 * 在一个站的价目行里挑出「基础版」旗舰，而不是第一个正则命中。
 *
 * 基础版压倒一切：宁可显示「按次计价的基础版」，也不要显示变体的单价。
 */
export function pickFlagship(rows, f, gTable) {
  const named = rows.filter((r) => {
    const nm = String(r.model_name || r.modelName || r.id || '');
    return f.re.test(nm);
  });
  if (!named.length) return null;

  const isVariant = (r) => {
    const nm = String(r.model_name || r.modelName || r.id || '');
    const base = nm.replace(f.re, '').replace(/^[-_.\s]+|[-_.\s]+$/g, '');
    // 只对「名字里比正则多出来的部分」判变体，避免把 claude-sonnet-5-5 本身判成变体
    return VARIANT_RE.test(base) || DATED_RE.test(nm) || FREE_RE.test(nm);
  };

  const scored = [];
  for (const r of named) {
    const groups = rowGroups(r, gTable);
    const g = groups[0];
    /** @type {Price|null} */
    const p = relayPrice(r, g);
    if (!p) continue;
    const perCall = p.kind === 'per_call';
    const variant = isVariant(r);
    let score = 0;
    if (!variant) score += 100;
    if (p.kind === 'per_1m') {
      const wantRatio = f.official[1] / f.official[0];
      const ratioErr = Math.abs(Math.log((p.comp || 1) / wantRatio));
      score -= ratioErr * 18;
      score -= Math.log10(Math.max(p.input, 0.0001)) * 0.6; // 同分时略偏好低价
    }
    if (p.groupKnown) score += 20;
    if (!p.tiered) score += 10;
    if (perCall) score -= 4; // 计费口径不同，排在同名 per_1m 之后
    scored.push({ row: r, price: p, score, variant, groups, tiered: Boolean(p.tiered), perCall });
  }
  if (!scored.length) return null;
  scored.sort(
    (a, b) =>
      b.score - a.score || (a.price.input ?? a.price.usd ?? 0) - (b.price.input ?? b.price.usd ?? 0),
  );
  const best = scored[0];

  /*
   * 最低可达价：同一行在「最便宜可用分组」下的单价。
   * 这是用户真正会问的问题（「这家最低能到多少」），但它依赖具体分组
   * （有的组要买会员、有的组只给 Claude Code 用），所以和代表价分开存，
   * 页面上必须标出组名，不能拿它冒充无门槛价格。
   */
  let floor = null;
  const g0 = best.groups[0];
  if (g0 && g0.lo != null && best.price.via === 'ratio' && g0.ratio > 0 && g0.lo !== g0.ratio) {
    const k = g0.lo / g0.ratio;
    floor = {
      input: Number((best.price.input * k).toFixed(4)),
      output: Number((best.price.output * k).toFixed(4)),
      group: g0.loName,
      disc: Number(k.toFixed(3)),
    };
  }

  return {
    row: best.row,
    price: best.price,
    candidates: scored.length,
    groupCount: best.groups.length,
    // 被排除的灰色分组数（逆向 / 特价）：页面要说「另有 N 个未计入」
    grayGroups: best.groups.reduce((n, g) => n + (g.grayGroups || 0), 0),
    tiered: best.tiered,
    variant: best.variant,
    floor,
  };
}
