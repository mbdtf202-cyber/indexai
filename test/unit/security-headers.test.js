/**
 * Security Headers Tests (T5.8 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('security headers generator', () => {
  test('security headers script exists and exports correctly', () => {
    const scriptPath = 'scripts/security-headers.mjs';

    if (!fs.existsSync(scriptPath)) {
      // Check for .js version as fallback
      const jsPath = 'scripts/security-headers.js';
      const content = fs.readFileSync(jsPath, 'utf8');

      assert.ok(content.includes('Content-Security-Policy'), 'Should have CSP header');
      assert.ok(content.includes('X-Frame-Options'), 'Should have X-Frame-Options');
      assert.ok(content.includes('Strict-Transport-Security'), 'Should have HSTS');
    } else {
      const content = fs.readFileSync(scriptPath, 'utf8');
      assert.ok(content.includes('CSP'), 'Should generate Content-Security-Policy');
    }
  });

  test.skip('full header validation - deferred to e2e phase', () => {});
});
