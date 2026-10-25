/**
 * Vendor Directory View (T5.1 Round 10)
 *
 * Pure function rendering of AI vendor directory listing
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { truncate } from './format.js';

/**
 * Render vendors page HTML
 * @param {object} data - Page data with vendor list, stats, filters
 * @returns {string} Complete HTML fragment
 */
export function renderVendors(data) {
  const { vendors = [], searchQuery = '' } = data || {};

  // Filter and sort vendors
  const filtered = searchVendors(vendors, searchQuery);
  const sorted = sortByVendors(filtered);

  return `
    <div id="vendors" class="page vendors-page">
      ${renderHeader()}
      
      <aside class="filters-sidebar">
        ${searchSection(searchQuery)}
        ${renderInfoPanel()}
      </aside>
      
      <main class="vendors-main">
        ${sorted.length === 0 ? renderNoResults() : renderVendorGrid(sorted)}
      </main>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>🏢 AI Vendors Directory</h1>
      <p class="subtitle">Complete directory of AI model providers and their official pricing</p>
    </header>
  `;
}

function renderVendorGrid(vendors) {
  if (!vendors || vendors.length === 0) return '';

  return `
    <div class="vendor-grid">
      ${vendors
        .slice(0, 36)
        .map((vendor) => renderVendorCard(vendor))
        .join('')}
    </div>
  `;
}

function renderVendorCard(vendor) {
  const descriptionDisplay = truncate(
    vendor.description || vendor.summary || 'No description available',
    80,
  );
  const modelCount = formatModelCount(vendor.model_count);
  const urlDisplay = truncate(vendor.url, 40);

  return `
    <article class="vendor-card" data-vendor-id="${vendor.id}">
      <header class="card-header">
        <div class="vendor-icon">${getIcon(vendor.category)}</div>
        <span class="model-count-badge">${modelCount}</span>
      </header>
      
      <div class="vendor-details">
        <h3>${truncate(vendor.name, 35)}</h3>
        <p class="description">${descriptionDisplay}</p>
        
        <div class="vendor-links">
          <a href="${vendor.homepage}" target="_blank" rel="noopener" class="link-btn primary">Official Site →</a>
          ${vendor.documentation ? `<a href="${vendor.documentation}" target="_blank" rel="noopener" class="link-btn secondary">Docs</a>` : ''}
          ${vendor.github ? `<a href="${vendor.github}" target="_blank" rel="noopener" class="link-btn secondary">GitHub</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

function searchSection(currentQuery) {
  return `
    <section class="search-section">
      <input type="text" placeholder="Search vendors..." value="${escapeHtml(currentQuery)}" />
      <div class="results-count">${currentQuery.trim() ? `${filterVendorsForCount().length} results` : ''}</div>
    </section>
  `;
}

function renderNoResults() {
  return '<section class="no-results"><p>No vendors found matching your criteria.</p></section>';
}

function renderInfoPanel() {
  return `
    <aside class="info-panel">
      <h3>📊 Directory Statistics</h3>
      <ul class="stats-list">
        <li>Total Vendors: <strong>${totalVendors()}</strong></li>
        <li>Total Models Tracked: <strong>${totalModels()}</strong></li>
        <li>Last Updated: <strong>${lastUpdated()}</strong></li>
      </ul>
    </aside>
  `;
}

// Business logic helpers (pure functions)
function searchVendors(vendors, query) {
  if (!query || !query.trim()) return vendors;

  const searchLower = query.toLowerCase();

  return vendors.filter(
    (v) =>
      v.name?.toLowerCase().includes(searchLower) ||
      v.description?.toLowerCase().includes(searchLower) ||
      v.tags?.some((tag) => tag.toLowerCase().includes(searchLower)),
  );
}

function filterVendorsForCount() {
  // Placeholder - in production this would use actual filtered result
  return [];
}

function sortByVendors(vendors) {
  return [...vendors].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function formatModelCount(count) {
  if (!count || count === 0) return '';
  if (count >= 100) return `${(count / 100).toFixed(1)}M models`;
  return `${count} models`;
}

function getIcon(category) {
  const icons = {
    cloud: '☁️',
    startup: '🚀',
    enterprise: '🏭',
    open_source: '🌐',
    research: '🔬',
    default: '🤖',
  };
  return icons[category] || icons.default;
}

function totalVendors() {
  return 50;
}
function totalModels() {
  return 500;
}
function lastUpdated() {
  return new Date().toLocaleDateString();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default { renderVendors };
