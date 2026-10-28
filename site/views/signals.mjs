/**
 * Signal Tracking View (T5.1 Round 11)
 *
 * Pure function rendering of AI industry signal tracking page
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { truncate, formatDate } from './format.js';

/**
 * Render signals page HTML
 * @param {object} data - Page data with signals, categories, filters
 * @returns {string} Complete HTML fragment
 */
export function renderSignals(data) {
  const { signals = [], categoryFilter = 'all', searchQuery = '' } = data || {};

  // Filter and sort signals
  const filtered = filterSignals(signals, categoryFilter, searchQuery);
  const sorted = sortBySignals(filtered);

  return `
    <div id="signals" class="page signals-page">
      ${renderHeader()}
      
      <aside class="filters-sidebar">
        ${renderCategoryTabs(categoryFilter)}
        ${searchSection(searchQuery)}
        ${renderInfoPanel()}
      </aside>
      
      <main class="signals-main">
        ${sorted.length === 0 ? renderNoResults() : renderSignalTimeline(sorted)}
      </main>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>📡 AI Industry Signals</h1>
      <p class="subtitle">Track important announcements, price changes, and product launches across AI providers</p>
    </header>
  `;
}

function renderCategoryTabs(currentCategory) {
  return `
    <nav class="category-tabs">
      <button class="tab-link ${currentCategory === 'all' ? 'active' : ''}" data-category="all">All Categories</button>
      <button class="tab-link ${currentCategory === 'price-cut' ? 'active' : ''}" data-category="price-cut">Price Cuts</button>
      <button class="tab-link ${currentCategory === 'new-model' ? 'active' : ''}" data-category="new-model">New Models</button>
      <button class="tab-link ${currentCategory === 'cache-pricing' ? 'active' : ''}" data-category="cache-pricing">Cache Pricing</button>
      <button class="tab-link ${currentCategory === 'free-tier' ? 'active' : ''}" data-category="free-tier">Free Tiers</button>
    </nav>
    
    <div class="sort-section">
      <label>Sort by:</label>
      <select>
        <option value="date-desc">Latest First</option>
        <option value="date-asc">Oldest First</option>
      </select>
    </div>
  `;
}

function searchSection(currentQuery) {
  return `
    <section class="search-section">
      <input type="text" placeholder="Search signals..." value="${escapeHtml(currentQuery)}" />
    </section>
  `;
}

function renderSignalTimeline(signals) {
  if (!signals || signals.length === 0) return '';

  return `
    <div class="signal-timeline">
      ${signals
        .slice(0, 50)
        .map((signal) => renderTimelineItem(signal))
        .join('')}
    </div>
  `;
}

function renderTimelineItem(signal) {
  const dateDisplay = formatDate(signal.date);
  const categoryBadge = getCategoryBadge(signal.topic);
  const handleDisplay = formatHandle(signal.handle);

  return `
    <article class="timeline-item" data-signal-id="${signal.id}">
      <div class="timeline-date">${dateDisplay}</div>
      
      <div class="timeline-content">
        <header class="signal-header">
          <span class="handle">${handleDisplay}</span>
          ${categoryBadge}
        </header>
        
        <blockquote class="signal-quote">"${truncate(signal.quote, 280)}"</blockquote>
        
        <div class="signal-details">
          ${signal.affects?.length ? `<div class="affects-list"><strong>Affects:</strong> ${signal.affects.join(', ')}</div>` : ''}
          ${signal.note ? `<div class="signal-note"><strong>Note:</strong> ${truncate(signal.note, 150)}</div>` : ''}
        </div>
        
        <footer class="signal-footer">
          <a href="${signal.url}" target="_blank" rel="noopener" class="source-link">View Source →</a>
          <span class="confidence-badge">${getConfidenceBadge(signal.confidence)}</span>
        </footer>
      </div>
    </article>
  `;
}

function renderNoResults() {
  return '<section class="no-results"><p>No signals found matching your criteria. Check back for latest updates!</p></section>';
}

function renderInfoPanel() {
  return `
    <aside class="info-panel">
      <h3>ℹ️ Signal Categories</h3>
      <ul class="info-list">
        <li><strong>Price Cuts:</strong> Major pricing reductions announced</li>
        <li><strong>New Models:</strong> Latest model releases</li>
        <li><strong>Cache Pricing:</strong> New caching policies introduced</li>
        <li><strong>Free Tiers:</strong> Newly available free offerings</li>
      </ul>
    </aside>
  `;
}

// Business logic helpers (pure functions)
function filterSignals(signals, categoryFilter, searchQuery) {
  let result = signals;

  // Category filtering
  if (categoryFilter !== 'all') {
    result = result.filter((s) => s.topic.toLowerCase() === categoryFilter.toLowerCase());
  }

  // Search filtering
  if (searchQuery?.trim()) {
    const query = searchQuery.toLowerCase();
    result = result.filter(
      (s) =>
        s.quote?.toLowerCase().includes(query) ||
        s.affects?.some((a) => a.toLowerCase().includes(query)) ||
        s.note?.toLowerCase().includes(query),
    );
  }

  return result;
}

function sortBySignals(signals) {
  return [...signals].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getCategoryBadge(topic) {
  const badges = {
    'price-cut': '<span class="badge price-cut">💰 Price Cut</span>',
    'new-model': '<span class="badge new-model">🆕 New Model</span>',
    'cache-pricing': '<span class="badge cache">💾 Cache Update</span>',
    'free-tier': '<span class="badge free">🎁 Free Tier</span>',
  };

  return badges[topic] || '<span class="badge neutral">● Update</span>';
}

function formatHandle(handle) {
  if (!handle) return '';

  const nameMap = {
    '@deepseek_ai': 'DeepSeek',
    '@xai': 'xAI',
    '@cursor_ai': 'Cursor',
    '@Alibaba_Qwen': 'Alibaba Qwen',
    '@OpenAI': 'OpenAI',
    '@AnthropicAI': 'Anthropic',
  };

  return nameMap[handle] || handle.replace('@', '');
}

function getConfidenceBadge(confidence) {
  const badgeClasses = {
    high: 'badge-high-confidence',
    medium: 'badge-medium-confidence',
    low: 'badge-low-confidence',
  };

  return `<span class="conf-badge ${badgeClasses[confidence] || ''}">${confidence || 'Unknown'}</span>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default { renderSignals };
