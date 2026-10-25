/**
 * Pre-render Validation Tests (T5.2 Round 3)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('pre-rendering build validation', () => {
  test('build output directory exists with pages', () => {
    const distDir = 'dist/pre-rendered';

    if (!fs.existsSync(distDir)) {
      throw new Error(`Build output directory should exist at ${distDir}`);
    }

    const files = fs.readdirSync(distDir);
    const htmlPages = files.filter((f) => f.endsWith('.html'));

    assert.ok(
      htmlPages.length >= 10,
      `Should have at least 10 HTML pages, found ${htmlPages.length}`,
    );
    console.log(`✓ Found ${htmlPages.length} pre-rendered HTML pages`);
  });

  test('lazy manifest file generated', () => {
    const manifestPath = 'dist/pre-rendered/lazy-manifest.json';

    assert.ok(fs.existsSync(manifestPath), 'Lazy manifest should be generated');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(Array.isArray(manifest.pages), 'Manifest should have pages array');
    assert.ok(manifest.version === '1.0', 'Manifest version should be 1.0');
  });
});

test.skip('golden snapshot comparison - deferred to integration phase', () => {});
