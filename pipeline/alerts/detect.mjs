/**
 * 告警检测器（T4.2 Round 1）
 *
 * 纯函数：读 status/<layer>.ndjson → 判断是否应该开/追加/关闭 issue
 */

import { existsSync, readFileSync } from 'node:fs';
import { now } from '../../lib/clock.js';
import { join } from 'node:path';

const ROOT = process.cwd();

/**
 * 解读单条状态记录
 */
export function parseStatusLine(line) {
  try {
    const obj = JSON.parse(line);
    return {
      ...obj,
      timestamp: new Date(obj.timestamp || now().getTime()),
    };
  } catch (_e) {
    console.warn('[parse] Invalid JSON line:', line.slice(0, 50));
    return null;
  }
}

/**
 * 读取指定层的所有状态记录
 */
export function loadLayerHistory(layer) {
  const filepath = join(ROOT, '.data', 'status', `${layer}.ndjson`);
  if (!existsSync(filepath)) return [];

  const content = readFileSync(filepath, 'utf8');
  const lines = content
    .trim()
    .split('\n')
    .filter((l) => l);

  return lines
    .map(parseStatusLine)
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp); // 最新在前
}

/**
 * 检测告警决策
 * @returns { 'open' | 'append' | 'close' | 'none' } decision type
 */
export function detectAlertDecision(history, _options = {}) {
  const RED_STATES = ['failed', 'red'];
  const STALE_STATES = ['stale'];
  const RECOVERY_STATES = ['ok'];

  const recent = history.slice(0, 30); // 最近 30 次

  let redCount = 0;
  let staleCount = 0;
  let lastState = null;
  let firstBadState = null;

  for (const record of recent) {
    if (RED_STATES.includes(record.status)) {
      redCount += 1;
      if (!firstBadState) firstBadState = record;
    } else if (STALE_STATES.includes(record.status)) {
      staleCount += 1;
      if (!firstBadState) firstBadState = record;
    } else if (RECOVERY_STATES.includes(record.status)) {
      // 恢复状态出现
    } else {
      // 其他状态也视为问题
      if (!firstBadState) firstBadState = record;
    }
    lastState = record;
  }

  // 规则 1: 连续两次 red/stale → open issue
  if (redCount >= 2 || staleCount >= 2) {
    return { action: 'open', reason: '连续两次以上失败或过时', firstBad: firstBadState };
  }

  // 规则 2: 有 bad state 且之前已有 issue → append
  if (firstBadState && (redCount >= 1 || staleCount >= 1)) {
    return { action: 'append', reason: '持续性问题', firstBad: firstBadState };
  }

  // 规则 3: 从 bad 恢复为 ok → close issue
  const hasRecovery = recent.some((r) => RECOVERY_STATES.includes(r.status));
  const hadBad = history.length > 0 && history.some((r) => !RECOVERY_STATES.includes(r.status));
  if (hasRecovery && hadBad && lastState && RECOVERY_STATES.includes(lastState.status)) {
    return { action: 'close', reason: '已恢复', lastOk: lastState };
  }

  return { action: 'none', reason: '无需操作' };
}

// CLI usage
if (process.argv[1]?.endsWith('detect.mjs')) {
  const layer = process.argv[2];
  if (!layer) {
    console.error('Usage: node detect.mjs <layer>');
    process.exit(1);
  }

  const history = loadLayerHistory(layer);
  console.log(`[alert] Loaded ${history.length} records for ${layer}`);

  const decision = detectAlertDecision(history);
  console.log(JSON.stringify(decision, null, 2));
}

export default { parseStatusLine, loadLayerHistory, detectAlertDecision };
