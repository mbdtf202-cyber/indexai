import { nowISO } from './clock.js';

/**
 * Performance Budget System (T5.7 Round 1)
 * 
 * Runtime performance monitoring with budget enforcement
 * Zero global state - uses module pattern
 */

// Performance budgets (in milliseconds)
const PERFORMANCE_BUDGETS = {
  // Network budgets
  network: {
    initialLoad: 3000,        // Initial page load target
    lazyLoad: 500,            // Lazy loaded script target
    maxRequests: 50,          // Max concurrent requests
  },
  
  // Rendering budgets
  rendering: {
    firstPaint: 1000,         // First paint target
    contentfulPaint: 2500,    // Contentful paint target
    domContentLoaded: 1500,   // DOM content loaded target
  },
  
  // Size budgets
  size: {
    mainBundle: 500000,       // Main JS bundle limit (500KB)
    totalPage: 1500000,       // Total page size limit (1.5MB)
  },
};

let _budgetStatus = null;

/**
 * Monitor page performance metrics
 */
export function monitorPerformance(options = {}) {
  const { reportOnLoad = true } = options;
  
  if (!reportOnLoad || !('performance' in window)) {
    return Promise.resolve({ skipped: true });
  }
  
  return new Promise((resolve) => {
    // Collect timing metrics
    const timings = {
      domContentLoaded:
        /** @type {PerformanceNavigationTiming|undefined} */ (
          performance.getEntriesByName('domContentLoaded', 'navigation')[0]
        )?.loadEventEnd || 0,
      firstPaint: getFirstPaint(),
      largestContentfulPaint: getLargestContentfulPaint(),
      cumulativeLayoutShift: getCumulativeLayoutShift(),
    };
    
    // Calculate performance score
    const score = calculateScore(timings);
    
    // Check against budgets
    const violations = checkViolations(timings);
    
    _budgetStatus = {
      timestamp: nowISO(),
      score: Math.round(score * 100),
      violations,
      timings,
      compliant: violations.length === 0,
    };
    
    console.log(`[perf-budget] Score: ${_budgetStatus.score}%${violations.length > 0 ? ` | Violations: ${violations.join(', ')}` : ''}`);
    
    resolve(_budgetStatus);
  });
}

/**
 * Calculate overall performance score (0-100)
 */
function calculateScore(timings) {
  let score = 100;
  
  // Penalize slow metrics
  if (timings.domContentLoaded > PERFORMANCE_BUDGETS.rendering.domContentLoaded) {
    score -= Math.min(20, (timings.domContentLoaded - PERFORMANCE_BUDGETS.rendering.domContentLoaded) / 100);
  }
  
  if (timings.firstPaint > PERFORMANCE_BUDGETS.rendering.firstPaint) {
    score -= Math.min(20, (timings.firstPaint - PERFORMANCE_BUDGETS.rendering.firstPaint) / 50);
  }
  
  if (timings.largestContentfulPaint > PERFORMANCE_BUDGETS.rendering.contentfulPaint) {
    score -= Math.min(30, (timings.largestContentfulPaint - PERFORMANCE_BUDGETS.rendering.contentfulPaint) / 100);
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Check for budget violations
 */
function checkViolations(timings) {
  const violations = [];
  
  if (timings.domContentLoaded > PERFORMANCE_BUDGETS.rendering.domContentLoaded) {
    violations.push(`DOM load exceeded`);
  }
  
  if (timings.firstPaint > PERFORMANCE_BUDGETS.rendering.firstPaint) {
    violations.push(`First paint slow`);
  }
  
  return violations;
}

/**
 * Get first paint timing
 */
function getFirstPaint() {
  const entries = performance.getEntriesByType('paint');
  const first = entries.find(e => e.name === 'first-contentful-paint');
  return first ? first.startTime : 0;
}

/**
 * Get LCP (Largest Contentful Paint)
 */
function getLargestContentfulPaint() {
  const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
  return lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1].startTime : 0;
}

/**
 * Get CLS (Cumulative Layout Shift)
 */
function getCumulativeLayoutShift() {
  // layout-shift 不在 lib.dom 的 EntryType 联合里，需显式断言
  const clsEntries = /** @type {Array<{value: number}>} */ (
    /** @type {unknown} */ (performance.getEntriesByType('layout-shift'))
  );
  return clsEntries.reduce((sum, entry) => sum + (entry.value || 0), 0);
}

/**
 * Get current budget status
 */
export function getStatus() {
  return _budgetStatus || { score: 100, compliant: true, violations: [] };
}

/**
 * Reset budgets (for testing)
 */
export function reset() {
  _budgetStatus = null;
}

// Auto-run on load
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    monitorPerformance();
  });
}

export default { 
  monitorPerformance, 
  getStatus, 
  reset,
  PERFORMANCE_BUDGETS,
};
