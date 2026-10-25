/**
 * Bench View Tests (T5.1 Round 4)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('bench view module structure', () => {
  test('file exists and is readable', () => {
    const modulePath = 'site/views/bench.mjs';

    assert.ok(fs.existsSync(modulePath), `Bench view should exist at ${modulePath}`);

    const content = fs.readFileSync(modulePath, 'utf8');
    assert.ok(content.length > 0, 'Module should not be empty');
    assert.ok(content.includes('export'), 'Should use ES6 exports');
  });

  test('has renderBench function', async () => {
    const mod = await import('../site/views/bench.mjs');
    assert.equal(typeof mod.renderBench, 'function', 'Should export renderBench');
  });

  test('uses formatting helpers correctly', () => {
    const modulePath = 'site/views/bench.mjs';
    const content = fs.readFileSync(modulePath, 'utf8');

    // Verify imports from format helpers
    assert.ok(content.includes("from './format.js'"), 'Should import from format helpers');

    // Verify usage of formatter functions
    assert.ok(content.includes('pct('), 'Should use percentage formatter');
    assert.ok(content.includes('kfmt('), 'Should use kfmt formatter');
    assert.ok(content.includes('truncate('), 'Should use truncate formatter');
  });
});

test.skip('full HTML rendering tests - deferred to snapshot validation phase', () => {});
