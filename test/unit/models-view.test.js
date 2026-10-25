/**
 * Models View Tests (T5.1 Round 3)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('models view module structure', () => {
  test('file exists and is readable', () => {
    const modulePath = 'site/views/models.mjs';

    assert.ok(fs.existsSync(modulePath), `Models view should exist at ${modulePath}`);

    const content = fs.readFileSync(modulePath, 'utf8');
    assert.ok(content.length > 0, 'Module should not be empty');
    assert.ok(content.includes('export'), 'Should use ES6 exports');
  });

  test('has renderModels function', async () => {
    const mod = await import('../../site/views/models.mjs');
    assert.equal(typeof mod.renderModels, 'function', 'Should export renderModels');
    assert.equal(typeof mod.applySortingAndFiltering, 'function', 'Should export helper functions');
  });

  test('uses formatting helpers correctly', () => {
    const modulePath = 'site/views/models.mjs';
    const content = fs.readFileSync(modulePath, 'utf8');

    // Verify imports from format helpers
    assert.ok(content.includes("from './format.js'"), 'Should import from format helpers');

    // Verify usage of formatter functions
    assert.ok(content.includes('money('), 'Should use money formatter');
    assert.ok(content.includes('kfmt('), 'Should use kfmt formatter');
  });
});

test.skip('full HTML rendering tests - deferred to snapshot validation phase', () => {});
