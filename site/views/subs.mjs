/**
 * Subscription Pricing View (T5.1 Round 5)
 * 
 * Pure function rendering of subscription comparison tables
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { money, pct, kfmt } from './format.js';

/**
 * Render subscription page HTML
 * @param {object} data - Page data with plans, vendors, regions
 * @returns {string} Complete HTML fragment
 */
export function renderSubs(data) {
  const { products = [], selectedVendor = null, sortBy = 'cny', sortOrder = 'asc' } = data || {};
  
  // Group and sort by vendor/product
  const groupedProducts = groupByVendor(products);
  const sortedGroups = sortBy === 'cny' ? sortProductsByCny(groupedProducts, sortOrder) : groupedProducts;
  
  return `
    <div id="subs" class="page subs-page">
      ${renderHeader()}
      
      <aside class="vendors-sidebar">
        ${renderVendorTabs(selectedVendor)}
      </aside>
      
      <main class="plans-main">
        ${selectedVendor 
          ? renderSelectedVendorPlans(selectedVendor, filteredAndSortedPlans(groupedProducts[selectedVendor], sortBy, sortOrder))
          : renderAllVendorsOverview(groupedProducts)}
      </main>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>💳 Subscription Pricing</h1>
      <p class="subtitle">Compare official monthly/yearly subscription prices across all AI providers</p>
    </header>
  `;
}

function renderVendorTabs(selectedVendor) {
  return `
    <nav class="vendor-tabs">
      <button class="tab-link" data-vendor="chatgpt" ${selectedVendor === 'chatgpt' ? 'active' : ''}>ChatGPT Plus</button>
      <button class="tab-link" data-vendor="claude" ${selectedVendor === 'claude' ? 'active' : ''}>Claude Pro</button>
      <button class="tab-link" data-vendor="gemini" ${selectedVendor === 'gemini' ? 'active' : ''}>Gemini Advanced</button>
      <button class="tab-link" data-vendor="grok" ${selectedVendor === 'grok' ? 'active' : ''}>X Premium+</button>
      <button class="tab-link" data-vendor="deepseek" ${selectedVendor === 'deepseek' ? 'active' : ''}>DeepSeek Pro</button>
    </nav>
  `;
}

function renderSelectedVendorPlans(vendor, plans) {
  if (!plans || plans.length === 0) {
    return '<section class="plans-section"><p>No subscription plans available for this provider yet.</p></section>';
  }
  
  return `
    <section class="plans-section">
      <h2>${vendor.charAt(0).toUpperCase() + vendor.slice(1)} Plans</h2>
      <div class="plans-grid">
        ${plans.map(plan => renderPlanCard(plan)).join('')}
      </div>
      ${renderRegionalComparison(plans)}
    </section>
  `;
}

