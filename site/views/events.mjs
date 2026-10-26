/**
 * Events Calendar View (T5.1 Round 8) - Fixed
 */

import { truncate, formatDate } from './format.js';

const _showPast = false;

export function renderEvents(data) {
  const { events = [] } = data || {};

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
