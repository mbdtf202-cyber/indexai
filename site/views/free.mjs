/**
 * Free Tier Display View (T5.1 Round 6) - Fixed
 */

import { truncate } from './format.js';

export function renderFree(data) {
  const { offerings = [] } = data || {};

  return `
    <div id="free" class="page free-page">
      ${renderHeader()}
      <aside class="filters-sidebar">${renderInfoPanel()}</aside>
      <main class="free-main">${renderFreeGrid(offerings)}</main>
    </div>
  `;
}

function renderHeader() {
  return `<header class="page-header"><h1>🎁 Free Tiers & Trials</h1><p class="subtitle">Compare monthly free quotas and trials</p></header>`;
}

function renderInfoPanel() {
  return '<aside class="info-panel"><h4>ℹ️ Info</h4><p>Monthly free credits/quota info</p></aside>';
}

function renderFreeGrid(offerings) {
  if (!offerings || offerings.length === 0)
    return '<section class="no-results"><p>No free tiers available.</p></section>';

  return `
    <div class="free-grid">
      ${offerings
        .slice(0, 12)
        .map(
          (off) => `
        <article class="free-card">
          <h3>${truncate(off.name, 35)}</h3>
          <div class="limit-display">${off.limit ? `${off.limit}/${off.unit}` : '—'}</div>
          <a href="${off.link}" target="_blank">Get Access →</a>
        </article>
      `,
        )
        .join('')}
    </div>
  `;
}

export default { renderFree };
