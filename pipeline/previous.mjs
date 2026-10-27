/**
 * 上一版从哪读（T4.1 · 第 2 条）。
 *
 * 优先 data 分支的快照目录：那是我们自己的历史，不依赖线上站点是否可达，
 * 也不受 CDN 缓存影响。旧做法从线上 data.json 拉，等于把「上一版」
 * 交给一个每小时可能变一次的外部服务决定。
 *
 * 没有数据目录时才退回 outDir（本地开发与 golden 的路径）。
 */

import { readFile, readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { join } from 'node:path';

import { loadSnapshot } from '../scripts/data-scripts.mjs';

/**
 * 按优先级装配「上一版」。
 *
 * @param {object} opt
 * @param {{id: string}[]} opt.layers 层清单
 * @param {string} opt.outDir 本次输出目录（退回用）
 * @param {string|null} [opt.dataDir] data 分支检出目录
 * @returns {Promise<{prev: object, source: 'data'|'outDir'|'empty', layers: number}>}
 */
export async function loadPrevious(opt) {
  const { layers = [], outDir, dataDir = null } = opt;

  if (dataDir) {
    const prev = {};
    for (const layer of layers) {
      const snap = loadSnapshot(layer.id, { root: dataDir });
      if (snap) prev[layer.id] = snap;
    }
    const n = Object.keys(prev).length;
    if (n) return { prev, source: 'data', layers: n };
  }

  try {
    const text = await readFileAsync(join(outDir, 'data.json'), 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return { prev: parsed, source: 'outDir', layers: Object.keys(parsed).length };
    }
  } catch {
    // 首次运行：没有上一版是正常的
  }

  return { prev: {}, source: 'empty', layers: 0 };
}

/**
 * 读取上一版完整评测快照（F02）。
 *
 * 必须从 `bench.json` 读，不能从 `data.json`：后者只存目录（`boards` 已拆出去），
 * `prev.bench.boards` 恒为空——这正是「失败沿用上次」在线上从未生效的根因。
 *
 * 缺文件／坏 JSON／缺 boards 一律返回 null（首次运行的合法情况）。
 */
export function readPrevBench(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.boards) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 造一个「读该层历史条数」的函数（T4.7 · S4.1）。
 *
 * 门禁要拿近 7 次成功快照的中位数当基线，数据来自 data 分支的
 * `status/<layer>.ndjson`。没有数据目录时返回 null——门禁会退回
 * 「只看上一版」并在原因里说明，而不是假装检查过。
 *
 * 结果带缓存：一次运行里每层只读一次文件。
 *
 * @param {string|null} dataDir
 * @returns {(layerId: string) => number[]|null}
 */
export function createHistoryReader(dataDir) {
  const cache = new Map();

  return (layerId) => {
    if (cache.has(layerId)) return cache.get(layerId);

    let counts = null;
    if (dataDir) {
      try {
        const rows = readAttempts(layerId, { root: dataDir });
        const ok = rows.filter((r) => r.status === 'ok').map((r) => Number(r.count) || 0);
        counts = ok.length ? ok : null;
      } catch {
        counts = null;
      }
    }

    cache.set(layerId, counts);
    return counts;
  };
}
