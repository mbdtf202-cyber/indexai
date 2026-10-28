/**
 * Model Detail View (T6.1 Round 1)
 *
 * Individual model page showing detailed pricing, benchmarks, history
 */

import { money, pct } from './format.js';
import { renderThemeToggle } from '../components/theme-toggle.mjs';

export function renderModelDetail(data = {}) {
  const { model, prices = [], benchmarks = [], history = [], vendors = [] } = data;

  if (!model) {
    return '<section class="error-page"><h1>Model not found</h1><p>Please go back to models list.</p></section>';
  }

  return `
    <div id="model-detail" class="page model-detail-page">
      ${renderHeader(model)}
      
      ${renderThemeToggle()}
      
      <main class="detail-main">
        <aside class="vendor-sidebar">
          ${renderVendorLinks(vendors)}
        </aside>
        
        <section class="pricing-section">
          <h2>Pricing</h2>
          ${renderPricingTable(prices)}
        </section>
        
        <section class="benchmarks-section">
          <h2>Benchmark Performance</h2>
          ${renderBenchmarkCards(benchmarks)}
        </section>
        
        <section class="history-section">
          <h2>Price History</h2>
          ${renderPriceHistory(history)}
        </section>
      </main>
    </div>
  `;
}

function renderHeader(model) {
  return `
    <header class="page-header">
      ${renderThemeToggle()}
      <h1>${model.name}</h1>
      <p class="subtitle">${model.description || 'AI model pricing comparison'}</p>
      <nav class="breadcrumbs">
        <a href="/models">Models</a> → <span>${model.name}</span>
      </nav>
    </header>
  `;
}

function renderVendorLinks(vendors) {
  if (!vendors || vendors.length === 0) return '';

  return `
    <h3>Vendors Offering This Model</h3>
    <ul class="vendor-list">
      ${vendors.map((v) => `<li><a href="${v.url}">${v.name}</a></li>`).join('')}
    </ul>
  `;
}

function renderPricingTable(prices) {
  if (!prices || prices.length === 0) {
    return '<p>No pricing data available yet.</p>';
  }

  return `
    <table class="pricing-table">
      <thead>
        <tr>
          <th>Provider</th>
          <th>Input ($/1M)</th>
          <th>Output ($/1M)</th>
          <th>Cache Read</th>
          <th>Last Updated</th>
        </tr>
      </thead>
      <tbody>
        ${prices
          .map(
            (p) => `
          <tr>
            <td><strong>${p.provider}</strong></td>
            <td>$${money(p.input_price)}</td>
            <td>$${money(p.output_price)}</td>
            <td>$${money(p.cache_read_price || p.input_price * 0.1)}</td>
            <td>${formatDate(p.last_updated)}</td>
          </tr>
        `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderBenchmarkCards(benchmarks) {
  if (!benchmarks || benchmarks.length === 0) {
    return '<p>No benchmark data available yet.</p>';
  }

  return `
    <div class="benchmark-grid">
      ${benchmarks
        .slice(0, 6)
        .map(
          (b) => `
        <article class="benchmark-card">
          <h4>${b.name}</h4>
          <div class="score-display">${pct(b.score)}</div>
          <p class="description">${b.description || b.name}</p>
          <small>Rank #${b.rank || '-'}</small>
        </article>
      `,
        )
        .join('')}
    </div>
  `;
}

function renderPriceHistory(history) {
  if (!history || history.length === 0) {
    return '<p>No price history available yet.</p>';
  }

  // Simple line chart simulation using CSS gradients
  const maxPrice = Math.max(...history.map((h) => h.price));
  const minPrice = Math.min(...history.map((h) => h.price));
  const range = maxPrice - minPrice || 1;

  return `
    <div class="price-history-chart">
      <div class="chart-container">
        <svg viewBox="0 0 ${history.length * 50} 200" preserveAspectRatio="none">
          <line x1="0" y1="200" x2="${history.length * 50}" y2="200" stroke="var(--color-border-primary)" stroke-width="1"/>
          ${history
            .map((h, i) => {
              const x = i * 50;
              const y = 200 - ((h.price - minPrice) / range) * 150 - 25;
              return `<line x1="${x}" y1="200" x2="${x}" y2="50" stroke="var(--color-accent-primary)" stroke-width="1" opacity="0.3"/>
                    <circle cx="${x}" cy="${y}" r="4" fill="var(--color-accent-primary)"/>`;
            })
            .join('')}
          <polyline points="${history.map((h, i) => `${i * 50},${200 - ((h.price - minPrice) / range) * 150 - 25}`).join(' ')}" 
                    fill="none" stroke="var(--color-accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="price-timeline">
        ${history
          .slice(0, 10)
          .map(
            (h) => `
          <div class="timeline-point">
            <div class="date">${formatDate(h.date)}</div>
            <div class="price">$${money(h.price)}</div>
          </div>
        `,
          )
          .join('')}
      </div>
    </div>
  `;
}

// Utility functions
function formatDate(dateStr) {
  if (!dateStr) return 'Unknown';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default { renderModelDetail };