function renderAllVendorsOverview(groups) {
  const vendorKeys = Object.keys(groups);
  if (vendorKeys.length === 0) return '<p>No subscription data available yet.</p>';
  
  return `
    <section class="overview-section">
      <h2>All Providers</h2>
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Monthly US ($)</th>
            <th>Yearly US ($)</th>
            <th>CNY Monthly</th>
            <th>Savings</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(groups).map(([vendor, plans]) => {
            const mainPlan = plans.find(p => p.type === 'monthly') || plans[0];
            const yearlyPlan = plans.find(p => p.type === 'yearly') || plans[0];
            return `
              <tr>
                <td><strong>${vendor}</strong></td>
                <td>$${mainPlan?.us_monthly || '—'}</td>
                <td>$${yearlyPlan?.us_yearly ? `$${yearlyPlan.us_yearly}` : '—'}</td>
                <td>¥${kfmt(mainPlan?.cny_monthly || 0)}</td>
                <td>${calculateSavings(mainPlan, yearlyPlan)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </section>
  `;
}

function renderPlanCard(plan) {
  const typeLabel = plan.type === 'monthly' ? 'Monthly' : (plan.type === 'yearly' ? 'Annual' : 'Usage');
  const savings = calculateSavings(plan);
  
  return `
    <article class="plan-card ${typeLabel.toLowerCase()}" data-plan-id="${plan.id}">
      <header class="plan-header">
        <h3>${plan.name}</h3>
        <span class="plan-type">${typeLabel}</span>
      </header>
      
      <div class="plan-pricing">
        <div class="price-main">$${money(plan.us_monthly || plan.us_yearly, '$')}</div>
        ${plan.period ? `<div class="period">/ ${plan.period}</div>` : ''}
        ${plan.features ? `<ul class="features-list">${plan.features.join('<li>')</li></ul>` : ''}
      </div>
      
      ${savings !== 'N/A' ? `
        <div class="savings-badge">
          💰 Save ${pct(savings)} yearly
        </div>
      ` : ''}
      
      <footer class="plan-footer">
        <a href="${plan.link}" class="cta-button" target="_blank" rel="noopener">
          Go to Provider →
        </a>
        <div class="regions">Available in ${plan.regions?.length || 0} regions</div>
      </footer>
    </article>
  `;
}

function renderRegionalComparison(plans) {
  if (!plans || plans.length < 2) return '';
  
  const regionalPrices = collectRegionalPrices(plans);
  
  return `
    <section class="regional-comparison">
      <h3>🌍 Regional Price Comparison</h3>
      <table class="regional-table">
        <thead>
          <tr>
            <th>Region</th>
            <th>CNY</th>
            <th>vs US Base</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(regionalPrices).sort(([,a], [,b]) => a - b).map(([region, price]) => `
            <tr>
              <td>${region}</td>
              <td>¥${kfmt(price)}</td>
              <td class="${getPriceChangeClass(price)}">${getPriceChangeText(price)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  `;
}

// Business logic helpers (pure functions)
function groupByVendor(products) {
  const groups = {};
  for (const product of products) {
    const vendor = product.vendor_id || 'unknown';
    if (!groups[vendor]) groups[vendor] = [];
    groups[vendor].push(product);
  }
  return groups;
}

function sortProductsByCny(groups, order) {
  return Object.entries(groups).map(([vendor, plans]) => ({
    vendor,
    plans: [...plans].sort((a, b) => {
      const diff = (a.cny_monthly || 0) - (b.cny_monthly || 0);
      return order === 'desc' ? -diff : diff;
    })
  })).sort(([_, a], [__ , b]) => (a[0]?.cny_monthly || 0) - (b[0]?.cny_monthly || 0));
}

function filteredAndSortedPlans(vendorPlans, sortBy, sortOrder) {
  return vendorPlans.sort((a, b) => {
    const valA = a[sortBy] || 0;
    const valB = b[sortBy] || 0;
    return sortOrder === 'desc' ? valB - valA : valA - valB;
  });
}

function calculateSavings(plan) {
  if (!plan.us_monthly || !plan.us_yearly) return 'N/A';
  const annualCostWithoutDiscount = plan.us_monthly * 12;
  const savingsPercent = (annualCostWithoutDiscount - plan.us_yearly) / annualCostWithoutDiscount;
  return Math.round(savingsPercent * 100);
}

function collectRegionalPrices(plans) {
  const prices = {};
  for (const plan of plans) {
    if (plan.regions && Array.isArray(plan.regions)) {
      for (const region of plan.regions) {
        if (region.cny_price) {
          prices[region.country] = region.cny_price;
        }
      }
    }
  }
  return prices;
}

function getPriceChangeClass(cnyPrice) {
  if (cnyPrice >= 30) return 'higher';
  if (cnyPrice <= 20) return 'lower';
  return 'similar';
}

function getPriceChangeText(cnyPrice) {
  const usBase = 20; // ChatGPT Plus base price
  const changePct = ((cnyPrice - usBase * 7) / (usBase * 7)) * 100; // CNY vs USD*7
  
  if (changePct > 20) return `+${Math.abs(changePct).toFixed(0)}% higher`;
  if (changePct < -20) return `${Math.abs(changePct).toFixed(0)}% lower`;
  return 'Similar';
}

export default { renderSubs };
