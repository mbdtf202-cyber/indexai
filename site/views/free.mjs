/**
 * Free Tier Display View (T5.1 Round 6)
 *
 * Pure function rendering of free tier comparison table
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { money, kfmt } from './format.js';

/**
 * Render free tiers page HTML
 * @param {object} data - Page data with free offerings, vendors, limits
 * @returns {string} Complete HTML fragment
 */
export function renderFree(data) {
  const { offerings = [], sortBy = 'limit', sortOrder = 'desc', filterVendor = null } = data || {};

  // Filter and sort offerings
  const filtered = filterByVendor(offerings, filterVendor);
  const sorted = sortByOfferings(filtered, sortBy, sortOrder);

  return `
    <div id="free" class="page free-page">
      ${renderHeader()}
      
      <aside class="filters-sidebar">
        ${renderFilterControls(filterVendor)}
        <div class="info-card">
          <h4>ℹ️ What's Here</h4>
          <p>All currently available free tiers and trial offers for AI models</p>
          <ul>
            <li>Monthly free credits/quota</li>
            <li>Trial periods (7-30 days)</li>
            <li>No-credit-card-required demos</li>
            <li>Freemium tier capabilities</li>
          </ul>
        </div>
      </aside>
      
      <main class="free-main">
        ${renderSortControls(sortBy, sortOrder)}
        
        ${sorted.length === 0 ? renderNoResults() : renderFreeGrid(sorted)}
      </main>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>🎁 Free Tiers & Trials</h1>
      <p class="subtitle">Compare monthly free quotas, trial periods, and no-credit-card options across AI providers</p>
    </header>
  `;
}

function renderFilterControls(currentFilter) {
  const vendors = ['chatgpt', 'claude', 'gemini', 'deepseek', 'anthropic', 'openai', 'xai', 'meta'];

  return `
    <div class="filter-section">
      <h4>Filter by Vendor</h4>
      <button class="filter-btn ${currentFilter === null ? 'active' : ''}" data-filter="">All Vendors</button>
      ${vendors
        .map(
          (vendor) => `
        <button class="filter-btn ${currentFilter === vendor ? 'active' : ''}" data-filter="${vendor}">
          ${capitalizeFirst(vendor)}
        </button>
      `,
        )
        .join('')}
    </div>
    
    <div class="filter-section">
      <h4>Show</h4>
      <label class="checkbox">
        <input type="checkbox" checked> Monthly free only
      </label>
      <label class="checkbox">
        <input type="checkbox" checked> Trial periods
      </label>
    </div>
  `;
}

function renderSortControls(currentSortBy, currentSortOrder) {
  return `
    <div class="sort-controls">
      <span>Sort by:</span>
      <button class="sort-btn active" data-sort="limit">Monthly Limit</button>
      <button class="sort-btn" data-sort="provider">Provider</button>
      <button class="sort-btn" data-sort="period">Trial Length</button>
    </div>
  `;
}

function renderFreeGrid(offerings) {
  return `
    <div class="free-grid">
      ${offerings.map((offering) => renderFreeCard(offering)).join('')}
    </div>
  `;
}

function renderFreeCard(offering) {
  const limitDisplay = formatLimitDisplay(offering.limit, offering.unit);
  const periodDisplay = offering.period ? `${offering.period}` : '';
  const requiresCard = offering.requires_credit_card ? '💳 Required' : '✅ No CC needed';

  return `
    <article class="free-card premium-tier">
      <header class="card-header">
        <h3>${offering.name}</h3>
        <span class="provider-badge">${capitalizeFirst(offering.vendor)}</span>
      </header>
      
      <div class="free-details">
        <div class="limit-display">
          <span class="limit-value">${limitDisplay}</span>
          ${offering.period ? `<span class="trial-period">${periodDisplay} trial</span>` : ''}
        </div>
        
        <div class="requires-cc">${requiresCard}</div>
        
        ${
          offering.features
            ? `
          <ul class="feature-list">
            ${offering.features
              .slice(0, 3)
              .map((feat) => `<li>${feat}</li>`)
              .join('')}
            ${offering.features.length > 3 ? '<li>+ more...</li>' : ''}
          </ul>
        `
            : ''
        }
      </div>
      
      <footer class="card-footer">
        <a href="${offering.link}" class="cta-button" target="_blank" rel="noopener">
          Get Free Access →
        </a>
      </footer>
    </article>
  `;
}

function renderNoResults() {
  return '<section class="no-results"><p>No free tiers available at this time. Check back later!</p></section>';
}

function renderSortControls(currentSortBy, currentSortOrder) {
  return `
    <div class="sort-controls">
      <button class="sort-btn active" data-limit="high">Highest Limits</button>
      <button class="sort-btn" data-provides="best">Best Value</button>
    </div>
  `;
}

// Business logic helpers (pure functions)
function filterByVendor(offerings, vendorFilter) {
  if (!vendorFilter) return offerings;
  return offerings.filter((o) => o.vendor.toLowerCase() === vendorFilter.toLowerCase());
}

function sortByOfferings(offerings, sortBy, order) {
  return [...offerings].sort((a, b) => {
    let compareA, compareB;

    switch (sortBy) {
      case 'limit':
        const aLimit = parseLimitValue(a.limit, a.unit);
        const bLimit = parseLimitValue(b.limit, b.unit);
        compareA = aLimit.value;
        compareB = bLimit.value;
        break;
      case 'provider':
        compareA = a.vendor.toLowerCase();
        compareB = b.vendor.toLowerCase();
        break;
      case 'period':
        compareA = parsePeriodValue(a.period);
        compareB = parsePeriodValue(b.period);
        break;
      default:
        compareA = 0;
        compareB = 0;
    }

    if (order === 'desc') return compareB - compareA;
    return compareA - compareB;
  });
}

function parseLimitValue(limitStr, unit = 'requests') {
  const numMatch = limitStr.match(/([\d.]+)(?:\s*(k|m|b))?/i);
  if (!numMatch) return { value: 0, unit };

  const num = parseFloat(numMatch[1]);
  const suffix = (numMatch[2] || '').toLowerCase();

  let multiplier = 1;
  if (suffix === 'k') multiplier = 1000;
  else if (suffix === 'm') multiplier = 1000000;
  else if (suffix === 'b') multiplier = 1000000000;

  return { value: num * multiplier, original: limitStr, unit };
}

function parsePeriodValue(periodStr) {
  const match = periodStr?.match(/(\d+)\s*(day|days?|week|weeks?|month|months?|year|years?)/i);
  if (!match) return 0;

  const days = parseInt(match[1]);
  const periodType = match[2].toLowerCase();

  if (periodType.startsWith('day')) return days;
  if (periodType.startsWith('week')) return days * 7;
  if (periodType.startsWith('month')) return days * 30;
  if (periodType.startsWith('year')) return days * 365;

  return 0;
}

function formatLimitDisplay(limit, unit) {
  if (!limit) return '—';

  const parsed = parseLimitValue(limit, unit);
  const displayNum = formatNumber(parsed.value);

  return `${displayNum} ${unit}`;
}

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return Math.round(num).toString();
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default { renderFree };
