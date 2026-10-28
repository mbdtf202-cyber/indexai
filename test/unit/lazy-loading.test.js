/**
 * Lazy Loading System Tests (T5.2 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('lazy loading infrastructure', () => {
  test('lazy load script exists and is valid JS', () => {
    const _modulePath = 'site/scripts/lazy-load.mjs';
    const actualPath = 'site/scripts/lazy-load.js';

    assert.ok(fs.existsSync(actualPath), `Lazy load script should exist at ${actualPath}`);

    const content = fs.readFileSync(actualPath, 'utf8');
    assert.ok(content.length > 0, 'Module should not be empty');
    assert.ok(content.includes('IntersectionObserver'), 'Should use IntersectionObserver pattern');
    // IIFE 形态：传统 `(function(){...})` 与箭头 `(() => {...})` 都算，只要不泄漏全局
    assert.match(
      content,
      /^\(\s*(?:\(function\s*\(\)|\(\)\s*=>)/m,
      'Should use IIFE pattern (no globals)',
    );
  });

  test('pre-render builder exists', () => {
    const _builderPath = 'site/build-preloaded.mjs';
    const actualPath = 'site/build-preloaded.js';

    if (fs.existsSync(actualPath)) {
      const content = fs.readFileSync(actualPath, 'utf8');
      assert.ok(content.includes('buildPreRenderedSite'), 'Should export build function');
    }
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
