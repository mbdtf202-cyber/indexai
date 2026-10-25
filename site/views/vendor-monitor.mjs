/**
 * Vendor Monitoring Dashboard (T6.5)
 *
 * Monitor official vendor websites for pricing/model changes
 */

import { money } from '../styles/tokens.mjs';
import {
  monitorVendors,
  calculateHealthScore,
  getMonitoringSchedule,
} from '../../lib/vendor-monitor.mjs';

export function renderMonitor(data = {}) {
  const { vendors = [], lastRun = null, health, schedules = {} } = data;

  return `
    <div id="vendor-monitor" class="page vendor-monitor-page">
      ${renderHeader()}
      
      <aside class="monitor-sidebar">
        ${renderHealthSummary(health)}
        ${renderSchedules(schedules)}
      </aside>
      
      <main class="monitor-main">
        ${renderVendorGrid(vendors, lastRun)}
      </main>
    </div>
  `;
}

function renderHeader() {
  return `
    <header class="page-header">
      <h1>👁️ Vendor Site Monitoring</h1>
      <p class="subtitle">Track official vendor websites for pricing & model updates</p>
    </header>
  `;
}

function renderHealthSummary(health) {
  if (!health) {
    return '<section class="status-card"><p>Monitoring not yet run.</p></section>';
  }

  const healthClass =
    health.overall_health === 'healthy'
      ? 'success'
      : health.overall_health === 'degraded'
        ? 'warning'
        : 'error';

  return `
    <aside class="health-panel status-card ${healthClass}">
      <h3>📊 Monitoring Health</h3>
      <div class="health-metrics">
        <div class="metric-item">
          <span class="metric-label">Success Rate:</span>
          <span class="metric-value">${health.success_rate}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Successful:</span>
          <span class="metric-value success">${health.successful_monitors}/${health.total_vendors}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Status:</span>
          <span class="metric-value badge ${healthClass}">${health.overall_health.toUpperCase()}</span>
        </div>
      </div>
      <button class="cta-button" onclick="window.location.reload()">Refresh Monitoring</button>
    </aside>
  `;
}

function renderSchedules(schedules) {
  if (!schedules || Object.keys(schedules).length === 0) return '';

  return `
    <aside class="schedules-panel">
      <h3>⏰ Monitoring Schedule</h3>
      <ul class="schedule-list">
        ${Object.entries(schedules)
          .map(
            ([vendor, schedule]) => `
          <li class="schedule-item">
            <strong>${vendor.charAt(0).toUpperCase() + vendor.slice(1)}</strong>
            <span>${schedule.recommended_frequency}</span>
            <small>${schedule.reason}</small>
          </li>
        `,
          )
          .join('')}
      </ul>
    </aside>
  `;
}

function renderVendorGrid(vendors, lastRun) {
  if (!vendors || vendors.length === 0) {
    return `<section class="no-vendors"><p>No vendors configured for monitoring.</p></section>`;
  }

  return `
    <section class="vendors-section">
      <div class="last-update">Last checked: ${lastRun ? formatRelativeTime(lastRun) : 'Never'}</div>
      
      <div class="vendor-grid">
        ${vendors.map((vendor) => renderVendorCard(vendor)).join('')}
      </div>
    </section>
    
    <aside class="monitor-info">
      <h3>ℹ️ About Monitoring</h3>
      <ul class="info-list">
        <li><strong>Polling Interval:</strong> Every 24-72 hours depending on vendor priority</li>
        <li><strong>What we check:</strong> Status codes, content length, last-modified headers</li>
        <li><strong>Change detection:</strong> Automatic alerts when pages are updated</li>
        <li><strong>Reliability:</strong> Retry logic with exponential backoff</li>
      </ul>
    </aside>
  `;
}

function renderVendorCard(vendor) {
  const statusClass = vendor.status === 'success' ? 'success' : 'error';
  const timestamp = vendor.snapshot?.timestamp || new Date().toISOString();
  const timeAgo = formatRelativeTime(timestamp);

  return `
    <article class="vendor-card ${statusClass}" data-vendor="${vendor.vendor}">
      <header class="card-header">
        <h3>${vendor.name || vendor.vendor.charAt(0).toUpperCase() + vendor.vendor.slice(1)}</h3>
        <span class="status-badge ${statusClass}">${vendor.status.toUpperCase()}</span>
      </header>
      
      <div class="vendor-details">
        <a href="${vendor.snapshot?.url || '#'}" target="_blank" rel="noopener" class="visit-link">
          Visit Official Site →
        </a>
        
        <div class="metrics-row">
          <span class="metric">Status Code: ${vendor.snapshot?.status_code || 'N/A'}</span>
          <span class="metric">Content Size: ${formatSize(vendor.snapshot?.content_length || 0)}</span>
          <span class="metric">Updated: ${timeAgo}</span>
        </div>
        
        ${
          vendor.snapshot?.last_modified
            ? `
          <div class="meta-info">
            Last Modified: ${new Date(vendor.snapshot.last_modified).toLocaleDateString()}
          </div>
        `
            : ''
        }
        
        ${
          vendor.error
            ? `
          <div class="error-message">
            Error: ${vendor.error}
          </div>
        `
            : ''
        }
      </div>
      
      <footer class="card-footer">
        <button class="action-btn retry-btn" data-vendor="${vendor.vendor}">
          🔄 Retry Check
        </button>
      </footer>
    </article>
  `;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Unknown';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatSize(bytes) {
  if (!bytes) return 'N/A';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

// URL parameter parsing helper
export function parseMonitorParams(params) {
  const vendorIds = params.get('vendors')?.split(',') || ['all'];
  const interval = parseInt(params.get('interval')) || 24;

  return {
    filter: vendorIds[0] === 'all' ? 'all' : vendorIds,
    interval_hours: interval,
  };
}

export default { renderMonitor };
