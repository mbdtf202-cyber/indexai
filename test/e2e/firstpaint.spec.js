/**
 * 首屏可见与首页解耦（T1.1 · F01、F21 · INV-12）。
 *
 * 三条失败路径都不能让页面停在透明状态，且各自要说出发生了什么：
 * - `data.json` 返回 500：必须看得见错误文案；
 * - 禁用 JS：必须看得见 `<noscript>` 文案；
 * - `news-archive.json` 被阻断：价格分布叙事照样出现，不靠情报归档。
 *
 * 首页 CLS 也要在预算内（S9.7 的上限是 0.05）：
 * 归档（约 2.3k 条）晚到只能填充要闻区，不能把整页推下去。
 *
 * 注意：Playwright 的 `toBeVisible` 把 `opacity:0` 当作可见（AGENTS.md 的坑），
 * 所以这里一律断言计算样式。
 */

import { test, expect } from '@playwright/test';

/** 固定时钟：相对日期与「今天」判定才稳定（与 smoke.spec.js 一致）。 */
const FIXED_NOW = new Date('2026-10-24T01:00:00.000Z');

/**
 * 只拦截非同源请求，同源放行。
 * 返回被拦下的非同源 URL，便于把 INV-13 的现状记进 annotation。
 */
async function blockExternal(page) {
  const external = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const sameOrigin = url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:');
    if (!sameOrigin) {
      external.push(url);
      await route.abort();
      return;
    }
    await route.continue();
  });
  return external;
}

/** body 计算后的 opacity 必须是 1，否则说明停在透明状态。 */
async function expectBodyOpaque(page) {
  const opacity = await page.evaluate(() => getComputedStyle(document.body).opacity);
  expect(opacity, 'body opacity 应为 1，页面不应停在透明状态').toBe('1');
}

test('data.json 返回 500：错误文案可见且整页不透明', async ({ page }) => {
  await blockExternal(page);
  await page.route('**/data.json', (route) => route.fulfill({ status: 500, body: 'boom' }));

  await page.clock.install({ time: FIXED_NOW });
  await page.goto('/#home');

  const hint = page.getByText('读不到 data.json');
  await expect(hint).toBeVisible();
  await expectBodyOpaque(page);

  // 错误文案不能靠 JS 才能看见：启动失败的分支同样要加 .ready
  const hintOpacity = await hint.evaluate((el) => {
    // 累乘到 body：任何一级祖先透明，文字都实际不可见
    let node = el;
    let product = 1;
    while (node && node.nodeType === 1) {
      product *= Number(getComputedStyle(node).opacity);
      node = node.parentElement;
    }
    return product;
  });
  expect(hintOpacity, '错误文案实际可见（祖先链上的 opacity 乘积为 1）').toBe(1);
});

test('禁用 JS：noscript 文案可见且整页不透明', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('/#home');
    // 坑：JS 关闭时 Chromium 把 <noscript> 的内容当作文本节点而非元素，
    // Playwright 的 getByText 按可访问文本匹配，看不到它。用 CSS 选择器 +
    // 几何 + 文本双重确认「人眼确实看得见」。
    const hint = page.locator('noscript .empty');
    await expect(hint).toHaveCount(1);
    await expect(hint).toHaveText(/这个页面需要 JavaScript 渲染数据/);
    const box = await hint.boundingBox();
    expect(box, 'noscript 文案应有可见的排版盒').not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    await expectBodyOpaque(page);

    // 首屏真的画出来了：主内容区不是空白
    const viewText = await page.evaluate(() =>
      (document.querySelector('#view')?.textContent || '').trim(),
    );
    expect(viewText, '没有 JS 时也要有可读的提示，不能只剩一个加载转圈').not.toMatch(
      /正在读取 data\.json/,
    );
  } finally {
    await context.close();
  }
});

test('news-archive.json 被阻断：价格分布叙事照样出现', async ({ page }) => {
  await blockExternal(page);
  await page.route('**/news-archive.json', (route) => route.abort());

  await page.clock.install({ time: FIXED_NOW });
  await page.goto('/#home');

  // F21：价格叙事原来包在 news.length ? … : "" 里，归档失败就永不出现
  await expect(page.locator('#priceAxis')).toBeVisible();
  await expect(page.locator('#priceAxis circle').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /个有价模型/ })).toBeVisible();
  await expectBodyOpaque(page);
});

test('首页 CLS ≤ 0.05：归档晚到只填充要闻区', async ({ page }) => {
  await blockExternal(page);

  // 让归档晚 400 ms 到达，模拟大文件在首屏之后才解析完
  await page.route('**/news-archive.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

  await page.clock.install({ time: FIXED_NOW });
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  await page.goto('/#home');
  await page.waitForFunction(
    () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
    { timeout: 15_000 },
  );
  // 归档到达并触发重绘后再读累计值
  await page.waitForFunction(() => document.querySelectorAll('#view .ncard').length > 0, {
    timeout: 15_000,
  });
  await page.waitForTimeout(300);

  const cls = await page.evaluate(() => window.__cls);
  console.log(`[cls] ${cls}`);
  expect(cls, '首页 CLS 超出预算 0.05').toBeLessThanOrEqual(0.05);
});
