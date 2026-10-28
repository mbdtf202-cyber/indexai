/**
 * 分层门禁与 manifest（T3.7 · S3.5 · S4.1–S4.3 · F03）。
 *
 * ## 为什么必须按层
 *
 * F03 的病根是「整站一个门禁」：评测层挂了，活动、模型、情报全都跟着不发布。
 * 一次源站故障冻结整个站点，这是最贵的一种脆弱。
 *
 * 正确形态：
 *   - **每层独立**产出结论（ok / warn / red）；
 *   - 每层**一个文件**，manifest 记录文件名、哈希、status、as_of、last_ok、计数、门禁结论；
 *   - 某层 red 时**只**沿用该层的上一版文件，其余层照常更新；
 *   - 整站只在 manifest 本身或 schema 版本出错时才整体失败。
 *
 * ## 结论的含义
 *
 * | 结论 | 数据 | 发布 | 页面 |
 * |---|---|---|---|
 * | `ok` | 本次 | 发 | 正常 |
 * | `warn` | 本次 | 发 | 标注（量级的轻微异常） |
 * | `red`  | 上一版 | 发（旧数据） | 标注「沿用 N 天」 |
 */

import { createHash } from 'node:crypto';
import { checkShrink } from './baseline.mjs';

import { now as nowClock } from '../lib/clock.js';

/** 门禁结论。 */
export const VERDICT = {
  OK: 'ok',
  WARN: 'warn',
  RED: 'red',
};

/** manifest 的 schema 版本。整站只在这个版本对不上时才整体失败（S3.5）。 */
export const MANIFEST_SCHEMA = 'manifest/v1';

/** 逐字节哈希，用来核对「发布出去的确实是这次算出来的」（S3.5 部署后校验）。 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 跑一层的门禁。
 *
 * 层的 `health` 形如：
 * ```js
 * health: {
 *   floor: 10,           // 绝对下限
 *   shrink: 0.5,         // 缩水阈值（相对上一版）
 *   freshness: 72,       // 最新条目最大年龄（小时）
 *   rules: [{ id, check(rows) }],
 * }
 * ```
 *
 * @param {object} layer 层对象
 * @param {object[]} rows 本次产出（已过 schema）
 * @param {{prevCount?: number|null, now?: string}} ctx
 * @returns {{verdict: string, reasons: string[]}}
 */
export function runLayerGate(layer, rows, ctx = {}) {
  const h = layer.health || {};
  const list = Array.isArray(rows) ? rows : [];
  const reasons = [];
  let verdict = VERDICT.OK;

  const escalate = (level, why) => {
    reasons.push(why);
    if (level === VERDICT.RED) verdict = VERDICT.RED;
    else if (level === VERDICT.WARN && verdict !== VERDICT.RED) verdict = VERDICT.WARN;
  };

  /* 1. 下限：只拦灾难性失败。数值保守——宁可漏报，不要误伤正常波动。 */
  if (h.floor != null && list.length < h.floor) {
    escalate(VERDICT.RED, `条数 ${list.length} 低于下限 ${h.floor}`);
  }

  /* 2. 缩水：相对**近 7 次成功快照的中位数**（T4.7 · S4.1 · F33）。
   *
   * 只看上一版是不行的：上一版本身可能是异常低值，拿它当基线会把「正常」判成缩水。
   * 中位数对单日异常不敏感。历史不足 3 次时不做缩水判定，只查绝对下限。 */
  if (h.shrink != null) {
    const history = Array.isArray(ctx.history) && ctx.history.length ? ctx.history : null;
    if (history) {
      const s = checkShrink(list.length, history, { shrink: h.shrink });
      if (s.verdict === 'shrink') escalate(VERDICT.RED, s.reason);
    } else if (ctx.prevCount != null && ctx.prevCount > 0) {
      /* 没有历史数组但给了上一版：仍然只用它做一次保守比较，
       * 并在原因里说清这是「单点基线」而不是中位数。 */
      const ratio = list.length / ctx.prevCount;
      if (ratio < h.shrink) {
        escalate(
          VERDICT.RED,
          `缩水到上一版的 ${(ratio * 100).toFixed(0)}%（阈值 ${(h.shrink * 100).toFixed(0)}%；历史不足，未用中位数）`,
        );
      }
    }
  }

  /* 3. 新鲜度：最新条目多旧。只对有明确时间字段的层有意义。 */
  if (h.freshness != null && list.length) {
    const newest = newestAgeHours(list, ctx.now);
    if (newest != null && newest > h.freshness) {
      escalate(VERDICT.WARN, `最新条目已 ${Math.round(newest)} 小时（阈值 ${h.freshness}）`);
    }
  }

  /* 4. 语义规则：层自带，返回 {level, message}。 */
  for (const rule of h.rules || []) {
    let r;
    try {
      r = rule.check(rows);
    } catch (e) {
      escalate(VERDICT.WARN, `${rule.id} 检查抛错：${e.message}`);
      continue;
    }
    if (!r || !r.level || r.level === VERDICT.OK) continue;
    escalate(r.level, `${rule.id}: ${r.message || ''}`);
  }

  return { verdict, reasons };
}

/**
 * 从编排器的数据对象里取某层的行（三种形状都可能）。
 *
 * 这里是「形状知识」的唯一出口：层契约允许数组、`{rows}`、`{subs,...}` 三种，
 * 分散在各处判断迟早会漏一种。
 *
 * @param {object} data
 * @param {string} id
 * @returns {object[]|null}
 */
export function rowsOf(data, id) {
  const v = data?.[id];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.rows)) return v.rows;
  if (Array.isArray(v?.subs)) return v.subs;
  return null;
}

