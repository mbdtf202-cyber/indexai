/**
 * Benchmark Comparison View (T5.1 Round 4)
 *
 * Pure function rendering of benchmark comparison tables
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { money, pct, kfmt, truncate } from './format.js';

/**
 * Render benchmarks page HTML
 * @param {object} data - Page data with boards, rankings, filters
 * @returns {string} Complete HTML fragment
 */
export function renderBench(data) {
  const { boards = [], selectedBoard = null, rankings = {} } = data || {};

  return `
    <div id="bench" class="page bench-page">
      ${renderHeader()}
      
      <nav class="benchmark-nav">
        <h2>Benchmark Leaderboards</h2>
        ${renderBoardTabs(boards)}
      </nav>
      
      ${selectedBoard ? renderBoardDetails(selectedBoard, rankings[selectedBoard.id]) : renderBoardSelectionPrompt()}
      
      <aside class="benchmark-info">
        ${renderInfoPanel()}
      </aside>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>📊 Model Performance Rankings</h1>
      <p class="subtitle">Compare AI models across standard benchmarks</p>
    </header>
  `;
}

function renderBoardTabs(boards) {
  if (!boards || boards.length === 0) return '';

  return boards
    .map(
      (board) => `
    <button class="board-tab ${board.selected ? 'active' : ''}" data-board-id="${board.id}">
      ${board.name}
      <span class="score-badge">${kfmt(board.avgScore)}</span>
    </button>
  `,
    )
    .join('');
}

function renderBoardDetails(board, rankings) {
  if (!rankings?.rows?.length) {
    return `<section class="board-content"><p>No ranking data available yet for ${board.name}</p></section>`;
  }

  return `
    <section class="board-content">
      <h3>${board.name}</h3>
      <div class="ranking-table-container">
        <table class="ranking-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>Score</th>
              <th>Variance</th>
              <th>Credits</th>
            </tr>
          </thead>
          <tbody>
            ${rankings.rows
              .slice(0, 50)
              .map((row, idx) => renderRankingRow(row, idx + 1))
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRankingRow(row, rank) {
  const scoreClass = getScoreClass(row.score);

  return `
    <tr>
      <td class="rank ${rank <= 3 ? 'top-three' : ''}">#${rank}</td>
      <td class="model-name">
        <strong>${truncate(row.model_name, 40)}</strong>
        ${row.org ? `<span class="org">${truncate(row.org, 15)}</span>` : ''}
      </td>
      <td class="score ${scoreClass}">${pct(row.score)}</td>
      <td class="variance">${row.variance !== null ? `${pct(row.variance)} CI` : '—'}</td>
      <td class="credits">${row.credits || 'N/A'}</td>
    </tr>
  `;
}

function getScoreClass(score) {
  if (score >= 0.9) return 'excellent';
  if (score >= 0.8) return 'very-good';
  if (score >= 0.7) return 'good';
  if (score >= 0.6) return 'decent';
  return 'needs-improvement';
}

function renderBoardSelectionPrompt() {
  return '<section class="board-content"><p>Please select a benchmark board from the tabs above.</p></section>';
}

function renderInfoPanel() {
  return `
    <aside class="info-panel">
      <h3>ℹ️ About Benchmarks</h3>
      <ul class="info-list">
        <li><strong>SWE-bench:</strong> Real GitHub issues solving capability</li>
        <li><strong>ARC-AGI:</strong> General reasoning and intelligence measure</li>
        <li><strong>Terminal-Bench:</strong> Task completion in actual terminals</li>
        <li><strong>τ²-bench:</strong> Multi-turn conversational task execution</li>
      </ul>
    </aside>
  `;
}

export default { renderBench };
