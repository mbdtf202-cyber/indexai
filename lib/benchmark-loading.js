import { nowISO } from './clock.js';

/**
 * Benchmark Loading & Source Correction (T6.8)
 * 
 * Lazy loading of benchmark directories, rankings with pre-computation,
 * and parquet fallback to HuggingFace JSON interface
 */

// Pre-computed rank calculations during build time
export function computeRankings(benchmarks) {
  if (!benchmarks || !Array.isArray(benchmarks)) return [];
  
  return benchmarks.map((bench, index) => ({
    ...bench,
    rank: index + 1,
    ranking_computed_at: nowISO(),
    has_precomputed_rank: true,
  }));
}

// Lazy directory listing for benchmarks
export async function fetchBenchmarkDirectory(options = {}) {
  const { baseUrl = '/data' } = options;
  
  // Return only directory structure, not full data
  return {
    type: 'directory',
    path: baseUrl,
    items: [
      { name: 'swe-bench-lite', type: 'file', size: 0 },
      { name: 'arena-hard-v02', type: 'file', size: 0 },
      { name: 'tau-bench-chat', type: 'file', size: 0 },
    ],
    total_items: 3,
    lazy_loaded: true,
  };
}

// Lazy榜加载 - only load selected benchmark
export async function fetchSelectedBenchmark(benchmarkId, options = {}) {
  const { forceParquet = true, useFallback = true } = options;
  
  // Simulate lazy loading - in production this would be an actual API call
  try {
    if (forceParquet) {
      return await loadFromParquet(benchmarkId);
    } else if (useFallback) {
      return await loadFromHFJSON(benchmarkId);
    }
  } catch (e) {
    // Parquet failed, try HF JSON fallback
    if (useFallback) {
      console.warn(`Parquet load failed for ${benchmarkId}, falling back to HF JSON`);
      return await loadFromHFJSON(benchmarkId);
    }
    throw e;
  }
}

// Parquet loading implementation
async function loadFromParquet(benchmarkId) {
  // In production, this would use lib/parquet.js
  // For demo, we simulate the result
  return {
    benchmark_id: benchmarkId,
    source: 'parquet',
    rows: [],
    columns: ['model_name', 'score', 'rank', 'submission_date'],
    metadata: {
      format: 'parquet',
      version: '2.0',
      loaded_from: `fixtures/${benchmarkId}.parquet`,
    },
  };
}

// HuggingFace dataset viewer JSON interface fallback
async function loadFromHFJSON(benchmarkId) {
  // Use HF dataset viewer /rows endpoint as fallback
  const hfEndpoint = `https://datasets-server.huggingface.co/rows?dataset=${benchmarkId}&config=default&split=train`;
  
  // Simulate HTTP response
  return {
    benchmark_id: benchmarkId,
    source: 'hf_json_fallback',
    rows: [],
    columns: ['model_name', 'score', 'rank', 'submission_date'],
    metadata: {
      format: 'json',
      source_url: hfEndpoint,
      loaded_from: 'huggingface_datasets_server',
    },
  };
}

// τ-bench specific sorting by submission_date before truncating
export function sortTauBenchBySubmissionDate(data) {
  if (!data || !Array.isArray(data)) return [];
  
  // Sort by submission_date
  const sorted = [...data].sort((a, b) => {
    const dateA = a.submission_date ? new Date(a.submission_date).getTime() : 0;
    const dateB = b.submission_date ? new Date(b.submission_date).getTime() : 0;
    return dateB - dateA; // Descending (newest first)
  });
  
  // Truncate to top N results
  return sorted.slice(0, 50);
}

// Benchmark entry correction & validation
export function validateBenchmarkEntry(entry) {
  const errors = [];
  const warnings = [];
  
  // Check required fields
  if (!entry.model_name) errors.push('Missing model_name');
  if (entry.score === undefined) errors.push('Missing score field');
  if (entry.rank === undefined) errors.push('Missing rank field');
  
  // Validate score range
  if (entry.score !== undefined && (entry.score < 0 || entry.score > 1)) {
    warnings.push('Score out of expected range [0, 1]');
  }
  
  // Validate rank is positive integer
  if (entry.rank !== undefined && (entry.rank < 1 || !Number.isInteger(entry.rank))) {
    errors.push('Rank must be positive integer');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    corrected_entry: correctEntry(entry, errors),
  };
}

// Auto-correct common issues in benchmark entries
function correctEntry(entry, errors) {
  const corrected = { ...entry };
  
  // Add default values for missing critical fields
  if (!corrected.model_name) corrected.model_name = 'Unknown Model';
  if (corrected.score === undefined) corrected.score = null;
  if (corrected.rank === undefined) corrected.rank = null;
  if (!corrected.submission_date) corrected.submission_date = nowISO();
  
  return corrected;
}

// Generate benchmark loading report
export function generateLoadingReport(benchmarks, loadingStats = {}) {
  const total_benchmarks = benchmarks?.length || 0;
  const loaded_with_parquet = loadingStats.parquet_count || 0;
  const loaded_with_hf_fallback = loadingStats.hf_fallback_count || 0;
  const total_errors = loadingStats.total_errors || 0;
  
  return {
    total_benchmarks,
    parquet_loads: loaded_with_parquet,
    json_fallback_loads: loaded_with_hf_fallback,
    success_rate: total_benchmarks > 0 
      ? ((total_benchmarks - total_errors) / total_benchmarks * 100).toFixed(2)
      : 0,
    has_errors: total_errors > 0,
    loading_complete: true,
  };
}

// URL query parameter parsing
export function parseBenchmarkParams(params) {
  const lazyLoad = params.get('lazy') !== 'false';
  const forceParquet = params.get('parquet') === 'true';
  const benchmarkId = params.get('benchmark');
  
  return {
    should_lazy_load: lazyLoad,
    force_parquet: forceParquet,
    selected_benchmark: benchmarkId,
  };
}

// Performance optimization: Only load first page of results initially
export function paginateResults(results, page = 1, pageSize = 50) {
  if (!results || !Array.isArray(results)) return { data: [], pagination: {} };
  
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  
  return {
    data: results.slice(startIndex, endIndex),
    pagination: {
      current_page: page,
      page_size: pageSize,
      total_items: results.length,
      total_pages: Math.ceil(results.length / pageSize),
      has_next: endIndex < results.length,
      has_prev: page > 1,
    },
  };
}

export default {
  computeRankings,
  fetchBenchmarkDirectory,
  fetchSelectedBenchmark,
  loadFromParquet,
  loadFromHFJSON,
  sortTauBenchBySubmissionDate,
  validateBenchmarkEntry,
  correctEntry,
  generateLoadingReport,
  parseBenchmarkParams,
  paginateResults,
};
