/**
 * Price/State Sequence Generator (T4.8)
 * 
 * Generate time-series data storing ONLY change points (not full snapshots)
 * Supports: models, relays, subs subscriptions
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { nowISO } from './clock.js';
import { dirname } from 'node:path';
/**
 * Compare two snapshots and extract ONLY changed fields
 */
export function extractChanges(prev, current, options = {}) {
  const { includeTimestamps = true } = options;
  
  if (!prev || !current) return null;
  
  const changes = {};
  const timestamps = includeTimestamps ? {} : null;
  
  // Get all unique keys from both objects
  const allKeys = new Set([...Object.keys(prev || {}), ...Object.keys(current || {})]);
  
  for (const key of allKeys) {
    const prevValue = prev[key];
    const currentValue = current[key];
    
    if (JSON.stringify(prevValue) !== JSON.stringify(currentValue)) {
      changes[key] = {
        old: prevValue,
        new: currentValue,
      };
      
      if (timestamps) {
        timestamps[key] = {
          timestamp: nowISO(),
        };
      }
    }
  }
  
  return Object.keys(changes).length > 0 
    ? { changes, timestamps } 
    : null;
}

/**
 * Append change point to existing sequence
 */
export function appendToSequence(sequenceFile, changePoint, options = {}) {
  const { ensureDir = true } = options;
  
  const seqDir = dirname(sequenceFile);
  if (ensureDir && !existsSync(seqDir)) {
    mkdirSync(seqDir, { recursive: true });
  }
  
  // Load existing sequence or create empty
  let sequence = [];
  try {
    if (existsSync(sequenceFile)) {
      const content = readFileSync(sequenceFile, 'utf8');
      sequence = JSON.parse(content);
    }
  } catch (e) {
    console.warn(`Failed to load sequence ${sequenceFile}:`, e.message);
    sequence = [];
  }
  
  // Append new change point
  sequence.push({
    date: nowISO().slice(0, 10),
    timestamp: nowISO(),
    changes: changePoint.changes,
    summary: generateSummary(changePoint.changes),
  });
  
  // Write back
  writeFileSync(sequenceFile, JSON.stringify(sequence, null, 2) + '\n');
  
  return {
    sequence_length: sequence.length,
    last_change_date: sequence[sequence.length - 1].date,
  };
}

/**
 * Generate human-readable summary of changes
 */
function generateSummary(changes) {
  const summaryParts = [];
  
  for (const [key, { old, new: newval }] of Object.entries(changes)) {
    if (typeof newval === 'number') {
      const diff = newval - old;
      const sign = diff > 0 ? '+' : '';
      summaryParts.push(`${key}: ${sign}${diff.toFixed(3)}`);
    } else if (typeof newval === 'boolean') {
      summaryParts.push(`${key}: ${old} → ${newval}`);
    } else if (Array.isArray(newval) && Array.isArray(old)) {
      summaryParts.push(`${key}.count: ${old.length} → ${newval.length}`);
    } else {
      summaryParts.push(`${key}: ${String(old)} → ${String(newval)}`);
    }
  }
  
  return summaryParts.join(', ');
}

/**
 * Extract model price changes between two daily snapshots
 */
export function generateModelSequence(prevSnapshot, currentSnapshot) {
  if (!prevSnapshot?.data?.models || !currentSnapshot?.data?.models) {
    return null;
  }
  
  const prevMap = new Map(prevSnapshot.data.models.map(m => [m.id, m]));
  const currentMap = new Map(currentSnapshot.data.models.map(m => [m.id, m]));
  
  const changes = [];
  
  // Check for price updates on existing models
  for (const [id, curr] of currentMap) {
    const prev = prevMap.get(id);
    if (prev) {
      const idChanges = extractChanges(prev, curr, { includeTimestamps: false });
      if (idChanges) {
        changes.push({
          type: 'price_update',
          model_id: id,
          model_name: curr.name,
          changes: idChanges.changes,
        });
      }
    }
  }
  
  return {
    generated_at: nowISO(),
    source_date: currentSnapshot.meta?.generated_at || nowISO(),
    total_changes: changes.length,
    changes,
  };
}

/**
 * Generate relay state sequence
 */
export function generateRelaySequence(prevStatus, currentStatus) {
  if (!prevStatus || !currentStatus) return null;
  
  const changes = extractChanges(prevStatus, currentStatus, { includeTimestamps: false });
  
  if (!changes) return null;
  
  return {
    generated_at: nowISO(),
    source_date: currentStatus.timestamp || nowISO(),
    domain: currentStatus.domain || 'unknown',
    status_changes: changes.changes,
  };
}

/**
 * Generate subscription pricing sequence
 */
export function generateSubSequence(prevPlan, currentPlan) {
  if (!prevPlan || !currentPlan) return null;
  
  const changes = extractChanges(prevPlan, currentPlan, { includeTimestamps: false });
  
  if (!changes) return null;
  
  return {
    generated_at: nowISO(),
    source_date: currentPlan.timestamp || nowISO(),
    plan_id: currentPlan.plan_id || currentPlan.slug,
    vendor: currentPlan.vendor,
    pricing_changes: changes.changes,
  };
}

// CLI usage
if (process.argv[1]?.endsWith('sequence-generator.js')) {
  console.log('Usage examples:');
  console.log('  node sequence-generator.js --type=models --prev=./fixtures/data-prev.json --current=./fixtures/data-current.json --output=./.data/series/models/gpt-5.json');
  console.log('  node sequence-generator.js --type=relay --prev=../status/relay-prev.ndjson --current=../status/relay-current.ndjson --output=./.data/series/relays/api.example.com.json');
  console.log('  node sequence-generator.js --type=subs --prev=./plans-chatgpt-prev.json --current=./plans-chatgpt-current.json --output=./.data/series/subs/chatgpt-plus.json');
  process.exit(0);
}

export default { 
  extractChanges,
  appendToSequence,
  generateModelSequence,
  generateRelaySequence,
  generateSubSequence,
};
