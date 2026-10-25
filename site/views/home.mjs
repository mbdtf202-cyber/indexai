/**
 * Home Page View (T5.1 Round 2)
 *
 * Pure function rendering of the home/landing page
 * No global state dependencies - accepts data object as input, returns HTML string
 */

import { money, pct, kfmt, formatDate } from './format.js';

/**
 * Render home page HTML
 * @param {object} data - Page data with models, benchmarks, stats
 * @returns {string} Complete HTML fragment
 */
export function renderHome(data) {
  const { latestNews, recentChanges, topModels, benchmarks } = data || {};

  return `
    <div id="home" class="page">
      <section class="hero">
        <h1>IndexAI - Model Pricing & Benchmarks</h1>
        <p class="subtitle">Track model prices, compare benchmarks, monitor changes</p>
        ${renderQuickStats(data?.stats)}
      </section>
      
      ${latestNews ? renderNewsSection(latestNews) : ''}
      ${recentChanges ? renderRecentChanges(recentChanges) : ''}
      
      <section class="top-models">
        <h2>🔥 Popular Models</h2>
        ${renderModelGrid(topModels || [])}
      </section>
      
      ${benchmarks ? renderBenchmarkPreview(benchmarks) : ''}
    </div>
  `;
}

// Sub-rendering functions (also pure)
function renderQuickStats(stats) {
  if (!stats) return '';
  return `
    <div class="quick-stats grid">
      <div class="stat-card">
        <span class="stat-value">${kfmt(stats.modelsCount)}</span>
        <span class="stat-label">Models Tracked</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${kfmt(stats.gateways)}</span>
        <span class="stat-label">Price Sources</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${formatDate(stats.lastUpdated)}</span>
        <span class="stat-label">Last Updated</span>
      </div>
    </div>
  `;
}

function renderModelGrid(models) {
  if (!models || models.length === 0) return '<p>No models available yet.</p>';

  return `
    <div class="model-grid">
      ${models
        .map(
          (model) => `
        <article class="model-card" data-id="${model.id}">
          <h3>${model.name}</h3>
          <div class="vendor">${model.vendor}</div>
          <div class="pricing">
            <span class="price">${money(model.input, '$')}</span>
            <span class="unit">input/1M</span>
          </div>
          ${model.free_quota ? `<div class="free">${model.free_quota} free units</div>` : ''}
        </article>
      `,
        )
        .join('')}
    </div>
  `;
}

function renderRecentChanges(changes) {
  if (!changes || changes.length === 0) return '';

  return `
    <section class="recent-changes">
      <h2>📈 Recent Changes</h2>
      <ul class="change-list">
        ${changes
          .slice(0, 5)
          .map(
            (change) => `
          <li>
            <time datetime="${change.timestamp}">${formatDate(change.date)}</time>
            <span class="change-desc">${formatChangeSummary(change)}</span>
          </li>
        `,
          )
          .join('')}
      </ul>
    </section>
  `;
}

function formatChangeSummary(change) {
  if (!change) return 'Unknown change';

  const typeMap = {
    price_increase: 'Price increased',
    price_decrease: 'Price decreased',
    new_model: 'New model released',
    quota_added: 'Free quota added',
  };

  const typeStr = typeMap[change.type] || change.type || 'Change detected';
  const details = change.details ? ` (${format.pct(change.percentChange || 0)})` : '';

  return `${typeStr}${details}: ${change.model_name || change.model_id}`;
}

export default { renderHome };
