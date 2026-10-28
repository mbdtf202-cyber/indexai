/**
 * 订阅渠道对比（T6.12）。
 */

import { test, expect } from '@playwright/test';

test.describe('订阅官网价（T6.12）', () => {
  test('ChatGPT / Claude / Gemini 显示官网价与证据链接', async ({ page }) => {
    await page.goto('/#subs');
    await page.waitForFunction(
      () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
    );

    await expect(page.getByText(/官网 \$20/).first()).toBeVisible();
    await expect(page.getByText('官网 同价').first()).toBeVisible();
    await expect(page.locator('a[href*="openai.com/chatgpt/pricing"]').first()).toBeVisible();
    await expect(page.locator('a[href*="anthropic.com/pricing"]').first()).toBeVisible();
    await expect(page.locator('a[href*="one.google.com/about/ai-premium"]').first()).toBeVisible();
  });
});
