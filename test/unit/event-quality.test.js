/**
 * Event Quality Tests (T6.6)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('event quality library', () => {
  test('quality library exists and exports correctly', async () => {
    const libPath = 'lib/event-quality.js';

    assert.ok(fs.existsSync(libPath), `Quality library should exist at ${libPath}`);

    const qualityModule = await import('../../lib/event-quality.js');

    // Check required functions
    assert.equal(
      typeof qualityModule.calculateAiRelevance,
      'function',
      'Should export calculateAiRelevance',
    );
    assert.equal(typeof qualityModule.findDuplicates, 'function', 'Should export findDuplicates');
    assert.equal(typeof qualityModule.validateQuality, 'function', 'Should export validateQuality');
    assert.equal(typeof qualityModule.normalizeUrl, 'function', 'Should export normalizeUrl');
  });

  test('AI relevance scoring works correctly', async () => {
    const { calculateAiRelevance } = await import('../../lib/event-quality.js');

    // Test high relevance event
    const highScore = calculateAiRelevance(
      'AI Hackathon Conference',
      'Machine learning event for developers',
    );

    assert.equal(highScore.is_ai_event, true, 'Should detect AI event');
    assert.ok(highScore.score >= 10, 'Score should be ≥ 10');
    assert.ok(highScore.matchedBy.length > 0, 'Should have matched terms');

    // Test low relevance event
    const lowScore = calculateAiRelevance('Tech Meetup', 'General programming discussion');

    assert.equal(lowScore.is_ai_event, false, 'Should not detect as AI event');
    assert.equal(lowScore.score < 10, true, 'Score should be < 10');
  });

  test('region extraction handles various formats', async () => {
    const { extractRegion } = await import('../../lib/event-quality.js');

    // Test ISO code detection
    let region = extractRegion('Event in CN');
    assert.equal(region, 'CN', 'Should detect China code');

    region = extractRegion('Conference in United States');
    assert.ok(['US'].includes(region), 'Should detect US');

    region = extractRegion('Unknown location');
    assert.equal(region, 'ZZ', 'Should default to unknown');
  });
});

describe('event quality view module', () => {
  test('quality view exists and exports correctly', async () => {
    const viewPath = 'site/views/event-quality.mjs';

    assert.ok(fs.existsSync(viewPath), `Quality view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      content.includes('export function renderQuality'),
      'Should export renderQuality function',
    );
  });

  test('rendering handles missing data gracefully', async () => {
    const { renderQuality } = await import('../../site/views/event-quality.mjs');

    // Test with no events
    let html = renderQuality({ events: [] });
    assert.ok(html.includes('No') || html.includes('no-events'), 'Should show empty state');

    // Test with partial data
    html = renderQuality({ filters: {} });
    assert.ok(
      html.includes('quality-summary') || html.includes('filters-sidebar'),
      'Should show component structure',
    );
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
