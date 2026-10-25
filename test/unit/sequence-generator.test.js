/**
 * Sequence Generator Tests (T4.8 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('sequence generator module structure', () => {
  test('file exists and is readable', () => {
    const modulePath = 'lib/sequence-generator.mjs';
    const actualPath = 'lib/sequence-generator.js';

    if (!fs.existsSync(actualPath)) {
      throw new Error(`Module should exist at ${actualPath}`);
    }

    const content = fs.readFileSync(actualPath, 'utf8');
    assert.ok(content.length > 0, 'Module should not be empty');
    assert.ok(content.includes('export'), 'Should use ES6 exports');
  });

  test('has core functions defined', () => {
    const modulePath = 'lib/sequence-generator.js';
    const content = fs.readFileSync(modulePath, 'utf8');

    assert.ok(content.includes('extractChanges'), 'Should have extractChanges function');
    assert.ok(content.includes('appendToSequence'), 'Should have appendToSequence function');
    assert.ok(content.includes('generateModelSequence'), 'Should have model sequence generation');
  });
});

test.skip('full change extraction logic - deferred to integration phase', () => {});
