/**
 * Unmatched Report Generator (T4.6)
 * 
 * Generate reports for un-matched models and identify quality thresholds
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Quality threshold configuration
export const QUALITY_THRESHOLDS = {
  min_reviews: 100,           // Minimum reviews before model appears in rankings
  min_source_coverage: 2,     // Min source coverage (official + aggregator)
  max_price_deviation: 50,    // Max price deviation % from reference
  min_benchmark_samples: 10,  // Minimum benchmark samples required
};

/**
 * Generate unmatched model report
 */
export function generateUnmatchedReport(allModels, registryModels) {
  const registryIds = new Set(registryModels.map(m => m.id));
  
  const unmatchList = [];
  const matchIssues = [];
  
  for (const model of allModels || []) {
    if (!model.id && !registryIds.has(model.name?.toLowerCase())) {
      // Completely unknown model
      unmatchList.push({
        name: model.name || 'Unknown',
        vendor: model.vendor || 'Unknown',
        reason: 'no_registry_match',
        detected_at: new Date().toISOString(),
        context: {
          input_price: model.input,
          output_price: model.output,
          source: model.source,
        }
      });
    } else if (model.price_deviation && model.price_deviation > QUALITY_THRESHOLDS.max_price_deviation) {
      // Price anomaly
      matchIssues.push({
        type: 'price_anomaly',
        model: model.name,
        vendor: model.vendor,
        deviation_percent: model.price_deviation,
        expected_range: `±${QUALITY_THRESHOLDS.max_price_deviation}%`,
        detected_at: new Date().toISOString(),
      });
    }
  }
  
  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_unmatched: unmatchList.length,
      total_anomalies: matchIssues.length,
      quality_score: calculateQualityScore(unmatchList.length, allModels?.length || 0),
    },
    unmatched: unmatchList.slice(0, 50), // Limit to top 50
    anomalies: matchIssues.slice(0, 20),
    thresholds_applied: QUALITY_THRESHOLDS,
  };
}

/**
 * Calculate overall quality score
 */
export function calculateQualityScore(unmatchedCount, totalCount) {
  if (!totalCount || totalCount === 0) return 0;
  return Math.round((1 - unmatchedCount / totalCount) * 100);
}

/**
 * Get models below quality thresholds
 */
export function getLowQualityModels(models, options = {}) {
  const {
    minReviews = QUALITY_THRESHOLDS.min_reviews,
    minSourceCoverage = QUALITY_THRESHOLDS.min_source_coverage,
  } = options;
  
  return (models || []).filter(model => {
    const reviewCount = model.reviews?.length || 0;
    const sourceCount = model.sources?.length || 0;
    
    return reviewCount < minReviews || sourceCount < minSourceCoverage;
  });
}

// CLI usage
if (process.argv[1]?.endsWith('unmatch-report.js')) {
  console.log('Usage: node unmatch-report.js --report="path/to/report.json" --models="path/to/models.json"');
  process.exit(0);
}

export default { 
  generateUnmatchedReport,
  calculateQualityScore,
  getLowQualityModels,
  QUALITY_THRESHOLDS,
};
