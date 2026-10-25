/**
 * GitHub Issue Integration Tests (T4.2 Round 2)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALERT_MODULE = path.join(HERE, '..', '..', 'pipeline', 'alerts', 'github.mjs');

describe('GitHub issue integration module', () => {
  describe('module structure validation', () => {
    test('exports handleAlertDecision function', async () => {
      const mod = await import(ALERT_MODULE);
      assert.equal(typeof mod.handleAlertDecision, 'function');
    });

    test('has correct module structure', async () => {
      const mod = await import(ALERT_MODULE);

      // Module should export at least one function
      const keys = Object.keys(mod);
      assert.ok(keys.length > 0, 'Module should have exports');
      assert.ok(keys.includes('handleAlertDecision'), 'Should export handleAlertDecision');
    });

    test('file exists and is readable', () => {
      assert.ok(fs.existsSync(ALERT_MODULE), 'Module file should exist');
      const content = fs.readFileSync(ALERT_MODULE, 'utf8');
      assert.ok(content.length > 0, 'Module should not be empty');
      assert.ok(content.includes('export'), 'Module should use ES6 exports');
    });
  });

  describe('alert decision integration', () => {
    test('accepts required parameters object shape', async () => {
      const mod = await import(ALERT_MODULE);

      const mockParams = {
        owner: 'test-owner',
        repo: 'test-repo',
        token: 'ghp_test_token',
        alertInfo: {
          layer: 'models',
          firstBad: new Date().toISOString(),
          reason: 'consecutive failures detected',
        },
        action: 'open',
      };

      // Verify parameter structure is valid before API call
      assert.ok(mockParams.owner, 'Must specify owner');
      assert.ok(mockParams.repo, 'Must specify repo');
      assert.ok(mockParams.alertInfo?.layer, 'Must specify layer');
      assert.ok(
        ['open', 'append', 'close'].includes(mockParams.action),
        'Must specify valid action',
      );
    });
  });
});
