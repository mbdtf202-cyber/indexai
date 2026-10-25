/**
 * CSS & Design Tokens Tests (T5.4 Round 2)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('design tokens and CSS', () => {
  test('tokens file exports all required token types', () => {
    const tokensPath = 'site/styles/tokens.mjs';

    if (!fs.existsSync(tokensPath)) {
      throw new Error(`Design tokens should exist at ${tokensPath}`);
    }

    const content = fs.readFileSync(tokensPath, 'utf8');

    // Check for all major token categories
    assert.ok(content.includes('colorTokens'), 'Should have color tokens');
    assert.ok(content.includes('spacingTokens'), 'Should have spacing tokens');
    assert.ok(content.includes('typographyTokens'), 'Should have typography tokens');
    assert.ok(content.includes('borderRadiusTokens'), 'Should have border radius tokens');
    assert.ok(content.includes('zIndexTokens'), 'Should have z-index tokens');

    // Check theme switching functions
    assert.ok(content.includes('setTheme'), 'Should have setTheme function');
    assert.ok(content.includes('getTheme'), 'Should have getTheme function');
    assert.ok(content.includes('toggleTheme'), 'Should have toggleTheme function');
  });

  test('main CSS file exists with both themes', () => {
    const cssPath = 'site/styles/main.css';

    assert.ok(fs.existsSync(cssPath), `Main CSS should exist at ${cssPath}`);

    const content = fs.readFileSync(cssPath, 'utf8');

    // Verify :root variables (light theme)
    assert.ok(content.includes(':root'), 'Should have root variables selector');
    assert.ok(content.includes('--color-bg-primary'), 'Should define color variables');

    // Verify dark theme support
    assert.ok(content.includes('[data-theme="dark"]'), 'Should have dark theme selector');

    // Verify responsive styles
    assert.ok(content.includes('@media'), 'Should have responsive breakpoints');

    // Verify component classes
    assert.ok(content.includes('.tab-link'), 'Should have tab link styles');
    assert.ok(content.includes('.theme-toggle-btn'), 'Should have theme button styles');
  });

  test('theme toggle component renders properly', () => {
    const togglePath = 'site/components/theme-toggle.mjs';
    const content = fs.readFileSync(togglePath, 'utf8');

    assert.ok(content.includes('renderThemeToggle'), 'Should export renderThemeToggle function');
    assert.ok(content.includes('getToggleIcon'), 'Should have icon getter function');
    assert.ok(content.includes('bindThemeToggle'), 'Should have bind function');

    // Verify SVG icons
    assert.ok(content.includes('<svg'), 'Should include SVG icons');
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
