/**
 * Events Calendar View (T5.1 Round 8)
 *
 * Pure function rendering of AI hackathon/meetup calendar
 * Zero global state dependencies - accepts data object as input, returns HTML string
 */

import { truncate, formatDate } from './format.js';

/**
 * Render events page HTML
 * @param {object} data - Page data with hackathons, meetups, conferences
 * @returns {string} Complete HTML fragment
 */
export function renderEvents(data) {
  const { events = [], filterType = 'all', searchQuery = '' } = data || {};

  // Filter and sort events
  const filtered = filterByType(events, filterType, searchQuery);
  const sorted = sortEvents(filtered);
  const upcoming = filterUpcoming(sorted);
  const past = filterPast(sorted);

  return `
    <div id="events" class="page events-page">
      ${renderHeader()}
      
      <aside class="filters-sidebar">
        ${renderFilterControls(filterType)}
        ${searchSection(searchQuery)}
        ${renderInfoPanel()}
      </aside>
      
      <main class="events-main">
        ${upcoming.length > 0 ? renderUpcomingEvents(upcoming) : renderNoUpcoming()}
        
        ${past.length > 0 && showPast ? renderPastEvents(past) : ''}
      </main>
    </div>
  `;
}

// Rendering helpers (all pure functions)
function renderHeader() {
  return `
    <header class="page-header">
      <h1>📅 AI Events & Hackathons</h1>
      <p class="subtitle">Discover AI hackathons, meetups, and conferences worldwide</p>
    </header>
  `;
}

function renderFilterControls(currentType) {
  return `
    <nav class="type-tabs">
      <button class="tab-link ${currentType === 'all' ? 'active' : ''}" data-type="all">All Events</button>
      <button class="tab-link ${currentType === 'hackathon' ? 'active' : ''}" data-type="hackathon">Hackathons</button>
      <button class="tab-link ${currentType === 'meetup' ? 'active' : ''}" data-type="meetup">Meetups</button>
      <button class="tab-link ${currentType === 'conference' ? 'active' : ''}" data-type="conference">Conferences</button>
    </nav>
    
    <button class="toggle-past" onclick="showPast = !showPast">
      ${showPast ? 'Hide' : 'Show'} Past Events
    </button>
  `;
}

function searchSection(currentQuery) {
  return `
    <section class="search-section">
      <input type="text" placeholder="Search events..." value="${escapeHtml(currentQuery)}" />
    </section>
  `;
}

function renderUpcomingEvents(events) {
  if (!events || events.length === 0) return '<p>No upcoming events found.</p>';

  return `
    <section class="events-section upcoming">
      <h2>🚀 Upcoming Events</h2>
      <div class="events-calendar">
        ${events
          .slice(0, 20)
          .map((event) => renderEventCard(event, true))
          .join('')}
      </div>
    </section>
  `;
}

function renderPastEvents(events) {
  if (!events || events.length === 0) return '';

  return `
    <section class="events-section past">
      <h2>🕐 Past Events</h2>
      <div class="events-calendar">
        ${events
          .slice(0, 10)
          .map((event) => renderEventCard(event, false))
          .join('')}
      </div>
    </section>
  `;
}

function renderNoUpcoming() {
  return '<section class="no-events"><p>No upcoming AI events currently scheduled. Check back later!</p></section>';
}

function renderEventCard(event, isUpcoming) {
  const dateDisplay = formatDate(event.start_date);
  const locationDisplay = formatLocation(event);
  const badges = formatEventBadges(event);

  return `
    <article class="event-card ${isUpcoming ? 'upcoming' : 'past'}" data-event-id="${event.id}">
      <header class="card-header">
        <div class="date-badge">${dateDisplay}</div>
        ${badges}
      </header>
      
      <h3>${truncate(event.name, 60)}</h3>
      
      <div class="event-details">
        <div class="location">${locationDisplay}</div>
        ${event.description ? `<p class="description">${truncate(event.description, 150)}</p>` : ''}
      </div>
      
      <div class="event-meta">
        <span class="source">From: ${formatSource(event.source)}</span>
        ${event.deadline ? `<span class="deadline">Registration: ${formatDate(event.deadline)}</span>` : ''}
        ${event.prize_pool ? `<span class="prize">💰 ${formatPrizePool(event.prize_pool)}</span>` : ''}
      </div>
      
      <footer class="card-footer">
        <a href="${event.link}" target="_blank" rel="noopener">
          Learn More →
        </a>
      </footer>
    </article>
  `;
}

function renderInfoPanel() {
  return `
    <aside class="info-panel">
      <h3>ℹ️ Event Categories</h3>
      <ul class="info-list">
        <li><strong>Hackathons:</strong> Multi-day coding competitions with prizes</li>
        <li><strong>Meetups:</strong> Local community gatherings</li>
        <li><strong>Conferences:</strong> Large-scale industry events</li>
      </ul>
      <p class="disclaimer">⚠️ Sources are third-party aggregators. Verify details on event websites.</p>
    </aside>
  `;
}

// Business logic helpers (pure functions)
function filterByType(events, typeFilter, searchQuery) {
  let result = events;

  // Type filtering
  if (typeFilter !== 'all') {
    result = result.filter((e) => e.type.toLowerCase() === typeFilter.toLowerCase());
  }

  // Search filtering
  if (searchQuery && searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    result = result.filter(
      (e) =>
        e.name?.toLowerCase().includes(query) ||
        e.description?.toLowerCase().includes(query) ||
        e.location?.toLowerCase().includes(query),
    );
  }

  return result;
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const dateA = new Date(a.start_date || '9999-12-31');
    const dateB = new Date(b.start_date || '9999-12-31');
    return dateA - dateB;
  });
}

function filterUpcoming(events) {
  const today = new Date();
  return events.filter((e) => new Date(e.start_date || '9999-12-31') >= today);
}

function filterPast(events) {
  const today = new Date();
  return events.filter((e) => new Date(e.start_date || '0000-01-01') < today);
}

function formatLocation(event) {
  if (!event.location) return '';

  const parts = [];
  if (event.city) parts.push(event.city);
  if (event.country) parts.push(event.country);
  if (event.virtual) parts.unshift('🌐 Virtual');

  return parts.join(', ');
}

function formatEventBadges(event) {
  const badges = [];

  if (event.prize_pool) badges.push('<span class="badge prize">🏆 Prize Pool</span>');
  if (event.virtual) badges.push('<span class="badge virtual">🌐 Virtual</span>');
  if (event.free_admission) badges.push('<span class="badge free">Free</span>');
  if (event.student_friendly) badges.push('<span class="badge student">🎓 Student-Friendly</span>');

  return badges.join(' ') || '';
}

function formatSource(source) {
  const sourceNames = {
    devpost: 'Devpost',
    luma: 'Luma',
    ai_hotels: 'AI Hotels',
    meetup: 'Meetup.com',
  };
  return sourceNames[source] || source;
}

function formatPrizePool(amount) {
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(0)}K`;
  return `$${Math.round(amount)}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default { renderEvents };
