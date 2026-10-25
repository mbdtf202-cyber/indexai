/**
 * Method Documentation View (T5.1 Round 12)
 *
 * Pure function rendering of methodology documentation page
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { truncate } from './format.js';

/**
 * Render method docs page HTML
 * @param {object} data - Page data with methodologies, definitions, glossary
 * @returns {string} Complete HTML fragment
 */
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

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>📚 IndexAI Methodology & Definitions</h1>
      <p class="subtitle">Transparent methodology for AI pricing benchmarking and analysis</p>
    </header>
  `;
}

function renderMethodCards(methods) {
  if (!methods || methods.length === 0) {
    return '<p>No methodology documentation available yet.</p>';
  }

  return `
    <div class="methods-grid">
      ${methods.map((method) => renderMethodCard(method)).join('')}
    </div>
    
    <aside class="data-note">
      <p><strong>Data Sources:</strong> All pricing data collected from official provider websites and third-party aggregators. Last updated timestamps displayed on each metric.</p>
    </aside>
  `;
}

function renderMethodCard(method) {
  return `
    <article class="method-card">
      <header class="card-header">
        <h3>${method.title}</h3>
        <span class="update-badge">${method.last_updated ? `Updated: ${method.last_updated}` : ''}</span>
      </header>
      
      <div class="method-content">
        <p class="description">${truncate(method.description || method.summary || 'No description available', 150)}</p>
        
        ${method.steps ? `<div class="steps-list"><strong>Steps:</strong> ${method.steps.join(', ')}</div>` : ''}
        
        ${method.notes ? `<div class="notes-box"><strong>Note:</strong> ${truncate(method.notes, 200)}</div>` : ''}
      </div>
      
      <footer class="card-footer">
        ${method.references ? `<a href="${method.references}" target="_blank" rel="noopener">View References →</a>` : ''}
      </footer>
    </article>
  `;
}

function renderGlossaryTerms(terms) {
  if (!terms || terms.length === 0) {
    return '<p>No glossary terms available yet.</p>';
  }

  return `
    <div class="glossary-grid">
      ${terms.map((term) => renderGlossaryTerm(term)).join('')}
    </div>
  `;
}

function renderGlossaryTerm(term) {
  return `
    <article class="glossary-term">
      <h4 class="term-name">${term.term}</h4>
      <p class="term-definition">${truncate(term.definition || term.description || 'No definition available', 250)}</p>
      ${term.example ? `<div class="term-example"><strong>Example:</strong> ${truncate(term.example, 150)}</div>` : ''}
    </article>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default { renderMethods };
