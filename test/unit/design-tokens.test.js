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

    /* T5.6 · R4：令牌的值全在 tokens.css 里，JS 模块只负责切换主题。
     * 这两件事分开之后，「改颜色」只有一个地方要去。 */
    const content = fs.readFileSync(tokensPath, 'utf8');
    assert.ok(content.includes('setTheme'), '要有主题切换');
    assert.ok(content.includes('getTheme'), '要有读取当前主题');
    assert.equal(content.includes('colorTokens'), false, '颜色值不该在 JS 里');

    const cssPath = 'site/styles/tokens.css';
    assert.ok(fs.existsSync(cssPath), '令牌值要在 tokens.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.ok(css.includes('--color-bg-primary'), '要有颜色令牌');
    assert.ok(css.includes('--space-md'), '要有间距令牌');
    assert.ok(css.includes('--font-size-base'), '要有字号令牌');
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
