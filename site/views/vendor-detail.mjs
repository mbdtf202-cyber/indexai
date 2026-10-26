/**
 * Vendor Detail View (T6.1 Round 2)
 *
 * Individual vendor page showing model offerings and pricing
 */

import { money } from './format.js';
import { renderThemeToggle } from '../components/theme-toggle.mjs';

export function renderVendorDetail(data = {}) {
  const { vendor, models = [], priceHistory = [] } = data;

  if (!vendor) {
    return '<section class="error-page"><h1>Vendor not found</h1><p>Please go back to vendors list.</p></section>';
  }

  return `
    <div id="vendor-detail" class="page vendor-detail-page">
      ${renderHeader(vendor)}
      
      ${renderThemeToggle()}
      
      <main class="detail-main">
        <aside class="vendor-info-sidebar">
          ${renderVendorInfo(vendor)}
        </aside>
        
        <section class="models-section">
          <h2>Model Offerings (${models.length} models)</h2>
          ${renderModelsGrid(models)}
        </section>
        
        ${priceHistory.length ? renderPriceHistory(priceHistory) : ''}
      </main>
    </div>
  `;
}

function renderHeader(vendor) {
  return `
    <header class="page-header">
      ${renderThemeToggle()}
      <h1>${vendor.name}</h1>
      <p class="subtitle">${vendor.description || 'AI model provider overview'}</p>
      <nav class="breadcrumbs">
        <a href="/vendors">Vendors</a> → <span>${vendor.name}</span>
      </nav>
    </header>
  `;
}

function renderVendorInfo(vendor) {
  return `
    <aside class="info-panel">
      <h3>About ${vendor.name}</h3>
      <p>${vendor.description || 'No description available.'}</p>
      
      <div class="stats-summary">
        <div class="stat">
          <strong>${vendor.model_count || 0}</strong>
          <span>Models</span>
        </div>
        <div class="stat">
          <strong>${vendor.founded_year || 'N/A'}</strong>
          <span>Founded</span>
        </div>
      </div>
      
      <ul class="links-list">
        ${vendor.homepage ? `<li><a href="${vendor.homepage}" target="_blank" rel="noopener">Official Website →</a></li>` : ''}
        ${vendor.documentation ? `<li><a href="${vendor.documentation}" target="_blank" rel="noopener">Documentation →</a></li>` : ''}
        ${vendor.github ? `<li><a href="${vendor.github}" target="_blank" rel="noopener">GitHub →</a></li>` : ''}
      </ul>
    </aside>
  `;
}

function renderModelsGrid(models) {
  if (!models || models.length === 0) {
    return '<p>No models offered by this vendor yet.</p>';
  }

  return `
    <div class="model-grid">
      ${models
        .slice(0, 12)
        .map(
          (model) => `
        <article class="model-card" style="border-left-color: var(--color-accent-primary)">
          <h4><a href="/models#${model.id.toLowerCase() || 'unknown'}">${model.name}</a></h4>
          <p class="price">$${money(model.input_price || 0)} / $${money(model.output_price || 0)}</p>
          ${model.free_quota ? `<span class="badge badge-free">${model.free_quota} free units</span>` : ''}
          <a href="/models#${model.id.toLowerCase() || 'unknown'}" class="view-model-link">View Details →</a>
        </article>
      `,
        )
        .join('')}
    </div>
  `;
}

function renderPriceHistory(history) {
  if (!history || history.length === 0) return '';

  const maxPrice = Math.max(...history.map((h) => h.price));
  const minPrice = Math.min(...history.map((h) => h.price));
  const range = maxPrice - minPrice || 1;

  return `
    <section class="price-history-section">
      <h2>Pricing History</h2>
      <div class="price-chart">
        <svg viewBox="0 0 ${history.length * 50} 200" preserveAspectRatio="none">
          <line x1="0" y1="200" x2="${history.length * 50}" y2="200" stroke="#e2e8f0" stroke-width="1"/>
          ${history
            .map((h, i) => {
              const x = i * 50;
              const y = 200 - ((h.price - minPrice) / range) * 150 - 25;
              return `<circle cx="${x}" cy="${y}" r="4" fill="#3b82f6"/>`;
            })
            .join('')}
          <polyline points="${history.map((h, i) => `${i * 50},${200 - ((h.price - minPrice) / range) * 150 - 25}`).join(' ')}" 
                    fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="price-timeline">
        ${history
          .slice(0, 8)
          .map(
            (h) => `
          <div class="timeline-point">
            <div class="date">${new Date(h.date).toLocaleDateString()}</div>
            <div class="price">$${money(h.price)}</div>
          </div>
        `,
          )
          .join('')}
      </div>
    </section>
  `;
}

// Utility functions
function _formatDate(dateStr) {
  if (!dateStr) return 'Unknown';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default { renderVendorDetail };
