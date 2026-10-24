/**
 * 比价表的排序语义（T1.9 · F18、F19、F20）。
 *
 * F18：「缓存读」与「折扣」两列共用排序键 `cache`——点「缓存读」实际按折扣率排序，
 * 而且两个表头同时显示排序箭头，读者无从判断到底按哪一列排。
 *
 * 这里直接对预渲染出来的表做断言，不点按钮也能抓到「同一个 key 用了两次」这类错误。
 */

import { test, expect } from '@playwright/test';

/** 从当前表格读出某一列（按表头文字定位）的数值。 */
async function columnValues(page, headerText) {
  return page.evaluate((text) => {
    const ths = [...document.querySelectorAll('#view thead th')];
    const idx = ths.findIndex((t) => (t.textContent || '').replace(/[▲▼]/g, '').trim() === text);
    if (idx < 0) return null;
    return [...document.querySelectorAll('#view tbody tr')].map((tr) => {
      const cell = tr.children[idx];
      if (!cell) return null;
      const raw = (cell.textContent || '').trim();
      const n = Number(raw.replace(/[^0-9.\-]/g, ''));
      return { raw, num: Number.isFinite(n) && raw !== '—' ? n : null };
    });
  }, headerText);
}

test('缓存读与折扣是两个不同的排序键', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      return route.continue();
    }
    return route.abort();
  });
  await page.clock.install({ time: new Date('2026-10-24T01:00:00.000Z') });
  await page.goto('/#compare');
  await page.waitForFunction(
    () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
  );

  const keys = await page.evaluate(() =>
    [...document.querySelectorAll('#view thead th')].map((t) => t.dataset.sort || null),
  );
  // 两列都必须有排序键，且不能是同一个
  const cacheIdx = keys.indexOf('cache');
  const dupes = keys.reduce((acc, k) => {
    if (k) acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const duplicated = Object.entries(dupes).filter(([, n]) => n > 1);
  expect(duplicated, `表头排序键重复：${JSON.stringify(duplicated)}`).toEqual([]);
  expect(keys, '缓存读列应当有独立排序键').toContain('cache_read');
  expect(cacheIdx, '「折扣」应保留 cache 键').toBeGreaterThanOrEqual(0);
});

test('点缓存读后首行是该列最小值，且只有一个表头带排序状态', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      return route.continue();
    }
    return route.abort();
  });
  await page.clock.install({ time: new Date('2026-10-24T01:00:00.000Z') });
  await page.goto('/#compare');
  await page.waitForFunction(
    () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
  );

  const header = page.locator('#view thead th[data-sort="cache_read"]');
  await header.click();
  await page.waitForTimeout(150);

  const values = await columnValues(page, '缓存读');
  expect(values, '应当能读到缓存读列').not.toBeNull();

  const nums = values.map((v) => v.num).filter((n) => n != null);
  expect(nums.length, '缓存读列应当有可比较的数值').toBeGreaterThan(2);

  const sortedOnce = [...nums].sort((a, b) => a - b);
  const isAsc = JSON.stringify(nums) === JSON.stringify(sortedOnce);
  const isDesc = JSON.stringify(nums) === JSON.stringify([...sortedOnce].reverse());
  expect(isAsc || isDesc, `缓存读列未按本列排序：${JSON.stringify(nums.slice(0, 8))}`).toBe(true);

  const sortedHeaders = await page.evaluate(
    () =>
      [...document.querySelectorAll('#view thead th')].filter(
        (t) => t.getAttribute('aria-sort') && t.getAttribute('aria-sort') !== 'none',
      ).length,
  );
  expect(sortedHeaders, '同一时刻只应有一个表头显示排序状态').toBe(1);
});

test('每个旗舰都有官方参考价，DeepSeek 也不例外', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      return route.continue();
    }
    return route.abort();
  });
  await page.clock.install({ time: new Date('2026-10-24T01:00:00.000Z') });
  await page.goto('/#relays');
  await page.waitForFunction(
    () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
  );

  // 旧实现用展示名拼正则找官方价，"DS V4.1 Flash" 永远匹配不到 DeepSeek，
  // 于是那一档永远不会画参考线（F19）。现在读 meta.flagships。
  const flagships = await page.evaluate(async () => {
    const res = await fetch('data.json');
    const d = await res.json();
    return d.meta?.flagships || [];
  });
  expect(flagships.length).toBeGreaterThanOrEqual(4);

  for (const f of flagships) {
    expect(f.input, `${f.label} 缺少官方输入价`).toBeGreaterThan(0);
    expect(f.officialEff, `${f.label} 缺少官方有效成本（参考线要用它）`).toBeGreaterThan(0);
  }
  const ds = flagships.find((f) => f.key === 'deepseekflash');
  expect(ds, 'DeepSeek 必须在旗舰清单里').toBeTruthy();
});
