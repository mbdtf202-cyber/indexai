/**
 * Model Matching Engine (T4.5)
 * 
 * Match model names using exact aliases → canonical IDs mapping
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let _modelsCache = null;

export function getModelsRegistry() {
  if (!_modelsCache) {
    const registryPath = join(ROOT, 'registry', 'models.json');
    try {
      _modelsCache = JSON.parse(readFileSync(registryPath, 'utf8'));
    } catch (e) {
      console.warn('Failed to load models registry:', e.message);
      _modelsCache = { models: [] };
    }
  }
  return _modelsCache;
}

export class ModelMatcher {
  constructor(registry = null) {
    this.registry = registry || getModelsRegistry();
    this._buildIndex();
  }
  
  _buildIndex() {
    // Build reverse index: name/alias → canonical ID
    this.aliasMap = new Map();
    
    for (const model of this.registry.models || []) {
      // Add canonical name
      this.aliasMap.set(model.name.toLowerCase(), { id: model.id, isCanonical: true });
      
      // Add aliases
      if (model.aliases) {
        for (const alias of model.aliases) {
          this.aliasMap.set(alias.toLowerCase(), { id: model.id, isAlias: true });
        }
      }
      
      // Add family names for grouping
      if (model.family) {
        this.aliasMap.set(model.family.toLowerCase(), { 
          id: model.id, 
          isFamily: true,
          familyName: model.family 
        });
      }
    }
  }
  
  /**
   * Exact match first, then alias resolution
   */
  match(input) {
    if (!input || typeof input !== 'string') {
      return { matched: false, result: null };
    }
    
    const lowerInput = input.toLowerCase().trim();
    const result = this.aliasMap.get(lowerInput);
    
    if (result) {
      return { 
        matched: true, 
        result: { ...result, original: input },
        matchType: result.isCanonical ? 'exact' : (result.isAlias ? 'alias' : 'family')
      };
    }
    
    return { matched: false, result: null, matchType: 'none' };
  }
  
  /**
   * Resolve variant to parent model
   */
  resolveVariant(modelName) {
    const match = this.match(modelName);
    
    if (!match.matched || !match.result?.id) {
      return null;
    }
    
    // Find the base model info
    const model = this.registry.models.find(m => m.id === match.result.id);
    
    // Check if this is a variant suffix
    const variantSuffixes = ['-thinking', '-high', '-low', '-flash', '-turbo'];
    const hasVariant = variantSuffixes.some(suffix => modelName.toLowerCase().endsWith(suffix));
    
    if (hasVariant && model) {
      return {
        parentId: model.id.replace(/-\w+$/, ''), // Strip variant suffix
        variantName: modelName,
        parentModel: model.name
      };
    }
    
    return { parentId: model.id, variantName: null, parentModel: model.name };
  }
  
  /**
   * Get all known model IDs
   */
  getAllIds() {
    return this.registry.models.map(m => m.id);
  }
}

// CLI usage
if (process.argv[1]?.endsWith('match.js')) {
  const matcher = new ModelMatcher();
  const testInputs = process.argv.slice(2);
  
  for (const input of testInputs) {
    const result = matcher.match(input);
    console.log(`[${input}] ${JSON.stringify(result, null, 2)}`);
  }
}

export default { ModelMatcher, getModelsRegistry };
