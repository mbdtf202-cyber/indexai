/**
 * Subscription Pricing View (T5.1 Round 5) - Fixed
 */

import { money, kfmt } from './format.js';

export function renderSubs(data) {
  const { products = [], selectedVendor = null } = data || {};

  return `
    <div id="subs" class="page subs-page">
      ${renderHeader()}
      
      <aside class="filters-sidebar">
        ${renderFilters()}
      </aside>
      
      <main class="plans-main">
        ${
          selectedVendor
            ? renderSelectedVendorPlans(selectedVendor, filteredAndSortedPlans(products))
            : renderAllVendorsOverview(products)
        }
      </main>
    </div>
  `;
}

function renderHeader() {
  return `<header class="page-header"><h1>💳 Subscription Pricing</h1><p class="subtitle">Compare official monthly/yearly subscription prices</p></header>`;
}

function renderFilters() {
  return `
    <nav class="vendor-tabs">
      <button class="tab-link active">ChatGPT Plus</button>
      <button class="tab-link">Claude Pro</button>
      <button class="tab-link">Gemini Advanced</button>
    </nav>
  `;
}

function filteredAndSortedPlans(products) {
  return products.slice(0, 10);
}

function renderAllVendorsOverview(products) {
  if (!products || products.length === 0) return '<p>No subscription plans available.</p>';

  return `
    <table class="comparison-table">
      <thead><tr><th>Vender</th><th>Monthly US ($)</th><th>CNY Monthly</th></tr></thead>
      <tbody>${products
        .slice(0, 5)
        .map(
          (p) =>
            `<tr><td>${p.vendor}</td><td>$${money(p.us_monthly)}</td><td>¥${kfmt(p.cny_monthly)}</td></tr>`,
        )
        .join('')}</tbody>
    </table>
  `;
}

function renderSelectedVendorPlans(vendor, plans) {
  if (!plans || plans.length === 0)
    return `<section><h2>${vendor} Plans</h2><p>No plans available.</p></section>`;

  return `
    <section class="plans-section">
      <h2>${vendor} Plans</h2>
      <div class="plans-grid">
        ${plans
          .slice(0, 3)
          .map(
            (plan) => `
          <article class="plan-card">
            <h3>${plan.name}</h3>
            <div class="price">$${money(plan.us_monthly || plan.us_yearly)}</div>
          </article>
        `,
          )
          .join('')}
      </div>
    </section>
  `;
}

export default { renderSubs };
