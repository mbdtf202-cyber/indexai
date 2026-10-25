/**
 * Dynamic Baseline Guards (T4.7)
 * 
 * Statistical base-line detection using median of recent successful snapshots
 * Replaces hard-coded thresholds with data-driven decision making
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Conservative absolute lower bounds (safety net for insufficient data)
export const ABSOLUTE_LOWER_BOUNDS = {
  models_count_min: 50,           // Min models before baseline applies
  benchmarks_count_min: 3,        // Min benchmark boards
  gateways_min: 10,              // Min active gateways
  price_changes_per_day: 0.1,    // Normal range: ~10% daily changes
};

/**
 * Calculate median from sorted array
 */
export function calculateMedian(sortedArray) {
  if (!sortedArray || sortedArray.length === 0) return null;
  
  const mid = Math.floor(sortedArray.length / 2);
  
  if (sortedArray.length % 2 === 0) {
    return (sortedArray[mid - 1] + sortedArray[mid]) / 2;
  }
  
  return sortedArray[mid];
}

/**
 * Get last N successful snapshot counts
 */
export function getLastNSnapshots(layer, n = 7) {
  try {
    const statusFile = join(ROOT, '.data', 'status', `${layer}.ndjson`);
    
    if (!existsSync(statusFile)) {
      return [];
    }
    
    const content = readFileSync(statusFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    
    // Parse only success entries and extract model counts
    const successfulSnapshots = lines
      .map(line => JSON.parse(line))
      .filter(entry => entry.status === 'ok')
      .slice(0, n)
      .map(entry => entry.count || entry.models?.length || entry.bench?.boards?.length || 0);
    
    return successfulSnapshots.sort((a, b) => a - b);
  } catch (e) {
    console.warn(`Failed to load snapshots for ${layer}:`, e.message);
    return [];
  }
}

/**
 * Generate dynamic baseline based on recent history
 */
export function generateDynamicBaseline(layer, options = {}) {
  const { windowSize = 7 } = options;
  
  const recentCounts = getLastNSnapshots(layer, windowSize);
  
  if (recentCounts.length < windowSize / 2) {
    // Insufficient data - fall back to absolute lower bounds
    return {
      type: 'insufficient_data',
      fallback_to_absolute_bounds: true,
      recent_samples: recentCounts.length,
      required_samples: windowSize,
      baseline_value: getAbsoluteLowerBound(layer),
      reason: '不足最近 7 次快照数据，退回绝对下限保护',
    };
  }
  
  // Calculate median of recent counts
  const median = calculateMedian(recentCounts);
  
  return {
    type: 'statistical_baseline',
    fallback_to_absolute_bounds: false,
    recent_samples: recentCounts.length,
    baseline_value: median,
    percentiles: {
      p25: calculatePercentile(recentCounts, 25),
      p50: median,
      p75: calculatePercentile(recentCounts, 75),
    },
    threshold_config: {
      warn_threshold: median * 0.9,      // 10% below median = warning
      block_threshold: median * 0.8,     // 20% below median = block
    },
  };
}

/**
 * Calculate percentile from sorted array
 */
function calculatePercentile(sortedArray, percentile) {
  if (!sortedArray || sortedArray.length === 0) return null;
  
  const index = (percentile / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  
  if (lower === upper) {
    return sortedArray[lower];
  }
  
  return sortedArray[lower] * (upper - index) + sortedArray[upper] * (index - lower);
}

/**
 * Get absolute lower bound for layer
 */
export function getAbsoluteLowerBound(layer) {
  switch (layer) {
    case 'models':
      return ABSOLUTE_LOWER_BOUNDS.models_count_min;
    case 'benchmarks':
      return ABSOLUTE_LOWER_BOUNDS.benchmarks_count_min;
    case 'gateways':
      return ABSOLUTE_LOWER_BOUNDS.gateways_min;
    default:
      return 0;
  }
}

/**
 * Check if current snapshot passes baseline guard
 */
export function checkBaselineGuard(currentCount, baseline, options = {}) {
  const {
    warnThreshold = baseline.threshold_config?.warn_threshold,
    blockThreshold = baseline.threshold_config?.block_threshold,
  } = options;
  
  if (!currentCount) {
    return {
      passes: false,
      severity: 'critical',
      reason: '当前值为 0',
      action: 'block',
    };
  }
  
  if (baseline.fallback_to_absolute_bounds) {
    // Use absolute bounds for safety
    if (currentCount < getAbsoluteLowerBound(baseline.type.split('_')[0])) {
      return {
        passes: false,
        severity: 'critical',
        reason: `低于安全下限 (${currentCount} < ${getAbsoluteLowerBound('models')})`,
        action: 'block',
        baseline_type: 'absolute_bounds',
      };
    }
    
    return {
      passes: true,
      severity: 'normal',
      reason: '符合安全下限保护',
      action: 'allow',
      baseline_type: 'absolute_bounds',
    };
  }
  
  // Use statistical baseline
  if (currentCount < blockThreshold) {
    return {
      passes: false,
      severity: 'critical',
      reason: `严重缩水 (${currentCount} < ${blockThreshold.toFixed(1)})`,
      action: 'block',
      deviation_percent: ((currentCount - baseline.baseline_value) / baseline.baseline_value * 100).toFixed(1),
      baseline_type: 'statistical_median',
    };
  }
  
  if (currentCount < warnThreshold) {
    return {
      passes: true,
      severity: 'warning',
      reason: `轻度缩水 (${currentCount} < ${warnThreshold.toFixed(1)}, ≥${blockThreshold})`,
      action: 'allow_with_warning',
      deviation_percent: ((currentCount - baseline.baseline_value) / baseline.baseline_value * 100).toFixed(1),
      baseline_type: 'statistical_median',
    };
  }
  
  return {
    passes: true,
    severity: 'normal',
    reason: '正常范围',
    action: 'allow',
    baseline_type: 'statistical_median',
  };
}

// CLI usage
if (process.argv[1]?.endsWith('baseline-guard.js')) {
  const layer = process.argv[2] || 'models';
  const currentCount = parseInt(process.argv[3]);
  
  const baseline = generateDynamicBaseline(layer);
  const result = checkBaselineGuard(currentCount, baseline);
  
  console.log('=== Dynamic Baseline Guard Report ===\n');
  console.log('Layer:', layer);
  console.log('Current Count:', currentCount);
  console.log('Baseline Type:', baseline.type);
  console.log('Recent Samples:', baseline.recent_samples);
  console.log('Baseline Value:', baseline.baseline_value);
  console.log('\nGuard Result:');
  console.log('- Passes:', result.passes);
  console.log('- Severity:', result.severity);
  console.log('- Reason:', result.reason);
  console.log('- Action:', result.action);
  console.log('- Deviation:', result.deviation_percent ? result.deviation_percent + '%' : 'N/A');
}

export default { 
  calculateMedian,
  getLastNSnapshots,
  generateDynamicBaseline,
  checkBaselineGuard,
  getAbsoluteLowerBound,
  ABSOLUTE_LOWER_BOUNDS,
};
