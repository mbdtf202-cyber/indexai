/**
 * Benchmark Page with Lazy Loading (T6.8)
 * 
 * Load benchmark directories and rankings lazily, support parquet fallback
 */

import { kfmt, pct } from '../styles/tokens.mjs';
import { fetchBenchmarkDirectory, fetchSelectedBenchmark, sortTauBenchBySubmissionDate, validateBenchmarkEntry, paginateResults, computeRankings } from '../../lib/benchmark-loading.mjs';

export function renderBenchmark(data = {}) {
  const { lazyLoad = true, selectedBenchmark = null, directory = null, benchmarks = [], loadingStats = {}, currentPage = 1 } = data;
  
  return `
    <div id="benchmark" class="page benchmark-page">
      ${renderHeader()}
      
      <aside class="benchmark-sidebar">
        ${lazyLoad ? renderLazyLoadInstructions() : ''}
        ${await renderDirectoryList(directory)}
      </aside>
      
      <main class="benchmark-main">
        ${selectedBenchmark ? await renderBenchmarkDetails(selectedBenchmark, benchmarks, loadingStats, currentPage) : renderBenchmarkSelect()}
      </main>
    </div>
  `;
}

async function renderHeader() {
  return `
    <header class="page-header">
      <h1>📊 AI Benchmarks</h1>
      <p class="subtitle">Evaluate models across standardized benchmarks with lazy-loaded rankings</p>
    </header>
  `;
}

function renderLazyLoadInstructions() {
  return `
    <aside class="lazy-info-panel">
      <h3>ℹ️ Lazy Loading Active</h3>
      <ul class="info-list">
        <li>Benchmark directories loaded on demand</li>
        <li>Rankings pre-computed during build time</li>
        <li>τ-bench sorted by submission_date first</li>
        <li>Parquet → HF JSON fallback for reliability</li>
      </ul>
    </aside>
  `;
}

async function renderDirectoryList(directory) {
  if (!directory) {
    return '<section class="loading-status"><p>Loading directory...</p></section>';
  }
  
  return `
    <nav class="benchmark-nav">
      <h3>Benchmark Directories</h3>
      <ul class="directory-list">
        ${directory.items.map(item => `
          <li class="dir-item">
            <a href="/benchmarks?benchmark=${item.name}" class="link-primary">${item.name}</a>
            <span class="size">${kfmt(item.size)}</span>
          </li>
        `).join('')}
      </ul>
      <small>Total: ${directory.total_items} benchmarks</small>
    </nav>
  `;
}

async function renderBenchmarkSelect() {
  return `
    <section class="select-benchmark">
      <h2>Select a Benchmark to View</h2>
      <p>Choose from available benchmarks above or search for a specific one.</p>
      
      <form class="search-form">
        <input type="text" placeholder="Search benchmarks..." />
        <button type="submit" class="cta-button">Search</button>
      </form>
    </section>
  `;
}

async function renderBenchmarkDetails(benchmarkId, benchmarks, loadingStats, currentPage) {
  // Sort τ-bench by submission_date first
  const sortedBenchmarks = sortTauBenchBySubmissionDate(benchmarks);
  
  // Validate each entry
  const validated = sortedBenchmarks.map(entry => validateBenchmarkEntry(entry));
  const validEntries = validated.filter(v => v.valid).map(v => v.corrected_entry);
  
  // Pre-compute rankings
  const rankedEntries = computeRankings(validEntries);
  
  // Paginate results
  const paginated = paginateResults(rankedEntries, currentPage);
  
  return `
    <section class="benchmark-detail">
      <header class="detail-header">
        <h3>${benchmarkId.replace(/-/g, ' ').toUpperCase()}</h3>
        <span class="badge source-badge">${loadingStats.source || 'parquet'}</span>
      </header>
      
      ${paginated.data.length === 0 
        ? '<section class="no-data"><p>No benchmark results available.</p></section>'
        : renderRankingsTable(paginated.data, paginated.pagination)
      }
      
      ${renderLoadingStats(loadingStats)}
    </section>
  `;
}

function renderRankingsTable(entries, pagination) {
  if (!entries || entries.length === 0) return '';
  
  return `
    <table class="rankings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Model</th>
          <th>Score</th>
          <th>Rank</th>
          <th>Submitted</th>
        </tr>
      </thead>
      <tbody>
        ${entries.slice(0, 50).map((entry, idx) => `
          <tr>
            <td class="rank-cell">#${idx + 1}</td>
            <td class="model-name"><strong>${entry.model_name || 'Unknown'}</strong></td>
            <td class="score-cell">${entry.score !== null ? pct(entry.score) : '—'}</td>
            <td class="rank-value">${entry.rank || 'N/A'}</td>
            <td class="date-cell">${formatDate(entry.submission_date)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    ${pagination.total_pages > 1 ? renderPagination(pagination) : ''}
  `;
}

function renderPagination(pagination) {
  return `
    <nav class="pagination">
      <a href="?page=${pagination.current_page - 1}" class="page-link ${pagination.has_prev ? '' : 'disabled'}">
        ${pagination.has_prev ? '← Previous' : 'Previous'}
      </a>
      
      <span class="page-info">Page ${pagination.current_page} of ${pagination.total_pages}</span>
      
      <a href="?page=${pagination.current_page + 1}" class="page-link ${pagination.has_next ? '' : 'disabled'}">
        ${pagination.has_next ? 'Next →' : 'Next'}
      </a>
    </nav>
  `;
}

function renderLoadingStats(stats) {
  if (!stats || !stats.parquet_count) return '';
  
  return `
    <aside class="loading-stats">
      <h4>📈 Loading Statistics</h4>
      <ul class="stat-list">
        <li><strong>Parquet Loads:</strong> ${kfmt(stats.parquet_count || 0)}</li>
        <li><strong>HF Fallback:</strong> ${kfmt(stats.hf_fallback_count || 0)}</li>
        <li><strong>Error Rate:</strong> ${stats.error_rate || '0%'} ${stats.has_errors ? '⚠️' : '✓'}</li>
      </ul>
    </aside>
  `;
}

// Helpers
function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function await(value) {
  return value instanceof Promise ? await value : value;
}

export default { renderBenchmark };