/**
 * 门禁 + 回退，一次做完（T3.7 的核心动作）。
 *
 * red 时把上一版的行放回 `data[id]`——这就是「某层 red 时其它层照常更新」的实现点：
 * 只有这一层的输出被替换成旧值，别的层完全不受影响。
 *
 * @param {object} opt
 * @param {object} opt.layer
 * @param {object} opt.data 正在写的输出对象
 * @param {object|null} opt.prev 上一版（red 时用来回退）
 * @param {number[]} [opt.history] 历次成功快照的条数（旧→新）
 * @param {string} opt.asOf
 * @returns {{verdict: string, reasons: string[], servedPrev: boolean}}
 */
export function gateAndFallback(opt) {
  const { layer, data, prev, asOf } = opt;
  const rows = rowsOf(data, layer.id) || [];
  const prevRows = rowsOf(prev, layer.id);

  const gate = runLayerGate(layer, rows, {
    prevCount: prevRows ? prevRows.length : null,
    /* 历史计数（T4.7）：给中位数基线用。没有就退回「只看上一版」。 */
    history: opt.history || null,
    now: asOf,
  });

  if (gate.verdict === VERDICT.RED && prevRows && prevRows.length) {
    data[layer.id] = prevRows;
    return { ...gate, servedPrev: true };
  }
  return { ...gate, servedPrev: false };
}

/**
 * 最新条目距今多少小时。
 *
 * 认的字段按优先级：`startAt` / `endAt`（活动）、`checked_at`（中转站）、
 * `publishedAt` / `d`（情报）、`seen`（通用）。都认不出来就返回 null——
 * 「算不出来」和「很旧」必须分开，否则会把没有时间字段的层误判成陈旧。
 *
 * @param {object[]} rows
 * @param {string} [now] ISO 时刻
 * @returns {number|null}
 */
export function newestAgeHours(rows, now) {
  /* 调用方没给 now 时才取当前时刻：走 lib/clock.js，回放模式下是固定值（INV-7）。 */
  const nowMs = now ? Date.parse(now) : nowClock().getTime();
  if (!Number.isFinite(nowMs)) return null;

  let newest = -Infinity;
  for (const r of rows) {
    const raw = r.startAt || r.checked_at || r.publishedAt || r.date || r.d || r.seen;
    if (!raw) continue;
    const t = Date.parse(String(raw).length === 10 ? `${raw}T00:00:00Z` : raw);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (newest === -Infinity) return null;
  return (nowMs - newest) / 3_600_000;
}

/**
 * 生成某一层的 manifest 条目。
 *
 * @param {object} opt
 * @param {string} opt.layer 层 id
 * @param {string} opt.file 该层的数据文件名
 * @param {string} opt.content 该层输出的 JSON 文本（用来算哈希）
 * @param {string} opt.verdict 门禁结论
 * @param {string[]} opt.reasons
 * @param {string} opt.asOf 本次数据的时间口径
 * @param {string|null} opt.lastOk 上一次成功的日期
 * @param {number} opt.count 条数
 * @param {string} [opt.servedFile] red 时实际发布的文件（上一版）
 * @returns {object}
 */
export function manifestEntry(opt) {
  const {
    layer,
    file,
    content,
    verdict,
    reasons = [],
    asOf,
    lastOk = null,
    count,
    servedFile = null,
  } = opt;

  return {
    layer,
    file,
    // red 时页面读的是 servedFile（上一版），manifest 必须如实写出来
    served_file: servedFile || file,
    hash: sha256(content),
    status: verdict,
    as_of: asOf,
    last_ok: lastOk || asOf,
    count,
    gate: { verdict, reasons },
    // 沿用天数：页面据此显示「沿用 N 天」
    stale_days: servedFile ? daysSince(lastOk || asOf, asOf) : 0,
  };
}

/** 两个日期相差几天。 */
function daysSince(a, b) {
  const ta = Date.parse(`${String(a || '').slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${String(b || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.max(0, Math.round((tb - ta) / 86_400_000));
}

/**
 * 组装完整 manifest。
 *
 * 整站只在两件事上失败（S3.5）：
 * 1. manifest 本身写不出来；
 * 2. `schema_version` 与运行时不一致。
 *
 * @param {object} opt
 * @param {object[]} opt.layers manifestEntry 的数组
 * @param {string} opt.generatedAt
 * @returns {object}
 */
export function buildManifest(opt) {
  const { layers = [], generatedAt } = opt;
  const by = (v) => layers.filter((l) => l.status === v).length;

  return {
    schema_version: MANIFEST_SCHEMA,
    generated_at: generatedAt,
    layers,
    summary: {
      total: layers.length,
      ok: by(VERDICT.OK),
      warn: by(VERDICT.WARN),
      stale: by(VERDICT.RED),
    },
  };
}

/**
 * 校验读到的 manifest 是否可用。
 *
 * @param {object|null} manifest
 * @returns {{ok: boolean, reason: string|null}}
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, reason: 'manifest 不存在或不是对象' };
  }
  if (manifest.schema_version !== MANIFEST_SCHEMA) {
    return {
      ok: false,
      reason: `manifest schema 版本不符：期望 ${MANIFEST_SCHEMA}，实际 ${manifest.schema_version}`,
    };
  }
  if (!Array.isArray(manifest.layers)) {
    return { ok: false, reason: 'manifest.layers 不是数组' };
  }
  return { ok: true, reason: null };
}

/**
 * 从 manifest 里取某层实际要发布的文件。
 *
 * red 时返回 `served_file`（上一版），其余情况返回 `file`。
 *
 * @param {object} manifest
 * @param {string} layerId
 * @returns {string|null}
 */
export function servedFileFor(manifest, layerId) {
  const hit = (manifest?.layers || []).find((l) => l.layer === layerId);
  return hit ? hit.served_file || hit.file : null;
}
