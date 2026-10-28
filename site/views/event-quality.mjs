/**
 * Event Quality Dashboard (T6.6)
 *
 * Display AI activity quality metrics, duplicates, and clustering
 */

import { kfmt } from './format.js';
import {
  calculateAiRelevance,
  findDuplicates,
  validateQuality,
  REGION_DICTIONARY,
} from '../../lib/event-quality.js';

export function renderQuality(data = {}) {
  const { events = [], filters = {}, results = null } = data;

  // Compute results if not provided
  const computedResults = results || computeResults(events, filters);

  return `
    <div id="event-quality" class="page event-quality-page">
      ${renderHeader()}
      
      ${renderFiltersSection(filters)}
      
      <main class="quality-main">
        ${computedResults.events.length > 0 ? renderQualitySummary(computedResults) : renderNoEvents()}
        
        ${
          computedResults.qualityReport.passes_quality_line
            ? renderQualityBadge(computedResults.qualityReport)
            : renderQualityWarning(computedResults.qualityReport)
        }
        
        ${computedResults.duplicates.length > 0 ? renderDuplicatesSection(computedResults) : ''}
        
        ${renderEventTable(computedResults.events.slice(0, 50))}
      </main>
    </div>
  `;
}

function renderHeader() {
  return `
    <header class="page-header">
      <h1>📊 Event Quality Analysis</h1>
      <p class="subtitle">AI event detection, validation, and deduplication quality scoring</p>
    </header>
  `;
}

function renderFiltersSection(currentFilters) {
  return `
    <aside class="filters-sidebar">
      <h3>Filters</h3>
      
      <div class="filter-section">
        <label>Minimum AI Score:</label>
        <select id="min-score-select">
          <option value="5">Low (≥5)</option>
          <option value="10" ${currentFilters.min_score === '10' ? 'selected' : ''}>Medium (≥10)</option>
          <option value="20">High (≥20)</option>
          <option value="30">Strict (≥30)</option>
        </select>
      </div>
      
      <div class="filter-section">
        <label>Show Duplicates:</label>
        <input type="checkbox" id="show-duplicates-check" checked />
      </div>
      
      <div class="info-panel">
        <h4>ℹ️ About Quality Scoring</h4>
        <ul class="info-list">
          <li><strong>AI Relevance:</strong> Based on terminology & context</li>
          <li><strong>Duplicate Rate:</strong> Must be < 1% per spec</li>
          <li><strong>Region Detection:</strong> ISO country code prioritization</li>
          <li><strong>Scoring:</strong> 0-100 scale (10+ = confirmed AI event)</li>
        </ul>
      </div>
    </aside>
  `;
}

function computeResults(events, filters) {
  const minScore = parseInt(filters.min_score, 10) || 10;

  // Apply AI relevance filtering
  const scoredEvents = events
    .map((event) => ({
      ...event,
      relevance: calculateAiRelevance(event.title, event.description),
      is_valid: calculateAiRelevance(event.title, event.description).score >= minScore,
    }))
    .filter((e) => e.is_valid);

  // Find duplicates
  const duplicates = findDuplicates(scoredEvents, { dateThreshold: 1 });

  // Calculate quality report
  const qualityReport = validateQuality(scoredEvents, duplicates);

  return { events: scoredEvents, duplicates, qualityReport, total_events: events.length };
}

function renderQualitySummary(results) {
  const { events, duplicates, qualityReport } = results;

  return `
    <section class="quality-summary">
      <div class="summary-cards">
        <div class="stat-card primary">
          <span class="count">${kfmt(events.length)}</span>
          <span class="label">Valid Events</span>
        </div>
        <div class="stat-card warning" style="${duplicates.length > 0 ? '' : 'display:none'}">
          <span class="count">${duplicates.length}</span>
          <span class="label">Duplicate Groups</span>
        </div>
        <div class="stat-card success">
          <span class="count">${qualityReport.accuracy_percent}%</span>
          <span class="label">Accuracy</span>
        </div>
      </div>
      
      <div class="quality-metrics">
        <div class="metric-item ${qualityReport.passes_quality_line ? 'pass' : 'fail'}">
          <span class="metric-label">Duplicate Rate:</span>
          <span class="metric-value">${qualityReport.duplicate_rate}</span>
          ${qualityReport.passes_quality_line ? '✓ Passes threshold (<1%)' : '⚠ Exceeds threshold'}
        </div>
        <div class="metric-item">
          <span class="metric-label">Total Raw Events:</span>
          <span class="metric-value">${results.total_events}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">AI Match Rate:</span>
          <span class="metric-value">${qualityReport.accuracy_percent}%</span>
        </div>
      </div>
    </section>
  `;
}

