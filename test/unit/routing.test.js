/**
 * Routing System Tests (T5.3 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('router module structure', () => {
  test('router file exists and uses IIFE pattern', () => {
    const routerPath = 'site/scripts/router.mjs';

    if (!fs.existsSync(routerPath)) {
      throw new Error(`Router should exist at ${routerPath}`);
    }

    const content = fs.readFileSync(routerPath, 'utf8');
    assert.ok(content.length > 0, 'Router module should not be empty');
    assert.match(content, /\(function\s*\(\)/, 'Should use IIFE pattern (no globals)');
    assert.ok(content.includes('hashchange'), 'Should listen for hash changes');
  });

  test('app initialization exists', () => {
    const appPath = 'site/scripts/app-init.js';

    assert.ok(fs.existsSync(appPath), 'App init script should exist');

    const content = fs.readFileSync(appPath, 'utf8');
    assert.ok(content.includes('initApp'), 'Should export initialization function');
    assert.ok(content.includes('mountView'), 'Should have view mounting logic');
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
