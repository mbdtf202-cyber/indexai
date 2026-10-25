/**
 * Model Clustering & Deduplication (T6.4)
 * 
 * Identifies and clusters equivalent models across different vendors/sources
 */

import { getVendorRegistry } from './vendor-normalize.js';

// Model equivalence rules
export const MODEL_RULES = {
  // Exact name matches (normalized case-insensitive)
  exact_name: 'exact',
  
  // Semantic similarity rules
  semantic_match: [
    { family: 'gpt', aliases: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-4'] },
    { family: 'claude', aliases: ['claude-sonnet', 'claude-opus', 'claude-haiku'] },
    { family: 'gemini', aliases: ['gemini-pro', 'gemini-ultra', 'gemini-advanced'] },
    { family: 'llama', aliases: ['llama-3', 'llama-3-70b', 'llama-3-8b'] },
  ],
};

/**
 * Normalize model names for comparison
 * @param {string} modelId - Raw model identifier
 * @returns {object} Normalized representation
 */
export function normalizeModelName(modelId) {
  if (!modelId) return null;
  
  const lower = modelId.toLowerCase();
  
  // Remove common prefixes/suffixes
  const cleaned = lower
    .replace(/^model[-_]?/, '')
    .replace(/[-_][vV][0-9]+$/, '')
    .replace(/[-_]final$/i, '')
    .replace(/[-_]lite$/i, '')
    .trim();
  
  // Extract family from ID
  const parts = cleaned.split('-');
  const family = parts[0] || 'unknown';
  
  return {
    original: modelId,
    normalized: cleaned,
    family: family,
    vendor_prefix: extractVendorPrefix(modelId),
  };
}

/**
 * Extract vendor prefix from model ID
 */
function extractVendorPrefix(modelId) {
  // Common patterns: openai/gpt-4, anthropic/claude, etc.
  const slashMatch = modelId.match(/^([^\/]+)\//);
  if (slashMatch) return slashMatch[1].toLowerCase();
  
  return inferVendorFromName(normalizeModelName(modelId)?.normalized || '');
}

/**
 * Infer vendor from model name pattern
 */
function inferVendorFromName(name) {
  if (name.includes('gpt')) return 'openai';
  if (name.includes('claude')) return 'anthropic';
  if (name.includes('gemini')) return 'google';
  if (name.includes('llama') || name.includes('l')) return 'meta';
  if (name.includes('grok')) return 'xai';
  if (name.includes('deepseek') || name.includes('ds-')) return 'deepseek';
  
  return 'unknown';
}

/**
 * Check if two models are likely the same
 * @param {object} modelA - First model info
 * @param {object} modelB - Second model info
 * @returns {boolean} Whether they're considered equivalent
 */
export function areModelsEquivalent(modelA, modelB) {
  const normA = normalizeModelName(modelA.id);
  const normB = normalizeModelName(modelB.id);
  
  if (!normA || !normB) return false;
  
  // Rule 1: Exact normalized match
  if (normA.normalized === normB.normalized) {
    return true;
  }
  
  // Rule 2: Same family + close pricing (±20%)
  if (normA.family === normB.family && Math.abs(normA.family)) {
    const priceDiff = calculatePriceDifference(modelA, modelB);
    return priceDiff <= 0.2; // Within 20%
  }
  
  return false;
}

/**
 * Calculate price difference between two models
 */
function calculatePriceDifference(modelA, modelB) {
  const priceA = (modelA.input_price || 0) + (modelA.output_price || 0);
  const priceB = (modelB.input_price || 0) + (modelB.output_price || 0);
  
  if (priceA === 0 || priceB === 0) return 1.0; // Undefined
  
  const diff = Math.abs(priceA - priceB);
  return diff / Math.max(priceA, priceB);
}

/**
 * Cluster models by equivalence
 * @param {Array} models - List of all model objects
 * @returns {Array} Clusters of equivalent models
 */
export function clusterEquivalentModels(models) {
  if (!models || models.length === 0) return [];
  
  const clusters = [];
  const visited = new Set();
  
  for (const model of models) {
    if (visited.has(model.id)) continue;
    
    const cluster = [model];
    visited.add(model.id);
    
    // Find all equivalents
    for (const other of models) {
      if (visited.has(other.id)) continue;
      
      if (areModelsEquivalent(model, other)) {
        cluster.push(other);
        visited.add(other.id);
      }
    }
    
    if (cluster.length > 1) {
      clusters.push({
        representatives: getRepresentatives(cluster),
        members: cluster.map(m => ({
          id: m.id,
          vendor: m.vendor_id || inferVendorFromName(m.name),
          name: m.name,
          price: (m.input_price || 0).toFixed(3),
        })),
      });
    }
  }
  
  // Return only multi-member clusters (deduped items)
  return clusters.filter(c => c.members.length > 1);
}

/**
 * Get representative model from cluster
 */
function getRepresentatives(cluster) {
  // Sort by number of appearances (most authoritative first)
  cluster.sort((a, b) => (b.appearances || 0) - (a.appearances || 0));
  
  return cluster.slice(0, 3).map(m => ({
    id: m.id,
    vendor: m.vendor_id,
    source_count: m.source_count || 1,
  }));
}

/**
 * Generate deduplication report
 * @param {Array} clusters - Model clusters
 * @returns {object} Report summary
 */
export function generateDedupReport(clusters) {
  if (!clusters || clusters.length === 0) {
    return {
      total_models: 0,
      unique_families: 0,
      potential_duplicates: [],
      recommendations: [],
    };
  }
  
  const totalUniqueModels = clusters.reduce((sum, c) => sum + c.members.length, 0);
  const potentialDuplicates = clusters.map(c => ({
    family: c.representatives?.[0]?.vendor || 'unknown',
    count: c.members.length,
    ids: c.members.map(m => m.id),
  }));
  
  return {
    total_clusters: clusters.length,
    total_unique_models: totalUniqueModels,
    potential_duplicates: potentialDuplicates,
    recommendations: suggestClusteringActions(potentialDuplicates),
  };
}

/**
 * Suggest clustering actions
 */
function suggestClusteringActions(duplicates) {
  const suggestions = [];
  
  for (const d of duplicates) {
    if (d.count >= 3) {
      suggestions.push({
        priority: 'high',
        action: 'consolidate',
        reason: `${d.count} versions detected, recommend consolidating`,
        affected: d.ids,
      });
    } else if (d.count === 2) {
      suggestions.push({
        priority: 'medium',
        action: 'review',
        reason: 'Two versions found, consider merging or documenting differences',
        affected: d.ids,
      });
    }
  }
  
  return suggestions;
}

// Utility for URL query parsing
export function parseClustersFromURL(params) {
  const showDuplicates = params.get('show_duplicates') !== 'false';
  const limit = parseInt(params.get('limit')) || 50;
  
  return {
    filter: showDuplicates ? 'all' : 'unique-only',
    limit,
  };
}

export default {
  normalizeModelName,
  areModelsEquivalent,
  clusterEquivalentModels,
  generateDedupReport,
  parseClustersFromURL,
  MODEL_RULES,
};
