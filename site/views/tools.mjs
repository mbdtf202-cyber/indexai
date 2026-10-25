/**
 * AI Tools Showcase View (T5.1 Round 9)
 *
 * Pure function rendering of curated AI tools directory
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { truncate, kfmt } from './format.js';

/**
 * Render tools page HTML
 * @param {object} data - Page data with curated toolkits, categories, ratings
 * @returns {string} Complete HTML fragment
 */
export function renderTools(data) {
  const { tools = [], categoryFilter = 'all', sortBy = 'stars', searchQuery = '' } = data || {};

  // Filter and sort tools
  const filtered = filterByCategoryAndSearch(tools, categoryFilter, searchQuery);
  const sorted = sortByTools(filtered, sortBy);

  return `
    <div id="tools" class="page tools-page">
      ${renderHeader()}
      
      <aside class="filters-sidebar">
        ${renderCategoryTabs(categoryFilter)}
        ${renderSortControls(sortBy)}
        ${searchSection(searchQuery)}
        ${renderInfoPanel()}
      </aside>
      
      <main class="tools-main">
        ${sorted.length === 0 ? renderNoResults() : renderToolsGrid(sorted)}
      </main>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>🛠️ AI Developer Tools</h1>
      <p class="subtitle">Curated toolkit for AI development, debugging, and deployment</p>
    </header>
  `;
}

function renderCategoryTabs(currentCategory) {
  return `
    <nav class="category-tabs">
      <button class="tab-link ${currentCategory === 'all' ? 'active' : ''}" data-category="all">All Tools</button>
      <button class="tab-link ${currentCategory === 'development' ? 'active' : ''}" data-category="development">Development</button>
      <button class="tab-link ${currentCategory === 'monitoring' ? 'active' : ''}" data-category="monitoring">Monitoring</button>
      <button class="tab-link ${currentCategory === 'deployment' ? 'active' : ''}" data-category="deployment">Deployment</button>
      <button class="tab-link ${currentCategory === 'testing' ? 'active' : ''}" data-category="testing">Testing</button>
    </nav>
    
    <div class="sort-section">
      <label for="sort-select">Sort by:</label>
      <select id="sort-select">
        <option value="stars">⭐ Star Count</option>
        <option value="updated">🕐 Recently Updated</option>
        <option value="name">A-Z Name</option>
      </select>
    </div>
  `;
}

function renderSortControls(currentSort) {
  return `
    <div class="info-card">
      <h4>ℹ️ Tool Metrics</h4>
      <ul>
        <li><strong>Stars:</strong> GitHub popularity indicator</li>
        <li><strong>Updated:</strong> Last commit date</li>
        <li><strong>Ratings:</strong> User community feedback</li>
      </ul>
    </div>
  `;
}

function searchSection(currentQuery) {
  return `
    <section class="search-section">
      <input type="text" placeholder="Search tools..." value="${escapeHtml(currentQuery)}" />
    </section>
  `;
}

function renderToolsGrid(tools) {
  if (!tools || tools.length === 0) return '<p>No tools found matching your criteria.</p>';

  return `
    <div class="tools-grid">
      ${tools
        .slice(0, 48)
        .map((tool) => renderToolCard(tool))
        .join('')}
    </div>
  `;
}

function renderToolCard(tool) {
  const descriptionDisplay = truncate(
    tool.description || tool.summary || 'No description available',
    120,
  );
  const tagsDisplay = formatTags(tool.tags || []);
  const difficultyBadge = getDifficultyBadge(tool.difficulty || 'intermediate');

  return `
    <article class="tool-card" data-tool-id="${tool.id || slugify(tool.name)}">
      <header class="card-header">
        <div class="tool-icon">${getIcon(tool.category)}</div>
        <div class="tool-meta">
          <span class="difficulty-badge">${difficultyBadge}</span>
          ${tagsDisplay}
        </div>
      </header>
      
      <div class="tool-details">
        <h3>${truncate(tool.name, 40)}</h3>
        <p class="description">${descriptionDisplay}</p>
        
        <div class="stats-row">
          ${tool.stars ? `<span class="star-count">⭐ ${kfmt(tool.stars)}</span>` : ''}
          ${tool.updated_at ? `<span class="last-update">🕒 ${formatDateRelative(tool.updated_at)}</span>` : ''}
        </div>
      </div>
      
      <footer class="card-footer">
        ${tool.github_url ? `<a href="${tool.github_url}" target="_blank" rel="noopener" class="cta-button">View on GitHub →</a>` : ''}
        ${tool.documentation ? `<a href="${tool.documentation}" target="_blank" rel="noopener" class="doc-link">Docs →</a>` : ''}
      </footer>
    </article>
  `;
}

function renderNoResults() {
  return '<section class="no-results"><p>No AI tools found matching your criteria. Try adjusting filters or search terms.</p></section>';
}

function renderInfoPanel() {
  return `
    <aside class="info-panel">
      <h3>💡 What Makes a Good AI Tool?</h3>
      <ul class="info-list">
        <li><strong>Closed-source:</strong> Proprietary algorithms</li>
        <li><strong>Open-source:</strong> Community-driven development</li>
        <li><strong>Active maintenance:</strong> Regular updates</li>
        <li><strong>Good documentation:</strong> Easy to integrate</li>
      </ul>
    </aside>
  `;
}

// Business logic helpers (pure functions)
function filterByCategoryAndSearch(tools, categoryFilter, searchQuery) {
  let result = tools;

  // Category filtering
  if (categoryFilter !== 'all') {
    result = result.filter((t) => t.category?.toLowerCase() === categoryFilter.toLowerCase());
  }

  // Search filtering
  if (searchQuery && searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    result = result.filter(
      (t) =>
        t.name?.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(query)),
    );
  }

  return result;
}

function sortByTools(tools, sortBy) {
  const sorted = [...tools];

  switch (sortBy) {
    case 'stars':
      return sorted.sort((a, b) => (b.stars || 0) - (a.stars || 0));
    case 'updated':
      return sorted.sort((a, b) => {
        const dateA = new Date(a.updated_at || '1970-01-01');
        const dateB = new Date(b.updated_at || '1970-01-01');
        return dateB - dateA;
      });
    case 'name':
      return sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    default:
      return sorted;
  }
}

function formatTags(tags) {
  if (!tags || !Array.isArray(tags)) return '';

  const maxTags = 3;
  const visibleTags = tags.slice(0, maxTags);

  return visibleTags.map((tag) => `<span class="tag">#${tag}</span>`).join(' ');
}

function getDifficultyBadge(difficulty) {
  const badges = {
    beginner: '<span class="badge-beginner">🟢 Beginner</span>',
    intermediate: '<span class="badge-intermediate">🟡 Intermediate</span>',
    advanced: '<span class="badge-advanced">🔴 Advanced</span>',
  };

  return badges[difficulty] || '<span class="badge-intermediate">🟡 Intermediate</span>';
}

function getIcon(category) {
  const icons = {
    development: '👨‍💻',
    monitoring: '📊',
    deployment: '🚀',
    testing: '🧪',
    default: '🛠️',
  };
  return icons[category] || icons.default;
}

function formatDateRelative(dateStr) {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function slugify(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default { renderTools };
