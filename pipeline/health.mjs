/**
 * 门禁校验与状态管理模块（T3.1d Round 5 - R3 合规模块化拆分）。
 *
 * 本模块负责：
 * - 层契约验证（assertLayers）
 * - Luma 有状态封禁管理
 * - 各源的状态追踪与重置
 * 
 * 与其他模块解耦，只提供门禁相关函数。
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, fileURLToPath } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* ==================== LUMA 状态管理 ==================== */

// Luma 有状态封禁状态机
let lumaState = { blocked: false, reason: null, cooldownMs: 0, gaveUp: 0 };

/** 重置 Luma 状态（测试用） */
export function resetLumaState() {
  lumaState = { blocked: false, reason: null, cooldownMs: 0, gaveUp: 0 };
}

/** 获取当前封禁快照 */
export function getLumaBlockState() {
  return { ...lumaState };
}

/** 更新封禁状态 */
export function updateLumaState(blocked, reason, cooldownMs) {
  lumaState.blocked = blocked;
  lumaState.reason = reason;
  lumaState.cooldownMs = cooldownMs || 0;
}

/* ==================== 层契约验证 ==================== */

/**
 * 验证所有已加载的层是否符合契约要求。
 * @param {Map<string, object>} layersMap 层名到层对象的映射
 */
export function assertLayers(layersMap) {
  const requiredKeys = ['id', 'sources', 'budget', 'fetch', 'normalize', 'merge', 'health'];
  
  for (const [name, layer] of layersMap) {
    // 检查必需键
    for (const key of requiredKeys) {
      if (!(key in layer)) {
        throw new Error(`层 ${name} 缺少必需键：${key}`);
      }
    }
    
    // 检查 budget 结构
    if (!layer.budget || typeof layer.budget !== 'object') {
      throw new Error(`层 ${name} 的 budget 必须是对象`);
    }
    if (typeof layer.budget.ms !== 'number' || typeof layer.budget.requests !== 'number') {
      throw new Error(`层 ${name} 的 budget.ms 和 budget.requests 必须是数字`);
    }
    
    // 检查健康检查规则
    if (!layer.health || !Array.isArray(layer.health.rules)) {
      throw new Error(`层 ${name} 的 health 必须包含 rules 数组`);
    }
  }
}

export default {
  lumaState,
  resetLumaState,
  getLumaBlockState,
  updateLumaState,
  assertLayers,
};
