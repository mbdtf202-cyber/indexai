/**
 * 告警决策（T4.2 · S4.2 · S4.4）。
 *
 * ## 判什么
 *
 * 「同一层**连续**两次 red 或 stale」才开 issue——偶尔一次失败是源站常态，
 * 天天报会把告警变成噪声，最后没人看。
 *
 * ## 三种动作
 *
 * | 动作 | 条件 |
 * |---|---|
 * | `open` | 连续 ≥2 次坏，且当前没有未关闭的 issue |
 * | `append` | 连续 ≥2 次坏，且已有未关闭的 issue（追加一条评论，不重复开） |
 * | `close` | 最新一次恢复 ok，且之前有未关闭的 issue |
 *
 * ## 为什么是纯函数
 *
 * 决策与副作用分开：这个模块只回答「该做什么」，`github.mjs` 负责真的去做。
 * 好处是三条路径都能用单元测试覆盖，不必真的去开 issue。
 *
 * ## 上一版的三个 bug（这一版修掉）
 *
 * 1. `redCount >= 2` 数的是**有史以来**任何两次失败，不是「连续」——
 *    隔三天失败一次也会被当成连续。
 * 2. 没读已有 issue 状态，于是永远返回 `open`，每次都开新 issue。
 * 3. `history` 的顺序默认是「最新在前」，但调用方可能给反的，判断就整个反了。
 */

/** 坏状态：这两种出现连续两次就要开 issue。 */
export const BAD_STATES = new Set(['red', 'failed', 'stale', 'partial']);

/** 恢复状态。 */
export const OK_STATES = new Set(['ok']);

/** 连续多少次坏才算「持续」。 */
export const CONSECUTIVE_THRESHOLD = 2;

/** 决策结果的动作枚举。 */
export const ALERT_ACTION = {
  NONE: 'none',
  OPEN: 'open',
  APPEND: 'append',
  CLOSE: 'close',
};

/**
 * 把尝试日志规整成「最新在前」的数组。
 *
 * 调用方给的可能是任意顺序，这里统一按 `at` 倒序——顺序判断错一次，
 * 「连续」的语义就整个反了。
 *
 * @param {object[]} history
 * @returns {object[]}
 */
export function normalizeHistory(history) {
  const list = Array.isArray(history) ? [...history] : [];
  return list.sort((a, b) => String(b?.at || '').localeCompare(String(a?.at || '')));
}

/**
 * 数出开头连续有多少次坏状态。
 *
 * @param {object[]} newestFirst 已规整为最新在前的日志
 * @returns {number}
 */
export function consecutiveBad(newestFirst) {
  let n = 0;
  for (const r of newestFirst) {
    if (!BAD_STATES.has(r?.status)) break;
    n += 1;
  }
  return n;
}

/**
 * 做决定。
 *
 * @param {object} opt
 * @param {object[]} opt.history `status/<layer>.ndjson` 读出来的行（任意顺序）
 * @param {number|null} opt.openIssue 未关闭的 issue 编号；没有就 null
 * @param {string} [opt.layer] 层名，用于写进决策里（方便日志）
 * @returns {{
 *   action: string,
 *   layer: string|null,
 *   consecutive: number,
 *   reason: string,
 *   latest: object|null,
 *   firstBad: object|null,
 * }}
 */
export function decideAlert(opt) {
  const { history, openIssue = null, layer = null } = opt || {};
  const rows = normalizeHistory(history);
  const latest = rows[0] || null;

  if (!latest) {
    return {
      action: ALERT_ACTION.NONE,
      layer,
      consecutive: 0,
      reason: '没有历史记录',
      latest: null,
      firstBad: null,
    };
  }

  const bad = consecutiveBad(rows);
  const isHealthy = OK_STATES.has(latest.status);

  /* 恢复：最新一次是 ok，且还没关掉的 issue 存在 → 关掉它。
   * 这是唯一「好消息」路径，也最容易被忘记写。 */
  if (isHealthy && openIssue != null) {
    return {
      action: ALERT_ACTION.CLOSE,
      layer,
      consecutive: 0,
      reason: '已恢复',
      latest,
      firstBad: null,
    };
  }

  if (bad >= CONSECUTIVE_THRESHOLD) {
    const firstBad = rows[bad - 1] || latest;
    if (openIssue != null) {
      return {
        action: ALERT_ACTION.APPEND,
        layer,
        consecutive: bad,
        reason: `连续 ${bad} 次异常，追加到已有 issue #${openIssue}`,
        latest,
        firstBad,
      };
    }
    return {
      action: ALERT_ACTION.OPEN,
      layer,
      consecutive: bad,
      reason: `连续 ${bad} 次异常，开新 issue`,
      latest,
      firstBad,
    };
  }

  return {
    action: ALERT_ACTION.NONE,
    layer,
    consecutive: bad,
    reason: bad === 0 ? '全部正常' : `只连续 ${bad} 次异常，未达阈值`,
    latest,
    firstBad: null,
  };
}

/**
 * issue 要用到的标签与标题（纯函数，方便测试）。
 *
 * @param {string} layer
 * @returns {{labels: string[], title: string}}
 */
export function alertIssueMeta(layer) {
  return {
    labels: ['collect-alert', `layer:${layer}`],
    title: `采集告警：${layer} 连续异常`,
  };
}

/**
 * issue 正文。
 *
 * @param {object} decision decideAlert 的返回值
 * @returns {string}
 */
export function alertBody(decision) {
  const { layer, consecutive, latest, reason } = decision;
  const lines = [
    `**层**：\`${layer}\``,
    `**连续异常次数**：${consecutive}`,
    `**原因**：${reason}`,
    '',
  ];

  if (latest) {
    lines.push('| 字段 | 值 |', '|---|---|');
    lines.push(`| 最新状态 | \`${latest.status}\` |`);
    lines.push(`| 时间 | ${latest.at || '—'} |`);
    lines.push(`| 条数 | ${latest.count ?? '—'} |`);
    lines.push(`| 耗时 | ${latest.ms ?? '—'} ms |`);
    if (latest.error) lines.push(`| 错误 | ${latest.error} |`);
    if (latest.reason) lines.push(`| 说明 | ${latest.reason} |`);
  }

  lines.push('');
  lines.push('> 其它层不受影响：分层门禁只让这一层沿用上一版（S3.5）。');
  return lines.join('\n');
}
