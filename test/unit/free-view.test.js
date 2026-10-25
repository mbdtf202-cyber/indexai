/**
 * Free Tier View Tests (T5.1 Round 6)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('free tier view module structure', () => {
  test('file exists and is readable', () => {
    const modulePath = 'site/views/free.mjs';

    assert.ok(fs.existsSync(modulePath), `Free tier view should exist at ${modulePath}`);

    const content = fs.readFileSync(modulePath, 'utf8');
    assert.ok(content.length > 0, 'Module should not be empty');
    assert.ok(content.includes('export'), 'Should use ES6 exports');
  });

  test('has renderFree function', async () => {
    const mod = await import('../../site/views/free.mjs');
    assert.equal(typeof mod.renderFree, 'function', 'Should export renderFree');
  });

  test('uses formatting helpers correctly', () => {
    const modulePath = 'site/views/free.mjs';
    const content = fs.readFileSync(modulePath, 'utf8');

    // Verify imports from format helpers
    assert.ok(content.includes("from './format.js'"), 'Should import from format helpers');

    // Verify usage of formatter functions
    assert.ok(content.includes('kfmt('), 'Should use kfmt formatter for limits');
  });
});

test.skip('full HTML rendering tests - deferred to snapshot validation phase', () => {});
