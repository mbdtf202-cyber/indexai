/**
 * Relay Gateway View (T5.1 Round 7)
 *
 * Pure function rendering of relay gateway listing table
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { money, kfmt, truncate } from './format.js';

/**
 * Render relays page HTML
 * @param {object} data - Page data with gateways, pricing tiers, status
 * @returns {string} Complete HTML fragment
 */
export function renderRelays(data) {
  const { gateways = [], sortBy = 'price', sortOrder = 'asc', filterStatus = 'all' } = data || {};

  // Filter and sort gateways
  const filtered = filterByStatus(gateways, filterStatus);
  const sorted = sortByGateways(filtered, sortBy, sortOrder);

  return `
    <div id="relays" class="page relays-page">
      ${renderHeader()}
      
      <aside class="filters-sidebar">
        ${renderFilterControls(filterStatus)}
        ${renderInfoPanel()}
      </aside>
      
      <main class="relays-main">
        ${renderSortControls(sortBy, sortOrder)}
        
        ${sorted.length === 0 ? renderNoResults() : renderGatewayTable(sorted)}
      </main>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>🔄 Relay Gateways</h1>
      <p class="subtitle">Compare third-party API aggregators and their price markup over official sources</p>
    </header>
  `;
}

function renderFilterControls(currentFilter) {
  return `
    <div class="filter-section">
      <h4>Filter by Status</h4>
      <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">All Active</button>
      <button class="filter-btn ${currentFilter === 'stable' ? 'active' : ''}" data-filter="stable">Stable Pricing</button>
      <button class="filter-btn ${currentFilter === 'volatile' ? 'active' : ''}" data-filter="volatile">Frequent Changes</button>
      <button class="filter-btn ${currentFilter === 'gray' ? 'active' : ''}" data-filter="gray">Gray Groups</button>
    </div>
    
    <div class="info-card">
      <h4>What are Relays?</h4>
      <p>Third-party API aggregators that provide unified interfaces to multiple AI providers with markup.</p>
    </div>
  `;
}

function renderSortControls(currentSortBy, currentSortOrder) {
  return `
    <div class="sort-controls">
      <span>Sort by:</span>
      <button class="sort-btn active" data-sort="price">Price</button>
      <button class="sort-btn" data-sort="markup">Markup %</button>
      <button class="sort-btn" data-sort="features">Features</button>
    </div>
  `;
}

function renderGatewayTable(gateways) {
  return `
    <div class="table-container">
      <table class="gateway-table">
        <thead>
          ${renderTableHeader(currentSortBy)}
        </thead>
        <tbody>
          ${gateways.map((gateway) => renderGatewayRow(gateway)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderTableHeader(currentSortBy) {
  const arrows = {
    price: currentSortBy === 'price' ? ' ⇅' : '',
    markup: currentSortBy === 'markup' ? ' ⇅' : '',
    features: currentSortBy === 'features' ? ' ⇅' : '',
  };

  return `
    <tr>
      <th${arrows.price}>Provider Name${arrows.price}</th>
      <th>Official Price</th>
      <th${arrows.markup}>Markup %${arrows.markup}</th>
      <th>${arrows.features}Features${arrows.features}</th>
      <th>Status</th>
      <th>API Docs</th>
    </tr>
  `;
}

function renderGatewayRow(gateway) {
  const markupDisplay = formatMarkup(gateway.markup_percent);
  const statusBadge = getStatusBadge(gateway.status, gateway.last_update);
  const featuresList = formatFeatures(gateway.features);

  return `
    <tr class="gateway-row ${gateway.is_gray ? 'gray-group' : ''}">
      <td class="provider-name">
        <strong>${gateway.name}</strong>
        ${gateway.domain ? `<span class="domain">@${truncate(gateway.domain, 20)}</span>` : ''}
      </td>
      <td class="official-price">$${money(gateway.official_price || gateway.base_price)}</td>
      <td class="markup-price ${getMarkupClass(gateway.markup_percent)}">${markupDisplay}</td>
      <td class="features">${featuresList}</td>
      <td>${statusBadge}</td>
      <td><a href="${gateway.api_docs || '#'}" target="_blank">Docs →</a></td>
    </tr>
  `;
}

function renderNoResults() {
  return '<section class="no-results"><p>No relay gateways currently available. Add new gateways to track prices.</p></section>';
}

function renderInfoPanel() {
  return `
    <aside class="info-panel">
      <h3>ℹ️ About Relay Gateways</h3>
      <ul class="info-list">
        <li><strong>Markup %:</strong> Over official provider prices</li>
        <li><strong>Gray Groups:</strong> Unofficial/reseller channels</li>
        <li><strong>Status:</strong> Based on price change frequency</li>
        <li><strong>Features:</strong> Rate limits, cache, support level</li>
      </ul>
    </aside>
  `;
}

// Business logic helpers (pure functions)
function filterByStatus(gateways, statusFilter) {
  if (statusFilter === 'all') return gateways;

  return gateways.filter((gw) => {
    switch (statusFilter) {
      case 'stable':
        return gw.price_change_24h !== undefined && Math.abs(gw.price_change_24h) < 5;
      case 'volatile':
        return gw.price_change_24h !== undefined && Math.abs(gw.price_change_24h) >= 5;
      case 'gray':
        return gw.is_gray === true;
      default:
        return true;
    }
  });
}

function sortByGateways(gateways, sortBy, order) {
  return [...gateways].sort((a, b) => {
    let compareA, compareB;

    switch (sortBy) {
      case 'price':
        compareA = a.official_price || a.base_price || Infinity;
        compareB = b.official_price || b.base_price || Infinity;
        break;
      case 'markup':
        compareA = a.markup_percent || 0;
        compareB = b.markup_percent || 0;
        break;
      case 'features':
        compareA = a.features?.length || 0;
        compareB = b.features?.length || 0;
        break;
      default:
        compareA = 0;
        compareB = 0;
    }

    if (order === 'desc') return compareB - compareA;
    return compareA - compareB;
  });
}

function formatMarkup(markupPercent) {
  if (markupPercent === undefined || markupPercent === null) return '—';

  const sign = markupPercent > 0 ? '+' : '';
  return `${sign}${markupPercent.toFixed(1)}%`;
}

function getStatusBadge(status, lastUpdate) {
  if (!status) return '<span class="badge unknown">Unknown</span>';

  const badges = {
    stable: '<span class="badge stable">✓ Stable</span>',
    volatile: '<span class="badge volatile">⚡ Volatile</span>',
    gray: '<span class="badge gray">⚠ Gray</span>',
    deprecated: '<span class="badge deprecated">🔴 Deprecated</span>',
  };

  return badges[status] || '<span class="badge unknown">Unsure</span>';
}

function formatFeatures(features) {
  if (!features || !Array.isArray(features)) return '';

  const featureIcons = {
    rate_limit: '⏱️',
    cache: '📦',
    billing: '💰',
    analytics: '📊',
    support: '🎧',
  };

  return features
    .slice(0, 3)
    .map((feat) => {
      const icon = featureIcons[feat.toLowerCase()] || '';
      return `${icon} ${feat}`;
    })
    .join(', ');
}

function getMarkupClass(markupPercent) {
  if (markupPercent === undefined || markupPercent === null) return '';
  if (markupPercent > 100) return 'markup-high';
  if (markupPercent > 50) return 'markup-medium';
  if (markupPercent > 10) return 'markup-low';
  return 'markup-minimal';
}

export default { renderRelays };
