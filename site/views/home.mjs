/**
 * Home Page View (T5.1 Round 2) - Fixed with all helpers
 */

import { money, pct, kfmt, formatDate } from './format.js';

export function renderHome(data) {
  const {
    latestNews = [],
    recentChanges = [],
    topModels = [],
    benchmarks = [],
    stats = {},
  } = data || {};

  return `
    <div id="home" class="page">
      ${renderHero()}
      
      ${latestNews.length ? renderNewsSection(latestNews) : ''}
      ${recentChanges.length ? renderRecentChanges(recentChanges) : ''}
      
      <section class="top-models">
        <h2>🔥 Popular Models</h2>
        ${renderModelGrid(topModels)}
      </section>
      
      ${benchmarks.length ? renderBenchmarkPreview(benchmarks) : ''}
    </div>
  `;
}

function renderHero() {
  return `
    <header class="hero">
      <h1>IndexAI - Model Pricing & Benchmarks</h1>
      <p class="subtitle">Track model prices, compare benchmarks, monitor changes</p>
    </header>
  `;
}

function renderNewsSection(news) {
  if (!news || news.length === 0) return '';

  return `
    <section class="latest-news">
      <h2>Latest News</h2>
      <ul>${news.map((n) => `<li>${n.title || 'No title'} - ${formatDate(n.date)}</li>`).join('')}</ul>
    </section>
  `;
}

function renderRecentChanges(changes) {
  if (!changes || changes.length === 0) return '';

  return `
    <section class="recent-changes">
      <h2>Recent Changes</h2>
      <ul>${changes
        .slice(0, 5)
        .map((c) => `<li>${c.description || 'Change'}</li>`)
        .join('')}</ul>
    </section>
  `;
}

function renderModelGrid(models) {
  if (!models || models.length === 0) return '<p>No models available yet.</p>';

  return `
    <div class="model-grid">
      ${models
        .slice(0, 10)
        .map(
          (model) => `
        <article class="model-card">
          <h3>${model.name}</h3>
          <span class="vendor">${model.vendor}</span>
          <div class="pricing">$${money(model.input)} input / $${money(model.output)} output</div>
        </article>
      `,
        )
        .join('')}
    </div>
  `;
}

function renderBenchmarkPreview(benchmarks) {
  if (!benchmarks || benchmarks.length === 0) return '';

  return `
    <section class="benchmark-preview">
      <h2>Benchmark Leaderboards</h2>
      ${benchmarks
        .slice(0, 3)
        .map((b) => `<div><strong>${b.name}</strong>: ${pct(b.avgScore)}</div>`)
        .join('')}
    </section>
  `;
}

export default { renderHome };
