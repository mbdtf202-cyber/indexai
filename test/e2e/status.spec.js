/**
 * 数据质量周报（T7.3）。
 */

import { test, expect } from '@playwright/test';

test.describe('数据质量周报', () => {
  test('展示最近 8 周的门禁 / 匹配率 / 隔离率 / 标注集', async ({ page }) => {
    const res = await page.goto('/pages/status.html');
    if (!res?.ok()) test.skip(true, '状态页未部署');
    await expect(page.locator('.status-doc h2')).toContainText('数据质量周报');
    await expect(page.locator('.status-table').first()).toBeVisible();
    const headers = await page.locator('.status-table').first().locator('thead th').count();
    expect(headers).toBe(9);
    await expect(page.getByText('匹配率').first()).toBeVisible();
    await expect(page.getByText('隔离率').first()).toBeVisible();
    await expect(page.getByText('标注集').first()).toBeVisible();
  });
});
