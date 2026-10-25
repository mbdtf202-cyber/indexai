/**
 * Design Tokens Tests (T5.4 Round 1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('design tokens infrastructure', () => {
  test('tokens file exists and exports correctly', () => {
    const tokensPath = 'site/styles/tokens.mjs';

    if (!fs.existsSync(tokensPath)) {
      throw new Error(`Design tokens should exist at ${tokensPath}`);
    }

    const content = fs.readFileSync(tokensPath, 'utf8');
    assert.ok(content.includes('colorTokens'), 'Should export color tokens');
    assert.ok(content.includes('spacingTokens'), 'Should export spacing tokens');
    assert.ok(content.includes('typographyTokens'), 'Should export typography tokens');
    assert.ok(content.includes('setTheme'), 'Should have theme switching functions');
  });

  test('theme toggle component exists', () => {
    const togglePath = 'site/components/theme-toggle.mjs';

    assert.ok(fs.existsSync(togglePath), `Theme toggle should exist at ${togglePath}`);

    const content = fs.readFileSync(togglePath, 'utf8');
    assert.ok(content.includes('renderThemeToggle'), 'Should export render function');
    assert.ok(content.includes('bindThemeToggle'), 'Should export bind function');
    assert.ok(content.includes('getTheme'), 'Should use theme utilities');
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
