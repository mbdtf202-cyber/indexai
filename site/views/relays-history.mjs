/**
 * Relay Gateway History & Availability Dashboard (T6.7)
 *
 * Track relay history, availability rates, and price template grouping
 */

import { kfmt } from '../styles/tokens.mjs';
import {
  groupByPriceTemplate,
  calculateAvailabilityRate,
  getRelayHistoryTimeline,
  generateRelayReport,
} from '../../lib/relay-history.mjs';

export function renderRelayHistory(data = {}) {
  const { relays = [], historicalDataMap = {}, showHistoryDetails = false } = data;

  // Compute report if not provided
  const report = generateRelayReport(relays || [], historicalDataMap);
  const templateGroups = groupByPriceTemplate(relays || []);

  return `
    <div id="relays-history" class="page relays-history-page">
      ${renderHeader()}
      
      <aside class="history-sidebar">
        ${renderSummaryStats(report)}
        ${renderAvailabilityBreakdown(report)}
      </aside>
      
      <main class="history-main">
        ${renderPriceTemplateGrouping(templateGroups)}
        
        ${showHistoryDetails ? renderHistoricalTimeline(relays, historicalDataMap) : renderRecentEvents(report.summary)}
      </main>
      
      ${
        report.by_price_template.standard?.summary &&
        report.by_price_template.standard.summary.count > 0
          ? `<section class="template-info">
             <strong>Note:</strong> ${report.by_price_template.standard.summary.count} gateways share the same pricing template "${report.by_price_template.standard.summary.template_name}".
           </section>`
          : ''
      }
    </div>
  `;
}

function renderHeader() {
  return `
    <header class="page-header">
      <h1>🔄 Relay History & Availability</h1>
      <p class="subtitle">Track gateway lifecycle, 30-day availability rates, and pricing template groups</p>
    </header>
  `;
}

function renderSummaryStats(report) {
  if (!report || !report.summary) return '';

  const { excellent_count, good_count, degraded_count, critical_count, overall_health } =
    report.summary;

  return `
    <section class="stats-panel">
      <h3>📊 Overview</h3>
      <div class="stat-grid">
        <div class="stat-item success">
          <span class="count">${excellent_count}</span>
          <span class="label">Excellent (>99%)</span>
        </div>
        <div class="stat-item good">
          <span class="count">${good_count}</span>
          <span class="label">Good (95-99%)</span>
        </div>
        <div class="stat-item warning">
          <span class="count">${degraded_count}</span>
          <span class="label">Degraded (90-95%)</span>
        </div>
        <div class="stat-item error">
          <span class="count">${critical_count}</span>
          <span class="label">Critical (<90%)</span>
        </div>
      </div>
      <div class="overall-status ${overall_health === 'healthy' ? 'success' : 'warning'}">
        Overall Health: ${overall_health.toUpperCase()}
      </div>
    </section>
  `;
}

function renderAvailabilityBreakdown(report) {
  if (!report || !report.by_availability_status) return '';

  const statuses = ['excellent', 'good', 'degraded', 'critical'];

  return `
    <aside class="availability-breakdown">
      <h4>Availability Status Distribution</h4>
      <ul class="status-list">
        ${statuses
          .map(
            (status) => `
          <li class="status-item status-${status}">
            <span class="status-badge">${status.charAt(0).toUpperCase() + status.slice(1)}</span>
            <span class="status-count">${report.by_availability_status[status] || 0}</span>
            <span class="percentage">${calculatePercentage(report.total_relays, report.by_availability_status[status] || 0)}%</span>
          </li>
        `,
          )
          .join('')}
      </ul>
    </aside>
  `;
}

