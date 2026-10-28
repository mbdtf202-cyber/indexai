/**
 * Cost Calculator Tests (T6.3)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('cost calculation library', () => {
  test('cost library exists and exports correctly', async () => {
    const libPath = 'lib/cost.js';

    assert.ok(fs.existsSync(libPath), `Cost library should exist at ${libPath}`);

    const costModule = await import('../../lib/cost.js');

    // Check required functions
    assert.equal(typeof costModule.compareAllPlans, 'function', 'Should export compareAllPlans');
    assert.equal(
      typeof costModule.calculatePayAsYouGoCost,
      'function',
      'Should export calculatePayAsYouGoCost',
    );
    assert.equal(
      typeof costModule.calculateSubscriptionCost,
      'function',
      'Should export calculateSubscriptionCost',
    );
    assert.equal(
      typeof costModule.parseUsageFromURL,
      'function',
      'Should export parseUsageFromURL',
    );
  });

  test('comparison function returns valid results', async () => {
    const { compareAllPlans } = await import('../../lib/cost.js');

    // Test with simple usage
    const result = compareAllPlans({ input_tokens: 100000, output_tokens: 50000 });

    assert.ok(result.options, 'Should have options array');
    assert.ok(Array.isArray(result.options), 'Options should be array');
    assert.ok(result.options.length > 0, 'Should have at least one option');
    assert.ok(result.best_option, 'Should identify best option');
  });
});

describe('cost calculator view module', () => {
  test('calculator view exists and exports correctly', async () => {
    const viewPath = 'site/views/cost-calculator.mjs';

    assert.ok(fs.existsSync(viewPath), `Calculator view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      content.includes('export function renderCalculator'),
      'Should export renderCalculator',
    );
  });

  test('rendering handles missing data gracefully', async () => {
    const { renderCalculator } = await import('../../site/views/cost-calculator.mjs');

    // Test with no data
    let html = renderCalculator();
    assert.ok(
      html.includes('Enter Your Usage') || html.includes('calculator-form'),
      'Should show form for empty state',
    );

    // Test with partial data
    html = renderCalculator({ showResults: false });
    assert.ok(
      html.includes('preset-select') || html.includes('usage-form'),
      'Should show preset selector',
    );
  });
});
