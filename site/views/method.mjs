/**
 * Method Documentation View (T5.1 Round 12) - Fixed
 */

import { truncate } from './format.js';

export function renderMethods(data) {
  const { methods = [], glossaryTerms = [] } = data || {};

  return `
    <div id="method" class="page method-page">
      ${renderHeader()}
      <main class="methods-main">
        <section class="methods-section">
          <h2>📚 Our Methodology</h2>
          ${renderMethodCards(methods)}
        </section>
        
        <section class="glossary-section">
          <h2>📖 Glossary</h2>
          ${renderGlossaryTerms(glossaryTerms)}
        </section>
      </main>
    </div>
  `;
}

function renderHeader() {
  return `<header class="page-header"><h1>📚 IndexAI Methodology</h1><p class="subtitle">Transparent methodology for AI pricing benchmarking</p></header>`;
}

function renderMethodCards(methods) {
  if (!methods || methods.length === 0) return '<p>No methodology documentation available yet.</p>';

  return `
    <div class="methods-grid">
      ${methods
        .slice(0, 5)
        .map(
          (method) => `
        <article class="method-card">
          <h3>${method.title}</h3>
          <p>${truncate(method.description || 'No description', 150)}</p>
        </article>
      `,
        )
        .join('')}
    </div>
  `;
}

function renderGlossaryTerms(terms) {
  if (!terms || terms.length === 0) return '<p>No glossary terms available yet.</p>';

  return `
    <div class="glossary-grid">
      ${terms
        .slice(0, 10)
        .map(
          (term) => `
        <article class="glossary-term">
          <h4 class="term-name">${term.term}</h4>
          <p>${truncate(term.definition || term.description, 250)}</p>
        </article>
      `,
        )
        .join('')}
    </div>
  `;
}

export default { renderMethods };
