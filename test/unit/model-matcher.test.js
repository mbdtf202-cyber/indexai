/**
 * Model Matcher Tests (T4.5)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getModelsRegistry } from '../../lib/match.mjs';

describe('model registry structure', () => {
  test('registry file exists and is valid JSON', () => {
    const registryPath = 'registry/models.json';
    assert.ok(fs.existsSync(registryPath), 'Models registry should exist');

    const content = fs.readFileSync(registryPath, 'utf8');
    const data = JSON.parse(content);

    assert.ok(Array.isArray(data.models), 'Should have models array');
    assert.ok(data.models.length >= 5, 'Should have at least 5 models');
  });

  test('models have required fields', () => {
    const registry = getModelsRegistry();

    for (const model of registry.models || []) {
      assert.ok(model.id, 'Model must have id field');
      assert.ok(model.name, 'Model must have name field');
      assert.ok(model.vendor, 'Model must have vendor field');
      assert.ok(Array.isArray(model.aliases), 'Model must have aliases array');
    }
  });
});

test.skip('full matching logic - deferred to integration phase', () => {});
