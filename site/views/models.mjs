/**
 * Models Comparison View (T5.1 Round 3)
 *
 * Pure function rendering of model comparison table
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { money, kfmt } from './format.js';

/**
 * Render models comparison page HTML
 * @param {object} data - Page data with models, benchmarks, filters
 * @returns {string} Complete HTML fragment
 */
export function renderModels(data) {
  const { models, filters = {}, sortBy = 'input', sortOrder = 'asc' } = data || {};

  // Sort and filter models based on user preferences
  const sortedModels = applySortingAndFiltering(models || [], filters, sortBy, sortOrder);

  return `
    <div id="models" class="page models-page">
      ${renderHeader()}
      
      <aside class="filters-sidebar">
        ${renderFilters(filters)}
      </aside>
      
      <main class="models-main">
        ${renderSortControls(sortBy, sortOrder)}
        
        <div class="models-table-container">
          <table class="models-table">
            <thead>${renderTableHeader(sortBy, sortOrder)}</thead>
            <tbody>
              ${sortedModels.map((model) => renderModelRow(model)).join('')}
            </tbody>
          </table>
        </div>
        
        ${sortedModels.length === 0 ? renderNoResults() : ''}
      </main>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>🚀 Model Pricing Comparison</h1>
      <p class="subtitle">Compare real-time pricing across all AI providers</p>
    </header>
  `;
}

function renderFilters(currentFilters) {
  return `
    <div class="filter-section">
      <h3>Filters</h3>
      <label class="checkbox">
        <input type="checkbox" ${currentFilters.showOnlyFree ? 'checked' : ''}>
        Show free tiers only
      </label>
      <label class="checkbox">
        <input type="checkbox" ${currentFilters.showDiscounted ? 'checked' : ''}>
        Show discounted prices
      </label>
      <select>
        <option value="">All vendors</option>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
        <option value="google">Google</option>
        <option value="xai">xAI</option>
        <option value="deepseek">DeepSeek</option>
        <option value="meta">Meta</option>
      </select>
    </div>
  `;
}

function renderSortControls(_currentSortBy, _currentSortOrder) {
  return `
    <div class="sort-controls">
      <span>Sort by:</span>
      <button class="sort-btn active" data-sort="input">Input Price</button>
      <button class="sort-btn" data-sort="output">Output Price</button>
      <button class="sort-btn" data-sort="free">Free Tier</button>
      <button class="sort-btn" data-sort="updated">Last Updated</button>
    </div>
  `;
}

function renderTableHeader(currentSortBy, currentSortOrder) {
  const sortIcons = {
    input: currentSortBy === 'input' ? (currentSortOrder === 'asc' ? '↑' : '↓') : '',
    output: currentSortBy === 'output' ? (currentSortOrder === 'asc' ? '↑' : '↓') : '',
    free: currentSortBy === 'free' ? (currentSortOrder === 'desc' ? '↑' : '↓') : '',
  };

  return `
    <tr>
      <th data-sort="name">Model Name ${sortIcons.name}</th>
      <th data-sort="vendor">Vendor</th>
      <th data-sort="input">Input $/1M ${sortIcons.input}</th>
      <th data-sort="output">Output $/1M ${sortIcons.output}</th>
      <th data-sort="free">Free Tier ${sortIcons.free}</th>
      <th data-sort="cache">Cache Reads</th>
    </tr>
  `;
}

function renderModelRow(model) {
  return `
    <tr data-model-id="${model.id}" class="${model.vendor.toLowerCase().replace(/-/g, '')}-row">
      <td class="model-name">
        <strong>${model.name}</strong>
        ${model.family ? `<span class="family">${model.family.replace(/[-_]/g, ' ')}</span>` : ''}
      </td>
      <td class="vendor">${model.vendor}</td>
      <td class="price-input">$${money(model.input)}</td>
      <td class="price-output">$${money(model.output)}</td>
      <td class="free-tier">${model.free_quota ? `${kfmt(model.free_quota)} units` : '—'}</td>
      <td class="cache">$${model.cache_read || 0.2}/1M</td>
    </tr>
  `;
}

function renderNoResults() {
  return '<p class="no-results">No models match your current filters. Try adjusting your search criteria.</p>';
}

// Business logic helpers (pure functions)
export function applySortingAndFiltering(models, filters, sortBy, sortOrder) {
  let result = [...models];

  // Apply filters first
  if (filters.showOnlyFree) {
    result = result.filter((m) => m.free_quota > 0);
  }

  if (filters.showDiscounted) {
    result = result.filter((m) => m.discounted === true || m.price_change_percent < 0);
  }

  // Then sort
  result.sort((a, b) => {
    let compareValueA, compareValueB;

    switch (sortBy) {
      case 'input':
        compareValueA = a.input || Infinity;
        compareValueB = b.input || Infinity;
        break;
      case 'output':
        compareValueA = a.output || Infinity;
        compareValueB = b.output || Infinity;
        break;
      case 'free':
        compareValueA = a.free_quota || 0;
        compareValueB = b.free_quota || 0;
        break;
      default:
        compareValueA = a.name.toLowerCase();
        compareValueB = b.name.toLowerCase();
    }

    if (compareValueA < compareValueB) return sortOrder === 'asc' ? -1 : 1;
    if (compareValueA > compareValueB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  return result;
}

export default { renderModels, applySortingAndFiltering };
