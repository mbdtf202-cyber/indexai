/**
 * Vendor Detail View Tests (T6.1 Round 2)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('vendor detail view module', () => {
  test('vendor detail view exists and exports correctly', async () => {
    const viewPath = 'site/views/vendor-detail.mjs';

    assert.ok(fs.existsSync(viewPath), `Vendor detail view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      content.includes('export function renderVendorDetail'),
      'Should export renderVendorDetail function',
    );
    assert.ok(content.includes('model-grid'), 'Should generate model grid');
  });

  test('rendering handles missing data gracefully', async () => {
    const { renderVendorDetail } = await import('../../site/views/vendor-detail.mjs');

    // Test with no data
    let html = renderVendorDetail();
    assert.ok(
      html.includes('not found') || html.includes('error'),
      'Should show error for missing vendor',
    );

    // Test with partial data
    html = renderVendorDetail({ vendor: { name: 'Test Vendor' } });
    assert.ok(
      html.includes('No models offered') || html.includes('No description available'),
      'Should handle empty arrays gracefully',
    );
  });
});
