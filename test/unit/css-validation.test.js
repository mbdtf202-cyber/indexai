/**
 * CSS & Design Tokens Tests (T5.4 Round 2)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('design tokens and CSS', () => {
  test('tokens.mjs 只做主题切换，令牌值都在 CSS', () => {
    const tokensPath = 'site/styles/tokens.mjs';

    if (!fs.existsSync(tokensPath)) {
      throw new Error(`Design tokens should exist at ${tokensPath}`);
    }

    const content = fs.readFileSync(tokensPath, 'utf8');

    /* T5.6 · R4：颜色、间距、字号、圆角的**值**全在 tokens.css。
     * JS 模块只留运行时切换主题这一件事——它不持有任何字面值。 */
    assert.ok(content.includes('setTheme'), '要有 setTheme');
    assert.ok(content.includes('getTheme'), '要有 getTheme');
    assert.ok(content.includes('toggleTheme'), '要有 toggleTheme');
    assert.equal(content.includes('colorTokens'), false, '颜色不该还在 JS 里');

    // Check theme switching functions
    assert.ok(content.includes('setTheme'), 'Should have setTheme function');
    assert.ok(content.includes('getTheme'), 'Should have getTheme function');
    assert.ok(content.includes('toggleTheme'), 'Should have toggleTheme function');
  });

  test('format helpers exist in views (separated from tokens per modular architecture)', () => {
    const formatPath = 'site/views/format.js';

    if (!fs.existsSync(formatPath)) {
      throw new Error(`Format helpers should exist at ${formatPath}`);
    }

    const content = fs.readFileSync(formatPath, 'utf8');

    // Check for formatting utilities (not in tokens - that's a separate concern)
    assert.ok(
      content.includes('kfmt') || content.includes('export.*kfmt'),
      'Should have kfmt formatter',
    );
    assert.ok(
      content.includes('money') || content.includes('export.*money'),
      'Should have money formatter',
    );
    assert.ok(
      content.includes('truncate') || content.includes('export.*truncate'),
      'Should have truncate utility',
    );
    assert.ok(
      content.includes('formatDate') || content.includes('export.*formatDate'),
      'Should have formatDate utility',
    );
  });

  /* 令牌自 T5.6 起在 tokens.css（R4 规定颜色只在那里），
   * main.css 只留组件样式。这条拆成两半查。 */
  test('tokens.css 有深浅两套令牌', () => {
    const cssPath = 'site/styles/tokens.css';
    assert.ok(fs.existsSync(cssPath), `缺 ${cssPath}`);

    const content = fs.readFileSync(cssPath, 'utf8');
    assert.ok(content.includes(':root'), '缺 :root');
    assert.ok(content.includes('--color-bg-primary'), '缺颜色令牌');
    assert.ok(content.includes(`[data-theme="dark"]`), '缺手动深色');
    assert.ok(content.includes('prefers-color-scheme: dark'), '缺跟随系统');
  });

  test('main.css 只有组件样式', () => {
    const cssPath = 'site/styles/main.css';
    assert.ok(fs.existsSync(cssPath), `缺 ${cssPath}`);

    const content = fs.readFileSync(cssPath, 'utf8');
    assert.ok(content.includes('@import'), '要引入 tokens.css，否则 var() 全空');
    assert.ok(content.includes('@media'), '要有响应式断点');
    assert.ok(content.includes('.tab-link'), '缺 tab link 样式');
    assert.ok(content.includes('.theme-toggle-btn'), '缺主题按钮样式');
    assert.equal(content.includes(':root {'), false, '令牌不该还在 main.css');
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
