/**
 * Benchmark Loading Tests (T6.8)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('benchmark loading library', () => {
  test('loading library exists and exports correctly', async () => {
    const libPath = 'lib/benchmark-loading.mjs';

    assert.ok(fs.existsSync(libPath), `Loading library should exist at ${libPath}`);

    const loadingModule = await import('../lib/benchmark-loading.mjs');

    // Check required functions
    assert.equal(
      typeof loadingModule.fetchBenchmarkDirectory,
      'function',
      'Should export fetchBenchmarkDirectory',
    );
    assert.equal(
      typeof loadingModule.fetchSelectedBenchmark,
      'function',
      'Should export fetchSelectedBenchmark',
    );
    assert.equal(
      typeof loadingModule.sortTauBenchBySubmissionDate,
      'function',
      'Should export sortTauBenchBySubmissionDate',
    );
    assert.equal(
      typeof loadingModule.validateBenchmarkEntry,
      'function',
      'Should export validateBenchmarkEntry',
    );
    assert.equal(typeof loadingModule.computeRankings, 'function', 'Should export computeRankings');
  });

  test('tau-bench sorting works correctly', async () => {
    const { sortTauBenchBySubmissionDate } = await import('../lib/benchmark-loading.mjs');

    const testData = [
      { model: 'Model C', submission_date: '2024-01-05' },
      { model: 'Model A', submission_date: '2024-01-01' },
      { model: 'Model B', submission_date: '2024-01-10' },
    ];

    const sorted = sortTauBenchBySubmissionDate(testData);

    assert.equal(sorted[0].model, 'Model B', 'Should be sorted by newest first');
    assert.equal(sorted[sorted.length - 1].model, 'Model A', 'Oldest should be last');
  });

  test('benchmark entry validation works', async () => {
    const { validateBenchmarkEntry } = await import('../lib/benchmark-loading.mjs');

    // Valid entry
    const valid = validateBenchmarkEntry({ model_name: 'Test', score: 0.8, rank: 1 });
    assert.equal(valid.valid, true, 'Valid entry should pass');

    // Invalid entry (missing required fields)
    const invalid = validateBenchmarkEntry({ model_name: 'Test' });
    assert.equal(valid.valid, false, 'Invalid entry should fail');
    assert.ok(invalid.errors.length > 0, 'Should report errors');
  });
});

describe('benchmark loading view module', () => {
  test('benchmark view exists and exports correctly', async () => {
    const viewPath = 'site/views/benchmark-loading.mjs';

    assert.ok(fs.existsSync(viewPath), `Benchmark view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      content.includes('export function renderBenchmark'),
      'Should export renderBenchmark function',
    );
  });

  test('rendering handles lazy loading mode correctly', async () => {
    const { renderBenchmark } = await import('../site/views/benchmark-loading.mjs');

    // Test with lazy load enabled
    let html = renderBenchmark({ lazyLoad: true, directory: null });
    assert.ok(
      html.includes('Lazy Loading') || html.includes('lazy'),
      'Should show lazy loading instructions',
    );
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
