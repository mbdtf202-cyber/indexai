/**
 * 全矩阵 e2e（T5.5 · S9.8）。
 *
 * ## 矩阵
 *
 * 每个标签 × 360 / 768 / 1280 × 浅色 / 深色。每一项查六件事：
 *
 * 1. 控制台无错误（页面错误 + console.error）
 * 2. 无横向溢出
 * 3. axe：serious / critical 为零
 * 4. 键盘可达（Tab 能进入页面，焦点可见）
 * 5. 只请求同源
 * 6. 禁用 JS 时首屏仍有内容（S9.3）
 *
 * ## 为什么不逐个写 60 条用例
 *
 * 组合爆炸。用参数化生成：标签 × 宽度 × 主题在 `describe` 里展开，
 * 每一项是一个独立 test——失败时能立刻看出是哪个组合。
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** 与旧页面对应的标签 id（数据驱动，不是路由）。 */
const TABS = [
  'home',
  'free',
  'compare',
  'subs',
  'relays',
  'events',
  'tools',
  'bench',
  'signals',
  'method',
];

const WIDTHS = [360, 768, 1280];
const THEMES = ['light', 'dark'];

/** 打不开控制台错误的拦截：只允许这些已知噪声。 */
const IGNORED_CONSOLE = [/Failed to load resource.*news-archive\.json/];

test.describe.configure({ mode: 'parallel' });

/* ────────────────────────── 标签 × 宽度 × 主题 ────────────────────────── */

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width}px · ${theme}`, () => {
      for (const tab of TABS) {
        test(`标签 ${tab}：无错误、无溢出、无 serious/critical a11y 问题`, async ({ page }) => {
          const errors = [];
          page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
          page.on('console', (m) => {
            if (m.type() !== 'error') return;
            const text = m.text();
            if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
            errors.push(`console: ${text}`);
          });

          await page.setViewportSize({ width, height: 800 });
          await page.addInitScript((t) => {
            try {
              localStorage.setItem('idx.theme', t);
            } catch {
              /* 隐私模式：用默认外观 */
            }
          }, theme);

          await page.goto('/');
          await page.waitForLoadState('load');

          const btn = page.locator(`[data-tab="${tab}"]`);
          if (!(await btn.count())) {
            test.skip(true, `标签 ${tab} 不在当前数据里`);
            return;
          }
          await btn.first().click();
          await page.waitForTimeout(350);

          /* 1. 控制台 */
          expect(errors, errors.join('\n')).toEqual([]);

          /* 2. 横向溢出：文档宽度不该超过视口 */
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);

          /* 3. axe：只要 serious 与 critical */
          const a11y = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();

          const bad = a11y.violations.filter(
            (v) => v.impact === 'serious' || v.impact === 'critical',
          );
          expect(
            bad.map((v) => `${v.id}(${v.impact}): ${v.nodes.length} 处`),
            bad.map((v) => `${v.id}: ${v.help}`).join('\n'),
          ).toEqual([]);
        });
      }
    });
  }
}

/* ────────────────────────── 键盘与同源 ────────────────────────── */

test.describe('键盘（S9.8）', () => {
  test('Tab 能按顺序到达页面上的每个可聚焦控件，焦点始终可见', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
    );

    /* 期望集合：可见、未被 aria-hidden 排除、浏览器真的会聚焦的控件。 */
    const expected = await page.evaluate(() => {
      const sel =
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      return [...document.querySelectorAll(sel)].filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return (
          cs.visibility !== 'hidden' &&
          cs.display !== 'none' &&
          r.width > 1 &&
          r.height > 1 &&
          !el.closest('[aria-hidden="true"]')
        );
      }).length;
    });

    const seen = new Set();
    for (let i = 0; i < expected + 8; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          key: `${el.tagName}|${el.id}|${JSON.stringify(el.dataset)}|${(el.textContent || '').trim().slice(0, 24)}`,
          visible:
            (cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px') || cs.boxShadow !== 'none',
        };
      });
      if (!info) continue;
      expect(info.visible, `焦点落在 ${info.key} 上却没有可见指示`).toBe(true);
      seen.add(info.key);
    }

    expect(seen.size, `只到达 ${seen.size}/${expected} 个可聚焦控件`).toBe(expected);
  });

  test('激活筛选后焦点仍在原控件上', async ({ page }) => {
    await page.goto('/#compare');
    await page.waitForFunction(
      () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
    );

    const chip = page.locator('[data-band]').first();
    await chip.focus();
    const key = await page.evaluate(() => ({ ...document.activeElement.dataset }));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);

    const active = await page.evaluate(() => ({
      data: { ...document.activeElement.dataset },
      pressed: document.activeElement.getAttribute('aria-pressed'),
    }));
    expect(active.data).toEqual(key);
    expect(active.pressed, '按 Enter 后筛选应当生效').toBe('true');
  });

  test('模型详情可用键盘打开，Esc 关闭并归还焦点', async ({ page }) => {
    await page.goto('/#compare');
    await page.waitForFunction(
      () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
    );

    const row = page.locator('tr[data-id]').first();
    await row.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);

    await expect(page.locator('#drawer')).toHaveAttribute('data-open', '1');
    const focusedClass = await page.evaluate(() => document.activeElement?.className || '');
    expect(focusedClass).toContain('close');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await expect(page.locator('#drawer')).toHaveAttribute('data-open', '0');
    expect(await page.evaluate(() => document.activeElement?.matches?.('tr[data-id]'))).toBe(true);
  });
});

test.describe('同源（S9.8）', () => {
  test('只请求同源', async ({ page }) => {
    const foreign = [];
    page.on('request', (r) => {
      const url = r.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (!url.includes('127.0.0.1') && !url.includes('localhost')) foreign.push(url);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(foreign, `请求了外域：${foreign.join(', ')}`).toEqual([]);
  });
});

/* ────────────────────────── 禁用 JS ────────────────────────── */

test.describe('禁用 JS（S9.3）', () => {
  for (const width of [360, 1280]) {
    test(`${width}px：预渲染页不开 JS 也有内容`, async ({ browser }) => {
      const ctx = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width, height: 800 },
      });
      const page = await ctx.newPage();

      const res = await page.goto('/pages/models.html');
      if (!res?.ok()) {
        await ctx.close();
        test.skip(true, '预渲染页面未部署');
        return;
      }

      const text = await page.locator('#view').innerText();
      /* 正文要有实质内容：空壳会是 0 或几十字符 */
      expect(text.length, `正文只有 ${text.length} 字符，像是空壳`).toBeGreaterThan(200);

      await ctx.close();
    });
  }
});
