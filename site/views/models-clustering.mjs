/**
 * Model Clustering & Deduplication View (T6.4)
 *
 * Display clusters of equivalent AI models across different providers
 */

import { money } from '../styles/tokens.mjs';
import { clusterEquivalentModels, generateDedupReport } from '../../lib/model-clustering.mjs';

export function renderClustering(data = {}) {
  const { models = [], clusters, showDetails = false, filter = 'all' } = data;

  // Compute clusters if not provided
  const computedClusters = clusters || (models.length ? clusterEquivalentModels(models) : []);
  const report = generateDedupReport(computedClusters);

  return `
    <div id="model-clustering" class="page clustering-page">
      ${renderHeader()}
      
      ${renderSummary(report)}
      
      ${computedClusters.length > 0 ? renderClustersView(computedClusters, filter) : renderNoDuplicates()}
      
      ${showDetails ? renderDetailsSection(computedClusters) : ''}
    </div>
  `;
}

function renderHeader() {
  return `
    <header class="page-header">
      <h1>🔀 Model Clustering</h1>
      <p class="subtitle">Identify duplicate/semantically-equivalent models across providers</p>
    </header>
  `;
}

function renderSummary(report) {
  if (!report) return '';

  return `
    <section class="summary-cards">
      <div class="stat-card primary">
        <span class="count">${report.total_clusters}</span>
        <span class="label">Duplicate Groups</span>
      </div>
      <div class="stat-card warning" style="${report.potential_duplicates?.length > 5 ? 'display:none' : ''}">
        <span class="count">${report.potential_duplicates?.length || 0}</span>
        <span class="label">High Priority Issues</span>
      </div>
      <div class="stat-card success">
        <span class="count">✓</span>
        <span class="label">Data Quality</span>
      </div>
    </section>
    
    ${generateRecommendationsHTML(report.recommendations || [])}
  `;
}

function generateRecommendationsHTML(recommendations) {
  if (!recommendations || recommendations.length === 0) return '';

  return `
    <aside class="recommendations-panel">
      <h3>💡 Recommendations</h3>
      <ul class="recommendation-list">
        ${recommendations
          .map(
            (rec) => `
          <li class="rec-item ${rec.priority}">
            <strong>${getPriorityBadge(rec.priority)}</strong>
            <span>${rec.reason}</span>
            <code>${rec.affected.slice(0, 2).join(', ')}</code>${rec.affected.length > 2 ? '+' + (rec.affected.length - 2) : ''}
          </li>
        `,
          )
          .join('')}
      </ul>
    </aside>
  `;
}

function getPriorityBadge(priority) {
  return { high: '🔴 HIGH', medium: '🟡 MEDIUM', low: '🟢 LOW' }[priority] || 'ℹ️ INFO';
}

function renderClustersView(clusters, filter) {
  const filtered =
    filter === 'high-only' ? clusters.filter((c) => c.members.length >= 3) : clusters;

  if (filtered.length === 0) {
    return `<section class="no-duplicates"><p>No duplicate groups found in current dataset.</p></section>`;
  }

  return `
    <section class="clusters-section">
      <div class="filter-tabs">
        <button class="tab-link active" data-filter="all">All (${filtered.length})</button>
        <button class="tab-link" data-filter="high-only">High Priority (${clusters.filter((c) => c.members.length >= 3).length})</button>
      </div>
      
      <div class="clusters-grid">
        ${filtered.map((cluster) => renderClusterCard(cluster)).join('')}
      </div>
    </section>
  `;
}

function renderClusterCard(cluster) {
  const priorityLevel = cluster.members.length >= 3 ? 'high' : 'medium';

  return `
    <article class="cluster-card ${priorityLevel}" data-cluster-id="${cluster.representatives?.[0]?.id}">
      <header class="card-header">
        <span class="badge-priority badge-${priorityLevel}">${cluster.members.length} versions detected</span>
        <span class="vendor-tag">${cluster.representatives?.[0]?.vendor || 'unknown'}</span>
      </header>
      
      <h4>${cluster.representatives?.[0]?.name || 'Unknown Family'}</h4>
      
      <div class="members-list">
        ${cluster.members
          .map(
            (m) => `
          <div class="member-item">
            <span class="vendor-icon">${m.vendor.charAt(0).toUpperCase()}</span>
            <span class="model-name">${m.id}</span>
            <span class="price-tag">$${m.price}/M</span>
          </div>
        `,
          )
          .join('')}
      </div>
      
      <div class="pricing-analysis">
        ${calculatePriceSpread(cluster)}
      </div>
    </article>
  `;
}

function calculatePriceSpread(cluster) {
  const prices = cluster.members.map((m) => parseFloat(m.price) || 0).filter((p) => p > 0);
  if (prices.length < 2) return '<span class="no-price-data">Pricing unavailable</span>';

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = (((max - min) / min) * 100).toFixed(1);

  return `
    <span class="price-spread">Price spread: ${spread}% difference</span>
    ${spread > 30 ? '<span class="warning-badge">⚠️ Large spread</span>' : ''}
  `;
}

function renderNoDuplicates() {
  return `
    <section class="clean-state">
      <div class="empty-icon">✅</div>
      <h2>No Duplicates Detected</h2>
      <p>All models are unique in your dataset!</p>
    </section>
  `;
}

function renderDetailsSection(clusters) {
  if (!clusters || clusters.length === 0) return '';

  return `
    <section class="details-section">
      <h3>Detailed Analysis</h3>
      <table class="details-table">
        <thead>
          <tr>
            <th>Family</th>
            <th>Versions</th>
            <th>Vendors</th>
            <th>Pricing Spread</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${clusters
            .map(
              (c) => `
            <tr>
              <td>${c.representatives?.[0]?.vendor || '-'}</td>
              <td><strong>${c.members.length}</strong></td>
              <td>${c.members
                .map((m) => m.vendor)
                .slice(0, 3)
                .join(', ')}${c.members.length > 3 ? '...' : ''}</td>
              <td>${getPriceSpreadText(c)}</td>
              <td><button class="action-btn">Consolidate</button></td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `;
}

function getPriceSpreadText(cluster) {
  const prices = cluster.members.map((m) => parseFloat(m.price) || 0).filter((p) => p > 0);
  if (prices.length < 2) return '-';

  const spread = (
    ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) *
    100
  ).toFixed(1);
  return `${spread}%`;
}

// URL parameter helper
export function parseFiltersFromURL(params) {
  const filter = params.get('filter') || 'all';
  const showDetails = params.get('details') === 'true';

  return { filter, showDetails };
}

export default { renderClustering, parseFiltersFromURL };
