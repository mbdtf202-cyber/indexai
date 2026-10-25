/**
 * Vendor Site Monitoring (T6.5)
 * 
 * Monitor official vendor websites for pricing/model changes
 */

import { httpGet } from './http.js';

// Known vendor monitoring targets
export const MONITORING_TARGETS = {
  openai: {
    name: 'OpenAI',
    url: 'https://openai.com/api-pricing/',
    endpoints: [
      '/pricing',
      '/platform/update-2023',
      '/models',
    ],
  },
  anthropic: {
    name: 'Anthropic',
    url: 'https://www.anthropic.com/pricing',
    endpoints: ['/news'],
  },
  google: {
    name: 'Google',
    url: 'https://ai.google.dev/pricing',
    endpoints: ['/generative-ai/pricing'],
  },
  xai: {
    name: 'xAI',
    url: 'https://x.ai/pricing',
    endpoints: ['/grok'],
  },
  deepseek: {
    name: 'DeepSeek',
    url: 'https://deepseek.com/pricing',
    endpoints: ['/docs'],
  },
};

/**
 * Fetch current snapshot of vendor pricing page
 * @param {string} vendorId - Vendor identifier
 * @returns {Promise<object>} Current state snapshot
 */
export async function fetchVendorSnapshot(vendorId) {
  const target = MONITORING_TARGETS[vendorId];
  if (!target) {
    throw new Error(`Unknown vendor: ${vendorId}`);
  }
  
  try {
    const response = await httpGet(target.url, {
      label: `monitor/${vendorId}`,
      tries: 2,
    });
    
    return {
      vendor_id: vendorId,
      timestamp: new Date().toISOString(),
      status: response.ok ? 'success' : 'error',
      status_code: response.status,
      content_length: parseInt(response.headers.get('content-length')) || 0,
      last_modified: response.headers.get('last-modified'),
      cache_control: response.headers.get('cache-control'),
    };
  } catch (e) {
    return {
      vendor_id: vendorId,
      timestamp: new Date().toISOString(),
      status: 'error',
      error: e.message,
    };
  }
}

/**
 * Compare two snapshots to detect changes
 * @param {object} oldSnapshot - Previous snapshot
 * @param {object} newSnapshot - Current snapshot
 * @returns {object|null} Change detection result or null if no change
 */
export function compareSnapshots(oldSnapshot, newSnapshot) {
  if (!oldSnapshot || !newSnapshot) return null;
  
  const changes = [];
  
  // Check status code changes
  if (oldSnapshot.status_code !== newSnapshot.status_code) {
    changes.push({
      type: 'status_code_change',
      old_value: oldSnapshot.status_code,
      new_value: newSnapshot.status_code,
      severity: 'high',
    });
  }
  
  // Check content length changes (indicates page structure change)
  if (oldSnapshot.content_length !== newSnapshot.content_length) {
    const diffPercent = Math.abs(
      (newSnapshot.content_length - oldSnapshot.content_length) / oldSnapshot.content_length * 100
    );
    changes.push({
      type: 'content_size_change',
      old_value: oldSnapshot.content_length,
      new_value: newSnapshot.content_length,
      percent_change: diffPercent.toFixed(2),
      severity: diffPercent > 10 ? 'medium' : 'low',
    });
  }
  
  // Check last-modified header changes
  if (oldSnapshot.last_modified && newSnapshot.last_modified) {
    const oldDate = new Date(oldSnapshot.last_modified);
    const newDate = new Date(newSnapshot.last_modified);
    
    if (newDate > oldDate) {
      changes.push({
        type: 'page_updated',
        old_date: oldDate.toISOString(),
        new_date: newDate.toISOString(),
        age_hours: Math.floor((newDate - oldDate) / (1000 * 60 * 60)),
        severity: 'low',
      });
    }
  }
  
  return changes.length > 0 ? {
    vendor_id: newSnapshot.vendor_id,
    detected_at: new Date().toISOString(),
    changes,
    has_changes: true,
  } : null;
}

/**
 * Monitor multiple vendors and return results
 * @param {Array<string>} vendorIds - List of vendor IDs to monitor
 * @returns {Promise<Array>} Array of monitoring results
 */
export async function monitorVendors(vendorIds) {
  const results = [];
  
  for (const vendorId of vendorIds) {
    try {
      const snapshot = await fetchVendorSnapshot(vendorId);
      results.push({
        vendor: vendorId,
        snapshot,
        status: snapshot.status,
      });
    } catch (e) {
      results.push({
        vendor: vendorId,
        snapshot: null,
        error: e.message,
        status: 'failed',
      });
    }
  }
  
  return results;
}

/**
 * Calculate monitoring health score
 * @param {Array} results - Monitoring results array
 * @returns {object} Health report
 */
export function calculateHealthScore(results) {
  const total = results.length;
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error' || r.status === 'failed').length;
  
  const successRate = total > 0 ? (successful / total * 100).toFixed(1) : 0;
  
  return {
    total_vendors: total,
    successful_monitors: successful,
    failed_monitors: failed,
    success_rate: `${successRate}%`,
    overall_health: successRate >= 90 ? 'healthy' : successRate >= 70 ? 'degraded' : 'critical',
    details: results.map(r => ({
      vendor: r.vendor,
      status: r.status,
      timestamp: r.snapshot?.timestamp || new Date().toISOString(),
    })),
  };
}

/**
 * Get monitoring schedule recommendations
 * @param {string} vendorId - Vendor identifier
 * @returns {object} Scheduling recommendations
 */
export function getMonitoringSchedule(vendorId) {
  const base_schedule = {
    high_priority: { frequency_hours: 24, reason: 'Frequently updated pricing pages' },
    medium_priority: { frequency_hours: 48, reason: 'Moderate update frequency' },
    low_priority: { frequency_hours: 72, reason: 'Infrequent updates' },
  };
  
  const priority_map = {
    openai: 'high_priority',
    anthropic: 'high_priority',
    google: 'medium_priority',
    xai: 'medium_priority',
    deepseek: 'low_priority',
  };
  
  const priority = priority_map[vendorId] || 'medium_priority';
  
  return {
    vendor: vendorId,
    recommended_frequency: base_schedule[priority].frequency_hours + ' hours',
    reason: base_schedule[priority].reason,
    next_check_window: `${base_schedule[priority].frequency_hours}h ±30min`,
  };
}

// URL query parameter parsing
export function parseMonitorParams(params) {
  const vendors = params.get('vendors')?.split(',') || ['all'];
  const interval = parseInt(params.get('interval')) || 24;
  
  return {
    vendor_ids: vendors[0] === 'all' ? Object.keys(MONITORING_TARGETS) : vendors,
    check_interval: interval * 3600000, // Convert to milliseconds
  };
}

export default {
  fetchVendorSnapshot,
  compareSnapshots,
  monitorVendors,
  calculateHealthScore,
  getMonitoringSchedule,
  parseMonitorParams,
  MONITORING_TARGETS,
};
