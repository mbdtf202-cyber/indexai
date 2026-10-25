/**
 * Atom Feed Generator Tests (T4.3 Round 3)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('feed generator module', () => {
  test('module file exists', () => {
    const modulePath = 'pipeline/derive/generate-feed.js';
    assert.ok(fs.existsSync(modulePath), 'Feed generator should exist');

    const content = fs.readFileSync(modulePath, 'utf8');
    assert.ok(content.includes('export'), 'Should use ES6 exports');
  });

  test('has generateAtomFeed function', async () => {
    const mod = await import('../../pipeline/derive/generate-feed.js');
    assert.equal(typeof mod.generateAtomFeed, 'function');
  });
});

test.skip('full feed generation - deferred to integration phase', () => {});
