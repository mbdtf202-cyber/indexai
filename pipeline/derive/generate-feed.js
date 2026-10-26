import { SITE, HOST } from './config.js';
import { nowISO } from '../../lib/clock.js';

/**
 * Generate Atom Feed from changes (T4.3 Round 3)
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const _ROOT = join(HERE, '..');

export function generateAtomFeed(events, options = {}) {
  const {
    title = 'IndexAI Changes Feed',
    subtitle = 'Latest changes in model pricing and benchmarks',
  } = options;

  const eventsXml = events
    .map((event) => {
      const summary = getEventSummary(event);
      return `  <entry>
    <title>${escapeXml(summary)}</title>
    <link href="https://github.com/indexai-index/indexai" />
    <published>${event.timestamp}</published>
    <updated>${nowISO()}</updated>
    <id>tag:${HOST},2026:${event.type}:${event.id ?? event.timestamp ?? event.title}</id>
    <summary>${escapeXml(summary)}</summary>
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(title)}</title>
  <subtitle>${escapeXml(subtitle)}</subtitle>
  <link href="${SITE.BASE_URL}/feeds/changes.xml" rel="self" />
  <link href="${SITE.BASE_URL}/" />
  <updated>${nowISO()}</updated>
  <id>tag:${HOST},2026:/feeds/changes.xml</id>
${eventsXml}
</feed>`;
}

function getEventSummary(event) {
  switch (event.type) {
    case 'model_price_increase':
      return `${escapeXml(event.name)} price increased: input ${event.changes.input.old} → ${event.changes.input.new}`;
    case 'model_new':
      return `New model released: ${escapeXml(event.name)} (${escapeXml(event.vendor)})`;
    case 'quota_new':
      return `${escapeXml(event.name)} added ${event.changes.free_quota.new} free quota units`;
    default:
      return `${escapeXml(event.type.replace('_', ' ').charAt(0).toUpperCase() + event.type.split('_').slice(1).join(' ').toLowerCase())}`;
  }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

if (process.argv[1]?.endsWith('generate-feed.js')) {
  console.log(
    'Usage: node generate-feed.js --events="path/to/events.json" --output="path/to/feed.xml"',
  );
  process.exit(0);
}

export default { generateAtomFeed };
