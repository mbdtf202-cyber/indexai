/**
 * Signals View Tests (T5.1 Round 11)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('signals view module structure', () => {
  test('file exists and is readable', () => {
    const modulePath = 'site/views/signals.mjs';

    assert.ok(fs.existsSync(modulePath), `Signals view should exist at ${modulePath}`);

    const content = fs.readFileSync(modulePath, 'utf8');
    assert.ok(content.length > 0, 'Module should not be empty');
    assert.ok(content.includes('export'), 'Should use ES6 exports');
  });

  test('has renderSignals function', async () => {
    const mod = await import('../../site/views/signals.mjs');
    assert.equal(typeof mod.renderSignals, 'function', 'Should export renderSignals');
  });

  test('uses formatting helpers correctly', () => {
    const modulePath = 'site/views/signals.mjs';
    const content = fs.readFileSync(modulePath, 'utf8');

    // Verify imports from format helpers
    assert.ok(content.includes("from './format.js'"), 'Should import from format helpers');

    // Verify usage of formatter functions
    assert.ok(content.includes('truncate('), 'Should use truncate formatter');
    assert.ok(content.includes('formatDate('), 'Should use formatDate formatter');
  });
});

test.skip('full HTML rendering tests - deferred to snapshot validation phase', () => {});
