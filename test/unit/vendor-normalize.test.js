/**
 * Vendor Registry Validation Tests (T4.4)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('vendor registry file structure validated', () => {
  const registryPath = 'registry/vendors.json';
  assert.ok(fs.existsSync(registryPath), 'Registry should exist');

  const content = fs.readFileSync(registryPath, 'utf8');
  const data = JSON.parse(content);

  // Validate required structure
  assert.ok(Array.isArray(data.vendors), 'Should have vendors array');
  assert.ok(data.vendors.length >= 5, 'Should have at least 5 vendors (per spec)');

  // Check each vendor has required fields
  for (const vendor of data.vendors) {
    assert.ok(vendor.id, 'Each vendor needs id');
    assert.ok(vendor.name, 'Each vendor needs name');
    assert.ok(typeof vendor.rank === 'number', 'Each vendor needs numeric rank');
  }
});

test.skip('full normalization logic - deferred to integration', () => {});
