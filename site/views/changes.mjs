/**
 * Today's Changes Page (T6.2)
 *
 * Display recent AI model pricing changes across all providers
 */

import { truncate } from './format.js';
import { money, pct } from '../styles/tokens.mjs';

export function renderChanges(data = {}) {
  const {
    recentChanges = [],
    date = new Date().toISOString().slice(0, 10),
    categories = {},
  } = data;

  return `
    <div id="changes" class="page changes-page">
      ${renderHeader(date)}
      
      <aside class="filters-sidebar">
        ${renderCategoryFilters(categories)}
        ${renderInfoPanel()}
      </aside>
      
      <main class="changes-main">
        ${renderChangesList(recentChanges)}
      </main>
    </div>
  `;
}

function renderHeader(date) {
  return `
    <header class="page-header">
      <h1>📈 Today's Changes</h1>
      <p class="subtitle">Real-time pricing updates from all AI providers</p>
      <div class="date-badge">${date}</div>
    </header>
  `;
}

function renderCategoryFilters(categories) {
  return `
    <nav class="category-tabs">
      <button class="tab-link active" data-category="all">All</button>
      <button class="tab-link" data-category="price-cut">Price Cuts</button>
      <button class="tab-link" data-category="price-increase">Increases</button>
      <button class="tab-link" data-category="new-model">New Models</button>
      <button class="tab-link" data-category="quota-update">Quota Updates</button>
    </nav>
    
    <section class="stats-cards">
      <div class="stat-card">
        <span class="count">${Object.keys(categories).length || 0}</span>
        <span class="label">Total Changes</span>
      </div>
      <div class="stat-card success">
        <span class="count">${categories['price-cut']?.length || 0}</span>
        <span class="label">Price Cuts</span>
      </div>
      <div class="stat-card warning">
        <span class="count">${categories['price-increase']?.length || 0}</span>
        <span class="label">Increases</span>
      </div>
    </section>
  `;
}

function renderChangesList(changes) {
  if (!changes || changes.length === 0) {
    return '<section class="no-changes"><p>No changes reported for today.</p></section>';
  }

  // Group by provider
  const grouped = {};
  for (const change of changes) {
    if (!grouped[change.provider]) {
      grouped[change.provider] = [];
    }
    grouped[change.provider].push(change);
  }

  return `
    <div class="changes-grouped">
      ${Object.entries(grouped)
        .map(
          ([provider, providerChanges]) => `
        <section class="provider-section">
          <h3>${provider}</h3>
          <div class="changes-list">
            ${providerChanges.map((c) => renderChangeItem(c)).join('')}
          </div>
        </section>
      `,
        )
        .join('')}
    </div>
  `;
}

function renderChangeItem(change) {
  const badgeClass = getBadgeClass(change.type);
  const icon = getChangeIcon(change.type);

  return `
    <article class="change-item ${badgeClass}" data-change-id="${change.id}">
      <div class="change-header">
        <span class="badge ${badgeClass}">${icon} ${getChangeLabel(change.type)}</span>
        <time datetime="${change.timestamp}">${formatRelativeTime(change.timestamp)}</time>
      </div>
      
      <h4>${truncate(change.title || change.model_name, 60)}</h4>
      
      ${change.description ? `<p class="description">${truncate(change.description, 120)}</p>` : ''}
      
      ${
        hasPricingChange(change)
          ? `
        <div class="pricing-details">
          ${change.old_price !== undefined ? `<span class="old-price">$${money(change.old_price)}</span>` : ''}
          ${change.new_price !== undefined ? `<span class="new-price">$${money(change.new_price)}</span>` : ''}
          ${change.percent_change !== undefined ? `<span class="percent-change">${change.percent_change > 0 ? '+' : ''}${pct(change.percent_change)}</span>` : ''}
        </div>
      `
          : ''
      }
      
      <footer class="change-footer">
        <a href="${change.link || '#'}" target="_blank" rel="noopener">Source →</a>
        ${change.quota_added ? `<span class="quota-badge">+${truncate(change.quota_added)}</span>` : ''}
      </footer>
    </article>
  `;
}

// Helper functions
function getBadgeClass(type) {
  const badges = {
    'price-cut': 'badge-cut',
    'price-increase': 'badge-increase',
    'new-model': 'badge-new',
    'quota-update': 'badge-quota',
  };
  return badges[type] || 'badge-default';
}

function getChangeIcon(type) {
  const icons = {
    'price-cut': '💰 ↓',
    'price-increase': '💰 ↑',
    'new-model': '🆕',
    'quota-update': '🎁',
  };
  return icons[type] || '📊';
}

function getChangeLabel(type) {
  const labels = {
    'price-cut': 'Price Cut',
    'price-increase': 'Price Increase',
    'new-model': 'New Model',
    'quota-update': 'Quota Update',
  };
  return labels[type] || type;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function hasPricingChange(change) {
  return (
    change.old_price !== undefined ||
    change.new_price !== undefined ||
    change.percent_change !== undefined
  );
}

function renderInfoPanel() {
  return `
    <aside class="info-panel">
      <h3>ℹ️ About Changes</h3>
      <ul class="info-list">
        <li><strong>Price Cuts:</strong> Major price reductions announced</li>
        <li><strong>Increases:</strong> Price hikes detected</li>
        <li><strong>New Models:</strong> Latest model releases</li>
        <li><strong>Quota Updates:</strong> Free tier modifications</li>
      </ul>
    </aside>
  `;
}

export default { renderChanges };
