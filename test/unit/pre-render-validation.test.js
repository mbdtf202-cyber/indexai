/**
 * Pre-render Validation Tests (T5.2 Round 3)
 *
 * 现状（2026-10-26）：**预渲染尚未接入构建**。`site/build-preloaded.js` 存在，
 * 但 `npm run build` 不调用它，dist/ 里没有 pre-rendered/ 目录。
 * 这两个用例因此写成 todo（带任务编号 T5.2），而不是假装通过——
 * 预渲染是 M5 的任务，不属于本轮采集管线修复的范围。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('pre-rendering build validation', () => {
  test('build output directory exists with pages', { todo: 'T5.2：预渲染未接入构建' }, () => {
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

  test('lazy manifest file generated', { todo: 'T5.2：预渲染未接入构建' }, () => {
    const manifestPath = 'dist/pre-rendered/lazy-manifest.json';

    assert.ok(fs.existsSync(manifestPath), 'Lazy manifest should be generated');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(Array.isArray(manifest.pages), 'Manifest should have pages array');
    assert.ok(manifest.version === '1.0', 'Manifest version should be 1.0');
  });
});

test.skip('golden snapshot comparison - deferred to integration phase', () => {});