function renderPriceTemplateGrouping(templateGroups) {
  if (!templateGroups || Object.keys(templateGroups).length === 0) {
    return '<section class="no-templates"><p>No relay templates detected.</p></section>';
  }

  return `
    <section class="templates-section">
      <h3>💰 Price Template Groups</h3>
      <div class="template-groups-grid">
        ${Object.entries(templateGroups)
          .map(([templateName, group]) => {
            const count = group.summary?.count || group.length;

            return `
            <article class="template-group-card ${templateName}" data-template="${templateName}">
              <header class="group-header">
                <h4>${templateName.charAt(0).toUpperCase() + templateName.slice(1)} Tier</h4>
                <span class="gateway-count">${kfmt(count)} gateways</span>
              </header>
              
              <div class="template-info-box">
                <p class="template-description">${group.summary?.template_desc || `Common ${templateName} pricing pattern`}</p>
                <div class="template-range">
                  ${
                    PRICE_TEMPLATE_RANGES[templateName]?.input_range
                      ? `Input: $${PRICE_TEMPLATE_RANGES[templateName].input_range[0]}-$${PRICE_TEMPLATE_RANGES[templateName].input_range[1]}/M`
                      : 'N/A'
                  } | 
                  ${
                    PRICE_TEMPLATE_RANGES[templateName]?.output_range
                      ? `Output: $${PRICE_TEMPLATE_RANGES[templateName].output_range[0]}-$${PRICE_TEMPLATE_RANGES[templateName].output_range[1]}/M`
                      : 'N/A'
                  }
                </div>
              </div>
              
              <div class="template-gateways">
                ${group
                  .slice(0, 5)
                  .map(
                    (gateway) => `
                  <div class="gateway-item">
                    <strong>${gateway.name}</strong>
                    <span class="price">$${gateway.input_price || gateway.base_input_price || 0} input / $${gateway.output_price || gateway.base_output_price || 0} output</span>
                  </div>
                `,
                  )
                  .join('')}
                ${group.length > 5 ? `<div class="more-link">+${group.length - 5} more...</div>` : ''}
              </div>
            </article>
          `;
          })
          .join('')}
      </div>
    </section>
  `;
}

function renderRecentEvents(summary) {
  if (!summary || !summary.excellent_count) {
    return '<section class="no-events"><p>No recent relay activity tracked.</p></section>';
  }

  return `
    <section class="recent-events-section">
      <h3>📅 Recent Activity Summary</h3>
      <div class="event-summary-cards">
        <div class="event-card">
          <h4>Latest Updates</h4>
          <p>${summary.excellent_count} gateways in excellent standing</p>
          <p class="timestamp">Last updated: Just now</p>
        </div>
        <div class="event-card">
          <h4>Template Groups</h4>
          <p>${Object.values(summary).filter((v) => typeof v === 'number').length} active templates</p>
        </div>
      </div>
    </section>
  `;
}

function renderHistoricalTimeline(relays, historicalDataMap) {
  return `
    <section class="timeline-section">
      <h3>📜 Complete Event Timeline</h3>
      <div class="timeline-grid">
        ${relays
          .map((relay) => {
            const history = getRelayHistoryTimeline(historicalDataMap[relay.id] || []);

            return `
            <article class="relay-timeline" data-relay-id="${relay.id}">
              <h4>${relay.name}</h4>
              <div class="timeline-events">
                ${
                  history.length > 0
                    ? history
                        .slice(0, 8)
                        .map(
                          (event) => `
                      <div class="timeline-event ${event.type.toLowerCase().replace(' ', '-')}">
                        <time datetime="${event.timestamp}">${formatRelativeTime(event.timestamp)}</time>
                        <span class="event-message">${event.message}</span>
                      </div>
                    `,
                        )
                        .join('')
                    : '<div class="no-history">No events recorded</div>'
                }
              </div>
            </article>
          `;
          })
          .join('')}
      </div>
    </section>
  `;
}

// Constants
const PRICE_TEMPLATE_RANGES = {
  standard: { input_range: [0.2, 5.0], output_range: [0.6, 15.0] },
  premium: { input_range: [5.0, 30.0], output_range: [15.0, 60.0] },
  budget: { input_range: [0.01, 0.2], output_range: [0.03, 0.6] },
};

// Helper functions
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function calculatePercentage(total, partial) {
  if (total === 0) return 0;
  return ((partial / total) * 100).toFixed(1);
}

export default { renderRelayHistory };
