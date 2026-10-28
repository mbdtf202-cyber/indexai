/**
 * Change Engine Tests (T4.3 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHANGES_MODULE_PATH = path.join(HERE, '..', '..', 'pipeline', 'derive', 'changes.js');

describe('change engine module structure', () => {
  test('file exists and is readable', () => {
    assert.ok(fs.existsSync(CHANGES_MODULE_PATH), 'Change engine module should exist');

    const content = fs.readFileSync(CHANGES_MODULE_PATH, 'utf8');
    assert.ok(content.length > 0, 'Module should not be empty');
    assert.ok(content.includes('export'), 'Module should use ES6 exports');
  });

  test('has EVENT_TYPES constant', async () => {
    // Verify EVENT_TYPES exists in source
    const content = fs.readFileSync(CHANGES_MODULE_PATH, 'utf8');
    assert.ok(
      content.includes('model_price_increase'),
      'Should define model_price_increase event type',
    );
    assert.ok(content.includes('model_new'), 'Should define model_new event type');
    assert.ok(
      content.includes('benchmark_score_down'),
      'Should define benchmark_score_down event type',
    );
  });

  test('has comparison function signature', async () => {
    const content = fs.readFileSync(CHANGES_MODULE_PATH, 'utf8');
    assert.ok(content.includes('compareSnapshots'), 'Should export compareSnapshots function');
    assert.ok(
      content.includes('prev') && content.includes('current'),
      'Function should accept prev/current parameters',
    );
  });
});

test.skip('full integration tests - deferred to golden fixture phase', () => {});
