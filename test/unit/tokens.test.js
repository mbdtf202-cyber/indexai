/**
 * 设计令牌（T5.6 · S9.5 · R4 · R11）。
 *
 * ## 三条规矩
 *
 * 1. 颜色只定义在 `tokens.css`（R4）——散在组件里，改主题要翻遍所有文件，
 *    深色模式更是直接失控。
 * 2. 每个选择器只定义一次（R11）——后一处静默覆盖前一处是最难查的样式问题。
 * 3. 深色模式只换令牌值，不写第二套组件样式。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKENS = join(ROOT, 'site', 'styles', 'tokens.css');

describe('tokens.css 存在且结构完整', () => {
  test('文件存在', () => {
    assert.ok(existsSync(TOKENS), '缺 site/styles/tokens.css');
  });

  test('花括号平衡', () => {
    const css = readFileSync(TOKENS, 'utf8');
    let depth = 0;
    for (const ch of css) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      assert.ok(depth >= 0, '出现了多余的 }');
    }
    assert.equal(depth, 0, '花括号没闭合');
  });

  test('五类令牌都有定义', () => {
    const css = readFileSync(TOKENS, 'utf8');
    for (const [label, pattern] of [
      ['颜色', /--site-bg:/],
      ['间距', /--space-md:/],
      ['字号阶梯', /--font-size-base:/],
      ['圆角', /--radius-md:/],
      ['动效时长', /--duration-fast:/],
    ]) {
      assert.match(css, pattern, `缺${label}令牌`);
    }
  });

  test('深浅两套值', () => {
    const css = readFileSync(TOKENS, 'utf8');
    assert.match(css, /data-theme=.dark./, '缺手动深色');
    assert.match(css, /prefers-color-scheme:\s*dark/, '缺跟随系统');
  });

  test('尊重 prefers-reduced-motion', () => {
    const css = readFileSync(TOKENS, 'utf8');
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
  });

  test('字号下限满足 S9.4（正文 ≥ 11px）', () => {
    const css = readFileSync(TOKENS, 'utf8');
    /* 最小的一档是 --font-size-xs: 0.6875rem = 11px */
    const m = /--font-size-xs:\s*([\d.]+)rem/.exec(css);
    assert.ok(m, '缺 --font-size-xs');
    assert.ok(Number(m[1]) >= 0.6875, `最小字号 ${m[1]}rem 低于 11px`);
  });
});

describe('R11：每个选择器只定义一次', () => {
  const cssFiles = () => {
    const dir = join(ROOT, 'site', 'styles');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));
  };

  test('单个文件内顶层选择器不重复', () => {
    const problems = [];
    for (const { name, text } of cssFiles()) {
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
      const seen = new Set();
      let depth = 0;
      let buf = '';

      for (const ch of stripped) {
        if (ch === '{') {
          const sel = buf.trim().replace(/\s+/g, ' ');
          if (depth === 0 && sel && !sel.startsWith('@')) {
            if (seen.has(sel)) problems.push(`${name}: ${sel}`);
            seen.add(sel);
          }
          depth += 1;
          buf = '';
        } else if (ch === '}') {
          depth = Math.max(0, depth - 1);
          buf = '';
        } else {
          buf += ch;
        }
      }
    }
    assert.deepEqual(problems, [], `重复定义：${problems.join(', ')}`);
  });
});

describe('R4：颜色只在 tokens.css', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  test('index.html 只剩 meta theme-color 里的两个色值', () => {
    const code = html.replace(/<meta name="theme-color"[^>]*>/g, '');
    const hits = (code.match(/#[0-9a-fA-F]{6}\b/g) || []).filter(
      (h) => !/^#[0-9a-fA-F]{8}$/.test(h),
    );
    assert.deepEqual([...new Set(hits)], [], `还有颜色字面量：${[...new Set(hits)].join(' ')}`);
  });

  test('index.html 引入 tokens.css（且不在 noscript 里）', () => {
    assert.match(html, /<link rel="stylesheet" href="\/styles\/tokens\.css">/);
    assert.equal(
      /<noscript>[^<]*<link[^>]*tokens\.css/.test(html),
      false,
      '样式表不能只在禁用 JS 时加载',
    );
  });

  test('index.html 的 <style> 标签配平', () => {
    const open = (html.match(/<style>/g) || []).length;
    const close = (html.match(/<\/style>/g) || []).length;
    assert.equal(open, close, `<style> ${open} 个，</style> ${close} 个`);
  });

  test('页面变量都引用 site- 令牌，不是字面值', () => {
    assert.match(html, /--accent:var\(--site-accent\)/);
    assert.match(html, /--bg:var\(--site-bg\)/);
  });

  test('tokens.mjs 不持有颜色字面量', () => {
    const p = join(ROOT, 'site', 'styles', 'tokens.mjs');
    if (!existsSync(p)) return;
    const src = readFileSync(p, 'utf8');
    const hits = (src.match(/#[0-9a-fA-F]{6}\b/g) || []).filter(
      (h) => !/^#[0-9a-fA-F]{8}$/.test(h),
    );
    assert.deepEqual(hits, [], 'JS 里的颜色也要在 tokens.css');
  });
});
