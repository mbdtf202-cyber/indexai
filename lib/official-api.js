/**
 * Official API Integration (T6.9)
 * 
 * Fetch data from Artificial Analysis and OpenRouter official APIs
 */

import { httpJson } from './http.js';
import { nowISO } from './clock.js';

// Official API endpoints
export const API_ENDPOINTS = {
  artificial_analysis: {
    base: 'https://artificialanalysis.ai/api/v2',
    endpoints: {
      models: '/models',
      benchmarks: '/benchmarks',
      providers: '/providers',
    },
  },
  
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    endpoints: {
      models: '/models',
      rankings: '/rankings',
      apps: '/apps',
    },
  },
};

/**
 * Fetch Artificial Analysis models via official API
 * @returns {Promise<object>} Models data
 */
export async function fetchAAModels() {
  try {
    const response = await httpJson(`${API_ENDPOINTS.artificial_analysis.base}${API_ENDPOINTS.artificial_analysis.endpoints.models}`, {
      label: 'aa/models',
      tries: 3,
    });
    
    return {
      source: 'artificial_analysis',
      endpoint: 'models',
      method: 'official_api_v2',
      data: response,
      fetched_at: nowISO(),
      attribution: 'Source: Artificial Analysis (CC BY 4.0)',
    };
  } catch (e) {
    console.warn('[aa] API fetch failed:', e.message);
    throw e;
  }
}

/**
 * Fetch Artificial Analysis benchmarks via official API
 * @returns {Promise<object>} Benchmark data
 */
export async function fetchAABenchmarks() {
  try {
    const response = await httpJson(`${API_ENDPOINTS.artificial_analysis.base}${API_ENDPOINTS.artificial_analysis.endpoints.benchmarks}`, {
      label: 'aa/benchmarks',
      tries: 3,
    });
    
    return {
      source: 'artificial_analysis',
      endpoint: 'benchmarks',
      method: 'official_api_v2',
      data: response,
      fetched_at: nowISO(),
      attribution: 'Source: Artificial Analysis (CC BY 4.0)',
    };
  } catch (e) {
    console.warn('[aa] Benchmarks fetch failed:', e.message);
    throw e;
  }
}

/**
 * Fetch OpenRouter models via official API
 * @returns {Promise<object>} Models data
 */
export async function fetchOpenRouterModels() {
  try {
    const response = await httpJson(`${API_ENDPOINTS.openrouter.base}${API_ENDPOINTS.openrouter.endpoints.models}`, {
      label: 'or/models',
      tries: 3,
      headers: {
        'Accept': 'application/json',
      },
    });
    
    return {
      source: 'openrouter',
      endpoint: 'models',
      method: 'official_api_v1',
      data: response,
      fetched_at: nowISO(),
      attribution: 'Source: OpenRouter Data API',
    };
  } catch (e) {
    console.warn('[or] Models fetch failed:', e.message);
    throw e;
  }
}

/**
 * Fetch OpenRouter rankings via official API
 * @returns {Promise<object>} Rankings data
 */
export async function fetchOpenRouterRankings() {
  try {
    const response = await httpJson(`${API_ENDPOINTS.openrouter.base}${API_ENDPOINTS.openrouter.endpoints.rankings}`, {
      label: 'or/rankings',
      tries: 3,
    });
    
    return {
      source: 'openrouter',
      endpoint: 'rankings',
      method: 'official_api_v1',
      data: response,
      fetched_at: nowISO(),
      attribution: 'Source: OpenRouter Data API',
    };
  } catch (e) {
    console.warn('[or] Rankings fetch failed:', e.message);
    throw e;
  }
}

/**
 * Fetch OpenRouter apps via official API
 * @returns {Promise<object>} Apps data
 */
export async function fetchOpenRouterApps() {
  try {
    const response = await httpJson(`${API_ENDPOINTS.openrouter.base}${API_ENDPOINTS.openrouter.endpoints.apps}`, {
      label: 'or/apps',
      tries: 3,
    });
    
    return {
      source: 'openrouter',
      endpoint: 'apps',
      method: 'official_api_v1',
      data: response,
      fetched_at: nowISO(),
      attribution: 'Source: OpenRouter Data API',
    };
  } catch (e) {
    console.warn('[or] Apps fetch failed:', e.message);
    throw e;
  }
}

/**
 * Validate API response schema
 * @param {object} data - Response data
 * @param {object} expectedShape - Expected schema shape
 * @returns {object} Validation result
 */
export function validateApiResponse(data, expectedShape) {
  if (!data) return { valid: false, error: 'Empty response' };
  
  const missing = [];
  const present = [];
  
  for (const field of Object.keys(expectedShape || {})) {
    if (!(field in data)) {
      missing.push(field);
    } else {
      present.push(field);
    }
  }
  
  return {
    valid: missing.length === 0,
    present,
    missing,
    error_count: missing.length,
  };
}

/**
 * Generate attribution string for source
 * @param {string} source - Source identifier
 * @returns {string} Attribution text
 */
export function generateAttribution(source) {
  const attributions = {
    artificial_analysis: 'Artificial Analysis - https://artificialanalysis.ai (CC BY 4.0)',
    openrouter: 'OpenRouter - https://openrouter.ai (Data API)',
  };
  
  return attributions[source] || `Source: ${source}`;
}

/**
 * Check if using official API vs legacy scraping
 * @param {string} method - Method identifier
 * @returns {boolean} Whether it's an official API
 */
export function isOfficialApiMethod(method) {
  return ['official_api_v1', 'official_api_v2'].includes(method);
}

// URL query parameter parsing
export function parseApiParams(params) {
  const source = params.get('source') || 'all';
  const endpoint = params.get('endpoint');
  
  return {
    source_filter: source,
    specific_endpoint: endpoint,
    include_attribution: true,
  };
}

export default {
  fetchAAModels,
  fetchAABenchmarks,
  fetchOpenRouterModels,
  fetchOpenRouterRankings,
  fetchOpenRouterApps,
  validateApiResponse,
  generateAttribution,
  isOfficialApiMethod,
  parseApiParams,
  API_ENDPOINTS,
};
