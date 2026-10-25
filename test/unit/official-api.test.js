/**
 * Official API Integration Tests (T6.9)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('official API library', () => {
  test('official API library exists and exports correctly', async () => {
    const libPath = 'lib/official-api.mjs';

    assert.ok(fs.existsSync(libPath), `Official API library should exist at ${libPath}`);

    const apiModule = await import('../lib/official-api.mjs');

    // Check required functions
    assert.equal(typeof apiModule.fetchAAModels, 'function', 'Should export fetchAAModels');
    assert.equal(
      typeof apiModule.fetchOpenRouterModels,
      'function',
      'Should export fetchOpenRouterModels',
    );
    assert.equal(
      typeof apiModule.generateAttribution,
      'function',
      'Should export generateAttribution',
    );
    assert.equal(
      typeof apiModule.isOfficialApiMethod,
      'function',
      'Should export isOfficialApiMethod',
    );
  });

  test('attribution generation works correctly', async () => {
    const { generateAttribution } = await import('../lib/official-api.mjs');

    const aaAttr = generateAttribution('artificial_analysis');
    assert.ok(aaAttr.includes('Artificial Analysis'), 'Should include AA name');
    assert.ok(aaAttr.includes('CC BY 4.0'), 'Should include license');

    const orAttr = generateAttribution('openrouter');
    assert.ok(orAttr.includes('OpenRouter'), 'Should include OR name');
  });

  test('official API method detection works', async () => {
    const { isOfficialApiMethod } = await import('../lib/official-api.mjs');

    assert.equal(isOfficialApiMethod('official_api_v1'), true);
    assert.equal(isOfficialApiMethod('official_api_v2'), true);
    assert.equal(isOfficialApiMethod('scraped_html'), false);
    assert.equal(isOfficialApiMethod('rsc_fetch'), false);
  });

  test.skip('live API calls - requires network and valid credentials');
});

test.skip('integration tests deferred to e2e phase', () => {});
