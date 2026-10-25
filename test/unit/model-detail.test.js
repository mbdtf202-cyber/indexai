/**
 * Model Detail View Tests (T6.1 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('model detail view module', () => {
  test('model detail view exists and exports correctly', async () => {
    const viewPath = 'site/views/model-detail.mjs';

    assert.ok(fs.existsSync(viewPath), `Model detail view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(content.includes('renderModelDetail'), 'Should export renderModelDetail function');
    assert.ok(content.includes('pricing-table'), 'Should generate pricing table');
    assert.ok(content.includes('benchmark-card'), 'Should generate benchmark cards');
  });

  test('rendering handles missing data gracefully', async () => {
    const { renderModelDetail } = await import('../site/views/model-detail.mjs');

    // Test with no data
    let html = renderModelDetail();
    assert.ok(
      html.includes('not found') || html.includes('error'),
      'Should show error for missing model',
    );

    // Test with partial data
    html = renderModelDetail({ model: { name: 'Test Model' } });
    assert.ok(
      html.includes('No pricing data available') || html.includes('No benchmark data'),
      'Should handle empty arrays gracefully',
    );
  });

  test.skip('visual regression testing - deferred to e2e phase', () => {});
});
