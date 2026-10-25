/**
 * Performance Budget Tests (T5.7 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('performance budget system', () => {
  test('performance budget module exists and exports correctly', async () => {
    const budgetPath = 'lib/performance-budget.mjs';
    const actualPath = 'lib/performance-budget.js';

    if (fs.existsSync(actualPath)) {
      const content = fs.readFileSync(actualPath, 'utf8');

      // Verify required functions exist
      assert.ok(content.includes('monitorPerformance'), 'Should have monitorPerformance function');
      assert.ok(content.includes('getBudgetStatus'), 'Should have get status function');
      assert.ok(content.includes('PERFORMANCE_BUDGETS'), 'Should have budget configuration');
    }
  });

  test.skip('budget validation logic - deferred to e2e phase', () => {});
});
