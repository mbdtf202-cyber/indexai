/**
 * 性能预算：运行时两条（T5.7 · S9.7）。
 *
 * 构建期能算传输量，算不了 CLS 与长任务——那必须在真浏览器里、4 倍 CPU 降速下量。
 *
 * | 指标 | 上限 |
 * |---|---|
 * | CLS | 0.05 |
 * | 首屏渲染期间的长任务总时长 | 200 ms |
 *
 * 4 倍降速用 CDP 的 `Emulation.setCPUThrottlingRate`——Playwright 没暴露这个 API，
 * 但底层是 CDP，可以直接发命令。
 */

import { test, expect } from '@playwright/test';

/** S9.7 的两条运行时预算。 */
const BUDGET = { cls: 0.05, longTaskMs: 200 };

/** 用 CDP 把 CPU 降到四分之一。 */
async function throttle4x(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return cdp;
}

/**
 * 在页面里装测量器：累计 CLS 与长任务。
 *
 * 用 `PerformanceObserver`：CLS 是「非用户输入引起的布局偏移」之和，
 * 长任务是 > 50ms 的任务。
 */
async function installMeters(page) {
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__longTasks = [];

    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      /* 老浏览器没有 layout-shift：CLS 保持 0，另一条断言仍然有效 */
    }

    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longTasks.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* 同上 */
    }
  });
}

test.describe('性能预算（S9.7）', () => {
  test('首页：4 倍降速下 CLS ≤ 0.05 且长任务 ≤ 200ms', async ({ page }) => {
    await throttle4x(page);
    await installMeters(page);

    await page.goto('/');
    // 等首屏稳定（数据到齐、字体换完）
    await page.waitForTimeout(2500);

    const { cls, longTask } = await page.evaluate(() => ({
      cls: window.__cls || 0,
      longTask: (window.__longTasks || []).reduce((a, b) => a + b, 0),
    }));

    expect(cls, `CLS ${cls.toFixed(3)} 超预算`).toBeLessThanOrEqual(BUDGET.cls);
    expect(longTask, `长任务 ${Math.round(longTask)}ms 超预算`).toBeLessThanOrEqual(
      BUDGET.longTaskMs,
    );
  });

  test('预渲染页：CLS ≤ 0.05', async ({ page }) => {
    const res = await page.goto('/pages/models.html');
    if (!res?.ok()) {
      test.skip(true, '预渲染页面未部署');
      return;
    }

    await throttle4x(page);
    await installMeters(page);
    await page.reload();
    await page.waitForTimeout(1200);

    const cls = await page.evaluate(() => window.__cls || 0);
    expect(cls, `CLS ${cls.toFixed(3)} 超预算`).toBeLessThanOrEqual(BUDGET.cls);
  });
});
