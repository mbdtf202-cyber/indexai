/**
 * 层契约校验（S4.4 · INV-11 · T3.1c）。
 *
 * 编排器只认契约，不认具体层。所以契约本身必须是**可执行的**——
 * 否则「每层导出同一形状」只是一句愿望，第一个写歪的层会让编排器在运行中途炸。
 *
 * 这里做两件事：
 * 1. `validateLayer(mod, { id })`：形状校验，返回问题列表（空数组 = 合规）；
 * 2. `loadLayers(dir)`：扫描 `pipeline/layers/<id>/index.js`，逐个校验，
 *    有任何一层不合规就抛出——**在模块加载期就失败**，而不是等到跑采集。
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 契约要求的键。缺一个都不算层。 */
const REQUIRED_KEYS = ['id', 'sources', 'budget', 'fetch', 'normalize', 'merge', 'health'];

/** 契约要求的 health 子键。 */
const REQUIRED_HEALTH = ['floor', 'shrink', 'freshness', 'rules'];

/**
 * 校验一个层模块的形状。
 *
 * @param {unknown} mod 默认导出
 * @param {{ expectedId?: string }} [opt]
 * @returns {string[]} 问题列表；空数组表示合规
 */
export function validateLayer(mod, opt = {}) {
  const problems = [];
  if (!mod || typeof mod !== 'object') return ['默认导出不是对象'];

  for (const key of REQUIRED_KEYS) {
    if (!(key in mod)) problems.push(`缺少 ${key}`);
  }
  if (problems.length) return problems;

  if (typeof mod.id !== 'string' || !mod.id) problems.push('id 必须是非空字符串');
  if (opt.expectedId && mod.id !== opt.expectedId) {
    problems.push(`id 应等于目录名 ${opt.expectedId}，实际 ${mod.id}`);
  }

  if (!Array.isArray(mod.sources)) problems.push('sources 必须是数组');
  else if (mod.sources.some((s) => typeof s !== 'string' || !s)) {
    problems.push('sources 里必须都是非空字符串');
  }

  const { ms, requests } = mod.budget || {};
  if (!(Number.isFinite(ms) && ms > 0)) problems.push('budget.ms 必须是正数');
  if (!(Number.isFinite(requests) && requests > 0)) problems.push('budget.requests 必须是正数');

  for (const fn of ['fetch', 'normalize', 'merge']) {
    if (typeof mod[fn] !== 'function') problems.push(`${fn} 必须是函数`);
  }

  if (!mod.health || typeof mod.health !== 'object') {
    problems.push('health 必须是对象');
  } else {
    for (const key of REQUIRED_HEALTH) {
      if (!(key in mod.health)) problems.push(`health 缺少 ${key}`);
    }
    if (mod.health.rules !== undefined && !Array.isArray(mod.health.rules)) {
      problems.push('health.rules 必须是数组');
    }
  }

  return problems;
}

/**
 * 扫描并加载所有层。
 *
 * @param {string} dir `pipeline/layers` 的绝对路径
 * @returns {Promise<Map<string, object>>} id → 层模块
 */
export async function loadLayers(dir) {
  const layers = new Map();
  const problems = [];

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return layers;
  }

  for (const name of entries.sort()) {
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const mod = (await import(join(full, 'index.js'))).default;
    const found = validateLayer(mod, { expectedId: name });
    if (found.length) {
      problems.push(`${name}: ${found.join('；')}`);
      continue;
    }
    layers.set(mod.id, mod);
  }

  if (problems.length) {
    throw new Error(`层契约不合规（S4.4）：\n  ${problems.join('\n  ')}`);
  }
  return layers;
}
