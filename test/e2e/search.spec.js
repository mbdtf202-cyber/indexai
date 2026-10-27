/**
 * 全站搜索与报错入口（T6.10 · D10）。
 */

import { test, expect } from '@playwright/test';

test.describe('全站搜索（T6.10）', () => {
  test('Ctrl/⌘+K 打开，键盘选择模型，Enter 打开详情', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
    );

    await page.keyboard.press('Control+K');
    await expect(page.locator('#palette')).toBeVisible();
    await expect(page.locator('#paletteInput')).toBeFocused();

    await page.locator('#paletteInput').fill('Claude Opus');
    await expect(page.locator('.palette-item').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');

    await expect(page.locator('#drawer')).toHaveAttribute('data-open', '1');
    await expect(page.locator('#drawer h2')).toContainText(/Claude/i);
  });

  test('Esc 关闭搜索并把焦点还给页面', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
    );
    await page.keyboard.press('Control+K');
    await expect(page.locator('#palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette')).toBeHidden();
  });

  test('模型详情里的报错链接带 record_id 与 report.yml 模板', async ({ page }) => {
    await page.goto('/#compare');
    await page.waitForFunction(
      () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
    );
    await page.locator('tr[data-id]').first().click();
    const link = page.locator('#drawer a.rep').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('template=report.yml');
    expect(href).toContain('record_id=');
  });
});
