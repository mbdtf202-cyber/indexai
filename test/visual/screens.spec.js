/**
 * 截图回归（T5.5 · S9.8）。
 *
 * 每个标签 × 360 / 768 / 1280 × 浅色 / 深色，整页截图。
 * 基线只在 Playwright 官方 Linux 容器里生成（visual.yml），本机不提交。
 */

import { test, expect } from '@playwright/test';

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

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width}px · ${theme}`, () => {
      for (const tab of TABS) {
        test(`截图 ${tab}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          await page.addInitScript((t) => {
            try {
              localStorage.setItem('idx.theme', t);
            } catch {
              /* 隐私模式：用默认外观 */
            }
          }, theme);

          await page.goto(`/#${tab}`);
          await page.waitForFunction(
            () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
          );
          await page.waitForTimeout(300);

          await expect(page).toHaveScreenshot(`${tab}-${width}-${theme}.png`);
        });
      }
    });
  }
}
