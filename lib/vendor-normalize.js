/**
 * Vendor Normalization (T4.4)
 * 
 * Normalize vendor names using canonical registry
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * Load vendor registry
 */
let _registryCache = null;

export function getVendorRegistry() {
  if (!_registryCache) {
    const registryPath = join(ROOT, 'registry', 'vendors.json');
    try {
      _registryCache = JSON.parse(readFileSync(registryPath, 'utf8'));
    } catch (e) {
      console.warn('Failed to load vendor registry:', e.message);
      _registryCache = { vendors: [], aliases: {} };
    }
  }
  return _registryCache;
}

/**
 * Normalize vendor name to canonical ID
 * @param {string} input - Input vendor name
 * @returns {{id: string|null, aliasUsed: string|null}} Canonical vendor info
 */
export function normalizeVendor(input) {
  const registry = getVendorRegistry();
  
  if (!input || typeof input !== 'string') {
    return { id: null, aliasUsed: null, matched: false };
  }
  
  const lowerInput = input.toLowerCase().trim();
  
  // Check exact matches first
  const exactMatch = registry.vendors.find(v => v.name.toLowerCase() === lowerInput);
  if (exactMatch) {
    return { id: exactMatch.id, aliasUsed: null, matched: true };
  }
  
  // Check aliases
  for (const [alias, targets] of Object.entries(registry.aliases || {})) {
    if (alias.toLowerCase() === lowerInput) {
      const targetId = targets[0];
      const vendor = registry.vendors.find(v => v.id === targetId);
      if (vendor) {
        return { id: targetId, aliasUsed: alias, matched: true };
      }
    }
  }
  
  // No match found
  return { id: null, aliasUsed: null, matched: false };
}

/**
 * Get all known vendor IDs
 */
export function getKnownVendors() {
  const registry = getVendorRegistry();
  return registry.vendors.map(v => v.id);
}

// CLI usage
if (process.argv[1]?.endsWith('vendor-normalize.js')) {
  const input = process.argv[2] || 'Test Vendor Name';
  const result = normalizeVendor(input);
  console.log(JSON.stringify(result, null, 2));
}

export default { normalizeVendor, getVendorRegistry, getKnownVendors };
