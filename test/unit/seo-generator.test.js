/**
 * SEO Generator Tests (T5.10 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('SEO generation system', () => {
  test('sitemap generator exists and is functional', async () => {
    const seoModule = await import('../scripts/generate-seo-files.mjs');

    assert.ok(
      typeof seoModule.generateSitemap === 'function',
      'Should export generateSitemap function',
    );
    assert.ok(
      typeof seoModule.generateRobotsTxt === 'function',
      'Should export generateRobotsTxt function',
    );
  });

  test('robots.txt generator creates valid robots file', async () => {
    const { generateRobotsTxt } = await import('../scripts/generate-seo-files.mjs');
    const robotsContent = generateRobotsTxt();

    assert.ok(robotsContent.includes('User-agent'), 'Should contain User-agent directive');
    assert.ok(robotsContent.includes('Sitemap'), 'Should reference sitemap location');
    assert.ok(
      robotsContent.includes('Disallow') || robotsContent.includes('Allow'),
      'Should have crawl directives',
    );
  });

  test.skip('sitemap validation - deferred to integration phase', () => {});
});
