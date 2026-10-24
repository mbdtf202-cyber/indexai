/**
 * 样式硬伤的可执行定义（T1.10 · F39、F40、F41 · INV-12）。
 *
 * 三件事，肉眼很难一次性查全，这里让机器逐条检查：
 * 1. 任何可见文字的计算字号 ≥ 10px（正文 ≥ 11px）；
 * 2. 深色模式下时间轴四类活动的颜色与背景对比度 ≥ 3:1（旧实现把黑客松写成
 *    #0a0a0a，与深色背景同色，那一整类活动在时间轴上直接消失）；
 * 3. 同一类卡片不能共用两个语义不同的类名（.rcard 曾同时是订阅区价卡与中转站
 *    移动卡，移动端样式互相打架）。
 */

import { test, expect } from '@playwright/test';

const WIDTHS = [360, 768, 1280];

/** 只拦非同源请求，同源放行。 */
async function blockExternal(page) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      return route.continue();
    }
    return route.abort();
  });
}

/** 打开某一页并等它渲染完成。 */
async function openTab(page, tab) {
  await page.clock.install({ time: new Date('2026-10-24T01:00:00.000Z') });
  await page.goto(`/#${tab}`);
  await page.waitForFunction(
    () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
  );
}

/**
 * 扫描所有可见文本节点的计算字号。
 * 只算「真的会显示出来」的节点：有排版盒、未隐藏、有文字。
 */
async function tinyText(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || '').trim();
      if (text.length < 2) continue;
      const el = n.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const size = Number.parseFloat(cs.fontSize);
      if (!Number.isFinite(size)) continue;
      if (size < 10) {
        out.push({
          size,
          text: text.slice(0, 28),
          cls: String(el.className || '').slice(0, 40),
          tag: el.tagName.toLowerCase(),
        });
      }
    }
    return out;
  });
}

/** 解析 #rrggbb / rgb() 到 [r,g,b]。 */
function parseColor(css) {
  const s = String(css).trim();
  const hex = s.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1];
    return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16));
  }
  const rgb = s.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    return rgb[1]
      .split(',')
      .slice(0, 3)
      .map((x) => Number.parseFloat(x.trim()));
  }
  return null;
}

/** WCAG 相对亮度与对比度。 */
function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

for (const width of WIDTHS) {
  test(`${width}px：所有可见文字不小于 10px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await blockExternal(page);

    const offenders = [];
    for (const tab of [
      'home',
      'free',
      'compare',
      'subs',
      'relays',
      'events',
      'tools',
      'bench',
      'method',
    ]) {
      await openTab(page, tab);
      const tiny = await tinyText(page);
      for (const t of tiny) offenders.push({ tab, ...t });
    }

    expect(
      offenders,
      `发现 ${offenders.length} 处小于 10px 的文字：\n${offenders
        .slice(0, 12)
        .map((o) => `  [${o.tab}] ${o.size}px ${o.tag}.${o.cls} 「${o.text}」`)
        .join('\n')}`,
    ).toEqual([]);
  });
}

test('深色模式下时间轴四类颜色都够对比（≥ 3:1）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await blockExternal(page);
  await page.clock.install({ time: new Date('2026-10-24T01:00:00.000Z') });
  await page.goto('/#events');
  await page.waitForFunction(
    () => (document.querySelector('#view')?.textContent || '').trim().length > 50,
  );
  // 用页面自己的切换按钮，确保走的是真实路径（localStorage + aria-pressed + 重画时间轴）
  await page.locator('#themeBtn').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForTimeout(120);

  const bg = parseColor(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  expect(bg, 'body 背景色应当可解析').not.toBeNull();

  const legend = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.tllegend span i')];
    return chips.map((i) => ({
      label: i.parentElement?.textContent?.trim() || '',
      bg: getComputedStyle(i).backgroundColor,
    }));
  });
  expect(legend.length, '时间轴图例应当有四类').toBeGreaterThanOrEqual(4);

  const bad = [];
  for (const l of legend) {
    const c = parseColor(l.bg);
    if (!c) {
      bad.push({ label: l.label, bg: l.bg, reason: '无法解析颜色' });
      continue;
    }
    const ratio = contrast(c, bg);
    if (ratio < 3) bad.push({ label: l.label, bg: l.bg, ratio: Number(ratio.toFixed(2)) });
  }
  expect(bad, `深色模式下对比度不足：${JSON.stringify(bad)}`).toEqual([]);
});

test('订阅区价卡与中转站移动卡不共用类名', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await blockExternal(page);

  await openTab(page, 'subs');
  const subsCards = await page.evaluate(() =>
    [...document.querySelectorAll('#view [class*="region-card"], #view .rcard')].map(
      (e) => e.className,
    ),
  );

  await openTab(page, 'relays');
  const relayCards = await page.evaluate(() =>
    [...document.querySelectorAll('#view [class*="relay-card"], #view .rcard')].map(
      (e) => e.className,
    ),
  );

  const shared = subsCards.filter((c) => relayCards.includes(c));
  expect(
    shared,
    `两个页面共用了同一个类名：${JSON.stringify([...new Set(shared)])}（F39：样式互相打架）`,
  ).toEqual([]);
});

/**
 * 360 宽度下的 DOM 快照（T1.10 步骤 5）。
 *
 * 小屏是最容易被样式改动悄悄弄坏的地方（F39 的两个 .rcard 就是在这里互相打架的）。
 * 与 smoke.spec.js 同样做「去掉易变属性后逐字比较」，快照放 __dom__/narrow-<tab>.html。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(HERE, '__dom__');
const UPDATE = process.env.UPDATE_DOM_SNAPSHOTS === '1';

function normalizeDom(html) {
  return html
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '[TS]')
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '[DT]')
    .replace(/\bid="[^"]*"/g, 'id="[ID]"')
    .replace(/\sfor="[^"]*"/g, ' for="[FOR]"')
    .replace(/--w:\s*[\d.]+%/g, '--w:[W]%')
    .replace(/width:\s*[\d.]+%/g, 'width:[W]%')
    .replace(/\s+/g, ' ')
    .trim();
}

for (const tab of ['subs', 'relays']) {
  test(`360px DOM 快照：${tab}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await blockExternal(page);
    await openTab(page, tab);

    const html = normalizeDom(
      await page.evaluate(() => document.querySelector('#view')?.innerHTML || ''),
    );
    const file = join(SNAPSHOT_DIR, `narrow-${tab}.html`);

    if (UPDATE || !existsSync(file)) {
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
      writeFileSync(file, `${html}\n`);
      return;
    }

    const expected = readFileSync(file, 'utf8').trim();
    if (html !== expected) {
      let i = 0;
      while (i < Math.min(html.length, expected.length) && html[i] === expected[i]) i += 1;
      const from = Math.max(0, i - 100);
      expect.fail(
        `${tab} 的 360px DOM 与快照不一致（第一处差异在 ${i}）：\n` +
          `  实际: …${html.slice(from, i + 180)}\n` +
          `  期望: …${expected.slice(from, i + 180)}\n` +
          '若小屏改动是本次任务的目标，删除对应 narrow-*.html 后重跑，并在提交信息里说明。',
      );
    }
  });
}
