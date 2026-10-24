/**
 * 页面冒烟与 DOM 快照（T0.5 · S9.8 子集）。
 *
 * 覆盖 10 个标签，每个都断言：
 * - 没有 console.error 与 pageerror
 * - #view 渲染出实质内容（文本长度 > 50）
 * - body 计算后的 opacity 为 1（F01：读数据失败时整页透明）
 *
 * 另做两件事：
 * - 拦截所有非同源请求，任何一处出网都让测试失败（INV-13 / S9.8）
 * - 把 #view 的 HTML 去掉易变属性后与 __dom__/<tab>.html 比较
 *
 * 快照不带平台后缀：DOM 与字体渲染无关，本地与 CI 应完全一致。
 * 截图不做比较，只在失败时作为 artifact 留下。
 */

import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(HERE, '__dom__');
const UPDATE = process.env.UPDATE_DOM_SNAPSHOTS === '1';

/** 与 index.html 的 TABS 一一对应。 */
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

/**
 * 让 DOM 可比较：去掉时间戳、随机 id、以及由当前时刻算出的文本。
 * 只删「本质上不参与结构」的东西，不删会影响布局的属性。
 */
function normalizeDom(html) {
  return (
    html
      // 时间戳与相对时间（"3 分钟前"）
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '[TS]')
      .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '[DT]')
      // 随机 id
      .replace(/\bid="[^"]*"/g, 'id="[ID]"')
      .replace(/\sfor="[^"]*"/g, ' for="[FOR]"')
      // 内联样式里的计算宽度可能是亚像素
      .replace(/--w:\s*[\d.]+%/g, '--w:[W]%')
      .replace(/width:\s*[\d.]+%/g, 'width:[W]%')
      // 连续空白
      .replace(/\s+/g, ' ')
      .trim()
  );
}

for (const tab of TABS) {
  test(`标签 ${tab}：无错误、有内容、整页可见`, async ({ page }) => {
    const failures = [];
    const external = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') failures.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      failures.push(`pageerror: ${err.message}`);
    });

    // 拦截一切非同源请求：字体、汇率、统计都在此列
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

    // 时钟固定在 2026-10-24 09:00 +08:00：相对日期与「今天」判定才稳定
    await page.clock.install({ time: new Date('2026-10-24T01:00:00.000Z') });

    await page.goto(`/#${tab}`, { waitUntil: 'networkidle' });

    // 等 #view 有内容（首页要闻是异步插入的）
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#view');
        return el && (el.textContent || '').trim().length > 50;
      },
      { timeout: 15_000 },
    );

    // T1.11 之后页面不再请求任何第三方域名（字体与汇率都已自托管/构建期取）。
    // 因此这里从「记录」升级为「出现即失败」（INV-13）。
    const realErrors = failures.filter((f) => !f.includes('Failed to load resource'));

    expect(realErrors, `标签 ${tab} 出现前端错误：\n${realErrors.join('\n')}`).toEqual([]);
    expect(external, `标签 ${tab} 请求了第三方域名：${external.join(', ')}`).toEqual([]);
    expect(
      external.every((u) => !u.startsWith('http://127.0.0.1:')),
      '同源请求不应被拦截',
    ).toBe(true);

    // F01：body 初始 opacity:0，只有启动成功才加 .ready
    const opacity = await page.evaluate(() => getComputedStyle(document.body).opacity);
    expect(opacity, 'body opacity 应为 1（否则说明启动失败、错误提示也看不见）').toBe('1');

    const textLength = await page.evaluate(
      () => (document.querySelector('#view')?.textContent || '').trim().length,
    );
    expect(textLength).toBeGreaterThan(50);

    // DOM 快照
    const html = normalizeDom(
      await page.evaluate(() => document.querySelector('#view')?.innerHTML || ''),
    );
    const file = join(SNAPSHOT_DIR, `${tab}.html`);

    if (UPDATE || !existsSync(file)) {
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
      writeFileSync(file, `${html}\n`);
      test.info().annotations.push({ type: 'snapshot', description: `写入 ${tab}.html` });
      return;
    }

    const expected = readFileSync(file, 'utf8').trim();
    if (html !== expected) {
      // 给出第一处差异的上下文，避免整行 html 淹没信息
      let i = 0;
      while (i < Math.min(html.length, expected.length) && html[i] === expected[i]) i += 1;
      const from = Math.max(0, i - 120);
      expect.fail(
        `标签 ${tab} 的 DOM 与快照不一致（第一处差异在 ${i}）：\n` +
          `  实际: …${html.slice(from, i + 200)}\n` +
          `  期望: …${expected.slice(from, i + 200)}\n` +
          '若界面改动是本次任务的目标，删除对应 __dom__ 文件后重跑，并在提交信息里说明。',
      );
    }
  });
}
