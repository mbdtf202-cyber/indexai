/**
 * Subscription Value Calculator (T6.3)
 *
 * Interactive calculator comparing subscription plans vs pay-as-you-go pricing
 */

import { money } from '../styles/tokens.mjs';
import { compareAllPlans, parseUsageFromURL, formatNumber } from '../../lib/cost.mjs';

export function renderCalculator(data = {}) {
  const { preset, usage, result, showResults = false } = data;

  return `
    <div id="calculator" class="page calculator-page">
      ${renderHeader()}
      
      <main class="calculator-main">
        ${showResults ? renderComparison(result) : renderForm(preset)}
      </main>
    </div>
  `;
}

function renderHeader() {
  return `
    <header class="page-header">
      <h1>💰 Subscription Value Calculator</h1>
      <p class="subtitle">Compare AI subscription costs vs pay-as-you-go pricing</p>
    </header>
  `;
}

function renderForm(currentPreset) {
  return `
    <section class="calculator-form">
      <h2>Enter Your Usage</h2>
      
      <form id="usage-form" class="usage-form">
        <div class="preset-selector">
          <label>Select typical usage:</label>
          <select id="preset-select">
            <option value="">-- Choose a profile --</option>
            <option value="casual" ${currentPreset === 'casual' ? 'selected' : ''}>Casual User (10K input / 5K output tokens)</option>
            <option value="developer" ${currentPreset === 'developer' ? 'selected' : ''}>Developer (500K input / 200K output)</option>
            <option value="heavy" ${currentPreset === 'heavy' ? 'selected' : ''}>Heavy User (2M input / 1M output)</option>
          </select>
        </div>
        
        <div class="custom-input-section">
          <label>Or enter custom usage:</label>
          <div class="input-group">
            <div class="input-field">
              <label for="input-tokens">Input tokens/month</label>
              <input type="number" id="input-tokens" placeholder="e.g., 500000" min="0" step="1000"/>
            </div>
            <div class="input-field">
              <label for="output-tokens">Output tokens/month</label>
              <input type="number" id="output-tokens" placeholder="e.g., 200000" min="0" step="1000"/>
            </div>
          </div>
          <button type="submit" class="cta-button">Calculate</button>
        </div>
      </form>
      
      ${renderInfoPanel()}
    </section>
  `;
}

function renderComparison(result) {
  if (!result || !result.options) {
    return '<section class="error-message"><p>No results available. Please enter your usage above.</p></section>';
  }

  return `
    <section class="comparison-results">
      <h2>Your Best Options</h2>
      
      <div class="results-summary">
        <div class="summary-card best-option">
          <span class="badge-best">Best Choice</span>
          <h3>${result.best_option.name}</h3>
          <div class="cost">$${money(result.best_option.cost)}/month</div>
          ${
            result.savings_vs_pay_as_you_go > 0
              ? `<div class="savings-badge">Save $${money(result.savings_vs_pay_as_you_go)} vs pay-as-you-go</div>`
              : ''
          }
        </div>
      </div>
      
      <div class="options-list">
        ${result.options.map((opt, idx) => renderOptionRow(opt, idx + 1, opt.id === result.best_option.id)).join('')}
      </div>
      
      ${renderBreakEvenAnalysis(result.pei_points)}
      
      <div class="actions">
        <a href="/?preset=casual" class="cta-button">Try Different Profile</a>
        <button class="secondary-button" onclick="window.print()">Print Results</button>
      </div>
    </section>
  `;
}

function renderOptionRow(option, rank, isBest) {
  return `
    <article class="option-row ${isBest ? 'highlight' : ''} ${rank > 3 ? 'dimmed' : ''}" style="border-left-color: ${getRankColor(rank)}">
      <div class="rank">${rank}</div>
      <div class="option-info">
        <h4>${option.name}</h4>
        ${option.is_subscription ? `<span class="type-tag subscription">Subscription</span>` : `<span class="type-tag paygo">Pay-As-You-Go (${option.details?.name || 'Official'})</span>`}
        ${option.details?.monthly_price ? `<div class="details">${formatSubscriptionDetails(option.details)}</div>` : ''}
        ${
          option.details?.included_models?.length
            ? `<div class="models">${option.details.included_models
                .slice(0, 3)
                .map((m) => m.replace(/_/g, '-'))
                .join(
                  ', ',
                )}${option.details.included_models.length > 3 ? '+' + (option.details.included_models.length - 3) : ''}</div>`
            : ''
        }
      </div>
      <div class="cost-display">$${money(option.cost)}/mo</div>
    </article>
  `;
}

function formatSubscriptionDetails(details) {
  return `Monthly: $${details.monthly_price} • Free tier: ${formatNumber(details.free_tier)} tokens`;
}

function renderBreakEvenAnalysis(pei_points) {
  if (!pei_points) return '';

  return `
    <aside class="break-even-analysis">
      <h3>🎯 Break-Even Analysis</h3>
      ${Object.entries(pei_points)
        .map(([key, value]) => {
          if (key === 'description') return `<p><strong>About:</strong> ${value}</p>`;
          if (key === 'with_free_tier') {
            return `
            <div class="analysis-item">
              <h4>With Free Tier Included</h4>
              <p><strong>Free tier covers:</strong> ${formatNumber(value.effective_free_tier)} tokens</p>
              <p><strong>Break-even after free tier:</strong> ${formatNumber(value.break_even_after_free_tier)} additional tokens/month</p>
              <p class="advice">${value.advice}</p>
            </div>
          `;
          }
          return null;
        })
        .filter(Boolean)
        .join('')}
    </aside>
  `;
}

function renderInfoPanel() {
  return `
    <aside class="calculator-info">
      <h3>ℹ️ How It Works</h3>
      <ul class="info-list">
        <li><strong>Subscription:** Fixed monthly fee with included model access</li>
        <li><strong>Pay-As-You-Go:</strong> $${money(1)}/1M tokens on average, varies by channel</li>
        <li><strong>Channels:</strong> Official prices vs +15% aggregator vs +35% relay markup</li>
        <li><strong>Break-even:</strong> When subscriptions become cheaper than per-token billing</li>
      </ul>
      <p class="disclaimer">⚠️ Costs are estimates based on public pricing. Actual costs may vary.</p>
    </aside>
  `;
}

function getRankColor(rank) {
  const colors = { 1: '#22c55e', 2: '#fbbf24', 3: '#ef4444' };
  return colors[rank] || '#e2e8f0';
}

// URL query parameter parsing helper (exposed globally for routing)
if (typeof window !== 'undefined') {
  window.CalculatorUtils = {
    parseUsage: parseUsageFromURL,
  };
}

export default { renderCalculator };
