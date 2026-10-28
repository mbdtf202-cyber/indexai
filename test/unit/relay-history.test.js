/**
 * Relay History Tests (T6.7)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('relay history library', () => {
  test('history library exists and exports correctly', async () => {
    const libPath = 'lib/relay-history.js';

    assert.ok(fs.existsSync(libPath), `History library should exist at ${libPath}`);

    const historyModule = await import('../../lib/relay-history.js');

    // Check required functions
    assert.equal(
      typeof historyModule.calculateAvailabilityRate,
      'function',
      'Should export calculateAvailabilityRate',
    );
    assert.equal(
      typeof historyModule.groupByPriceTemplate,
      'function',
      'Should export groupByPriceTemplate',
    );
    assert.equal(
      typeof historyModule.generateRelayReport,
      'function',
      'Should export generateRelayReport',
    );
    assert.equal(
      typeof historyModule.classifyPriceTemplate,
      'function',
      'Should export classifyPriceTemplate',
    );
  });

  test('availability rate calculation works correctly', async () => {
    const { calculateAvailabilityRate } = await import('../../lib/relay-history.js');

    // Test with mock data
    const mockData = [
      { timestamp: new Date(Date.now() - 86400000).toISOString(), status: 'success' },
      { timestamp: new Date(Date.now() - 172800000).toISOString(), status: 'success' },
      { timestamp: new Date(Date.now() - 259200000).toISOString(), status: 'error' },
    ];

    const availability = calculateAvailabilityRate(mockData, 30);

    assert.ok(availability.rate >= 0 && availability.rate <= 100, 'Rate should be between 0-100%');
    assert.ok(
      ['excellent', 'good', 'degraded', 'critical'].includes(availability.status),
      'Status should be valid',
    );
  });

  test('price template classification works', async () => {
    const { classifyPriceTemplate } = await import('../../lib/relay-history.js');

    // Budget tier
    const budget = classifyPriceTemplate(0.05, 0.1);
    assert.equal(budget, 'budget', 'Should classify low price as budget');

    // Standard tier
    const standard = classifyPriceTemplate(1.0, 3.0);
    assert.equal(standard, 'standard', 'Should classify medium price as standard');

    // Premium tier
    const premium = classifyPriceTemplate(15.0, 30.0);
    assert.equal(premium, 'premium', 'Should classify high price as premium');
  });
});

describe('relay history view module', () => {
  test('relay history view exists and exports correctly', async () => {
    const viewPath = 'site/views/relays-history.mjs';

    assert.ok(fs.existsSync(viewPath), `Relay history view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      content.includes('export function renderRelayHistory'),
      'Should export renderRelayHistory function',
    );
  });

  test('rendering handles missing data gracefully', async () => {
    const { renderRelayHistory } = await import('../../site/views/relays-history.mjs');

    // Test with no relays
    let html = renderRelayHistory({ relays: [] });
    assert.ok(
      html.includes('No') || html.includes('no-templates'),
      'Should handle empty relay list',
    );

    // Test with partial data
    html = renderRelayHistory({ relays: [{ name: 'Test Relay' }] });
    assert.ok(html.includes('relay') || html.includes('template'), 'Should show relay information');
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
