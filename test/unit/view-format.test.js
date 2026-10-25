/**
 * View Format Helpers Tests (T5.1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('format helpers module structure', () => {
  test('file exists and is readable', () => {
    const modulePath = 'site/views/format.mjs';
    const actualPath = 'site/views/format.js';

    assert.ok(fs.existsSync(actualPath), `Module should exist at ${actualPath}`);

    const content = fs.readFileSync(actualPath, 'utf8');
    assert.ok(content.length > 0, 'Module should not be empty');
    assert.ok(content.includes('export'), 'Should use ES6 exports');
  });

  test('has required formatting functions', () => {
    const modulePath = 'site/views/format.js';
    const content = fs.readFileSync(modulePath, 'utf8');

    assert.ok(content.includes('export function money'), 'Should define money formatter');
    assert.ok(content.includes('export function pct'), 'Should define percentage formatter');
    assert.ok(content.includes('export function kfmt'), 'Should define thousand formatter');
    assert.ok(content.includes('export function ctx'), 'Should define context formatter');
  });
});

test.skip('full formatting logic - deferred to view integration phase', () => {});
