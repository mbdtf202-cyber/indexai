/**
 * Vendor Monitoring Tests (T6.5)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('vendor monitoring library', () => {
  test('monitoring library exists and exports correctly', async () => {
    const libPath = 'lib/vendor-monitor.js';

    assert.ok(fs.existsSync(libPath), `Monitoring library should exist at ${libPath}`);

    const monitorModule = await import('../../lib/vendor-monitor.js');

    // Check required functions
    assert.equal(
      typeof monitorModule.fetchVendorSnapshot,
      'function',
      'Should export fetchVendorSnapshot',
    );
    assert.equal(
      typeof monitorModule.compareSnapshots,
      'function',
      'Should export compareSnapshots',
    );
    assert.equal(typeof monitorModule.monitorVendors, 'function', 'Should export monitorVendors');
    assert.equal(
      typeof monitorModule.calculateHealthScore,
      'function',
      'Should export calculateHealthScore',
    );
  });

  test('snapshot comparison detects changes correctly', async () => {
    const { compareSnapshots } = await import('../../lib/vendor-monitor.js');

    const oldSnapshot = {
      vendor_id: 'test',
      status_code: 200,
      content_length: 1000,
      last_modified: '2024-01-01',
    };

    const newSnapshot = {
      vendor_id: 'test',
      status_code: 200,
      content_length: 1100, // Changed by 10%
      last_modified: '2024-01-02',
    };

    const changes = compareSnapshots(oldSnapshot, newSnapshot);

    assert.ok(changes, 'Should detect changes');
    assert.ok(changes.has_changes, 'Should have has_changes flag');
  });

  test('health score calculation works correctly', async () => {
    const { calculateHealthScore } = await import('../../lib/vendor-monitor.js');

    const results = [
      { vendor: 'openai', status: 'success' },
      { vendor: 'anthropic', status: 'success' },
      { vendor: 'google', status: 'error' },
    ];

    const health = calculateHealthScore(results);

    assert.equal(health.total_vendors, 3, 'Should count total vendors');
    assert.equal(health.successful_monitors, 2, 'Should count successful monitors');
    assert.equal(health.failed_monitors, 1, 'Should count failed monitors');
  });
});

describe('vendor monitoring view module', () => {
  test('monitoring view exists and exports correctly', async () => {
    const viewPath = 'site/views/vendor-monitor.mjs';

    assert.ok(fs.existsSync(viewPath), `Monitoring view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      content.includes('export function renderMonitor'),
      'Should export renderMonitor function',
    );
  });

  test('rendering handles missing data gracefully', async () => {
    const { renderMonitor } = await import('../../site/views/vendor-monitor.mjs');

    // Test with no data
    let html = renderMonitor();
    assert.ok(html.includes('No vendors') || html.includes('not yet'), 'Should show empty state');

    // Test with partial data
    html = renderMonitor({ vendors: [] });
    assert.ok(
      html.includes('No vendors') || html.includes('empty'),
      'Should handle empty array gracefully',
    );
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