function renderQualityBadge(report) {
  return `
    <aside class="quality-badge success-pass">
      <div class="icon">✅</div>
      <h4>Quality Check Passed!</h4>
      <p>Duplicate rate (${report.duplicate_rate}) meets quality line requirements (<1%)</p>
    </aside>
  `;
}

function renderQualityWarning(report) {
  return `
    <aside class="quality-badge quality-fail">
      <div class="icon">⚠️</div>
      <h4>Quality Warning</h4>
      <p>Duplicate rate (${report.duplicate_rate}) exceeds threshold. Review ${report.duplicate_rate.replace('%', '')} duplicates.</p>
      <button class="action-btn review-btn">Review Duplicates</button>
    </aside>
  `;
}

function renderDuplicatesSection(results) {
  const { duplicates } = results;

  return `
    <section class="duplicates-section">
      <h3>🔁 Detected Duplicates (${duplicates.length} groups)</h3>
      
      ${
        duplicates.length === 0
          ? '<p>No duplicate events detected.</p>'
          : `
          <div class="duplicates-grid">
            ${duplicates
              .slice(0, 10)
              .map((d) => renderDuplicateGroup(d))
              .join('')}
          </div>
        `
      }
    </section>
  `;
}

function renderDuplicateGroup(duplicate) {
  return `
    <article class="duplicate-group">
      <header class="group-header">
        <span class="badge-primary">${duplicate.primary_index + 1}</span>
        <span class="badge-count">${duplicate.duplicate_indices.length + 1} versions</span>
      </header>
      
      <div class="group-content">
        <div class="primary-event">
          <strong>${duplicate.event_id}</strong>
        </div>
        
        <div class="duplicate-urls">
          ${duplicate.urls
            .map((url, idx) =>
              idx !== 0
                ? `<a href="${url}" target="_blank" rel="noopener" class="link-secondary">Duplicate ${idx}</a>`
                : `<a href="${url}" target="_blank" rel="noopener" class="link-primary">Primary Source →</a>`,
            )
            .join(' ')}
        </div>
      </div>
    </article>
  `;
}

function renderEventTable(events) {
  if (!events || events.length === 0) return '';

  return `
    <section class="events-table-section">
      <h3>📋 Validated Events (${events.length} shown)</h3>
      
      <table class="events-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>AI Score</th>
            <th>Region</th>
            <th>Matched By</th>
          </tr>
        </thead>
        <tbody>
          ${events
            .map(
              (event) => `
            <tr data-event-id="${event.id}">
              <td class="id-cell">${event.id || '-'}</td>
              <td class="title-cell">
                <strong>${truncate(event.title, 50)}</strong>
                ${event.location ? `<br><small>📍 ${event.location}</small>` : ''}
              </td>
              <td class="score-cell">
                <span class="badge score-${getScoreColor(event.relevance.score)}">
                  ${event.relevance.score}/100
                </span>
              </td>
              <td class="region-cell">
                ${formatRegionCode(event.region)}
              </td>
              <td class="matched-cell">
                ${
                  event.relevance.matchedBy
                    ?.slice(0, 2)
                    .map((m) => `<span class="tag">${m.split(':')[1]}</span>`)
                    .join(', ') || '-'
                }
              </td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
      
      ${
        events.length > 50
          ? `
        <div class="more-results">
          Showing first 50 of ${events.length} validated events. Export for full list.
        </div>
      `
          : ''
      }
    </section>
  `;
}

// Helper functions
function truncate(str, maxLength) {
  if (!str) return '';
  return str.length > maxLength ? `${str.slice(0, maxLength - 3)}...` : str;
}

function formatRegionCode(code) {
  if (!code || code === 'ZZ') return 'Unknown';
  const region = REGION_DICTIONARY[code];
  return region ? `${region.zh} (${code})` : code;
}

function getScoreColor(score) {
  if (score >= 30) return 'high';
  if (score >= 20) return 'medium';
  if (score >= 10) return 'low';
  return 'very-low';
}

function renderNoEvents() {
  return '<section class="no-events"><p>No AI events detected in current dataset.</p></section>';
}

export default { renderQuality };
