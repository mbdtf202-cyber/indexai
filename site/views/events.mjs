/**
 * Events Calendar View (T5.1 Round 8) - Fixed
 */

import { truncate, formatDate } from './format.js';

const _showPast = false;

export function renderEvents(data) {
  /* filterType 曾经在模板里被引用但从未声明——预渲染一到这一页就 ReferenceError。
     从 data 里取，默认 'all'（不做筛选）。 */
  const { events = [], filterType = 'all' } = data || {};

  return `
    <div id="events" class="page events-page">
      ${renderHeader()}
      <aside class="filters-sidebar">${renderFilterControls(filterType)}</aside>
      <main class="events-main">
        ${renderUpcomingEvents(events)}
      </main>
    </div>
  `;
}

function renderHeader() {
  return `<header class="page-header"><h1>📅 AI Events & Hackathons</h1><p class="subtitle">Discover AI hackathons and meetups</p></header>`;
}

function renderFilterControls(_currentType) {
  return `<nav class="type-tabs"><button class="tab-link active">All Events</button></nav>`;
}

function renderUpcomingEvents(events) {
  if (!events || events.length === 0)
    return '<section class="no-events"><p>No upcoming events found.</p></section>';

  return `
    <section class="events-section upcoming">
      <h2>🚀 Upcoming Events</h2>
      <div class="events-calendar">
        ${events
          .slice(0, 20)
          .map(
            (event) => `
          <article class="event-card">
            <div class="date-badge">${formatDate(event.start_date)}</div>
            <h3>${truncate(event.name, 60)}</h3>
            <a href="${event.link}">Learn More →</a>
          </article>
        `,
          )
          .join('')}
      </div>
    </section>
  `;
}

export default { renderEvents };
