/**
 * Data 分支相关脚本（T4.1）
 *
 * 这些脚本用于：
 * 1. 创建/初始化 data 分支
 * 2. 从 data 分支拉取快照用于本地构建
 * 3. 发布新的快照到 data 分支
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** 创建或更新 data 分支的快照 */
export function snapshotLayer(layer, data) {
  const snapshotsDir = '.data/snapshots';
  if (!existsSync(snapshotsDir)) {
    mkdirSync(snapshotsDir, { recursive: true });
  }

  // 稳定排序后写入 JSON 文件
  const filepath = join(snapshotsDir, `${layer}.json`);
  writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');
  console.log(`[snapshot] ${layer} saved to ${filepath}`);
}

/** 从 data 分支读取指定层的快照 */
export function loadSnapshot(layer) {
  const filepath = `.data/snapshots/${layer}.json`;
  try {
    return JSON.parse(require('fs').readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.warn(`[snapshot] No snapshot found for ${layer}`);
    return null;
  }
}

/** 记录尝试状态到 ndjson 日志 */
export function recordAttempt(layer, attempt) {
  const statusFile = `.data/status/${layer}.ndjson`;
  require('fs').appendFileSync(
    statusFile,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...attempt,
    }) + '\n',
  );
}

export default {
  snapshotLayer,
  loadSnapshot,
  recordAttempt,
};
