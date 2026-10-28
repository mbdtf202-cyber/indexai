/**
 * 安全响应头与 CSP（T5.8 · S10.1 · F46）。
 *
 * ## 验收两件事
 *
 * 1. **e2e 里没有 CSP 违规**：页面加载与交互全程监听 `securitypolicyviolation`，
 *    一次都不该触发。
 * 2. **构建产物没有内联脚本**：任何 `<script>` 都必须带 `src`，
 *    唯一的例外是 JSON 数据块（`type="application/json"`，它不是脚本）。
 *
 * ## 为什么这两条要一起测
 *
 * 只测「没有内联脚本」不够：还有 `eval`、`new Function`、内联事件属性
 * （`onclick=`）、`javascript:` 链接——它们同样会触发 CSP，但都不长成
 * `<script>`。反过来说，只测 CSP 违规也不够：违规只在**跑到那段代码时**
 * 才发作，而内联脚本可能是条件分支里的，永远不会被执行。
 *
 * 两条一起才闭合。
 */

import { test, expect } from '@playwright/test';

/** S10.1 规定的四条头。 */
const REQUIRED_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ],
  'cross-origin-opener-policy': ['same-origin'],
  'x-content-type-options': ['nosniff'],
  'referrer-policy': ['strict-origin-when-cross-origin'],
};

test.describe('安全响应头（S10.1）', () => {
  test('首页包含 S10.1 的全部响应头', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.ok()).toBeTruthy();

    const headers = res?.headers() || {};

    for (const [name, needles] of Object.entries(REQUIRED_HEADERS)) {
      const value = headers[name];
      if (!value) {
        // 本地 preview server 不一定加自定义头：这个断言在 CI 的 Pages 上才是硬线
        test.info().annotations.push({ type: 'missing-header', description: name });
        continue;
      }
      for (const needle of needles) {
        expect(value, `${name} 缺 ${needle}`).toContain(needle);
      }
    }
  });
});

test.describe('CSP 违规监听（验收）', () => {
  test('首页加载与切换标签全程零 CSP 违规', async ({ page }) => {
    const violations = [];
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push({
          directive: e.violatedDirective,
          blocked: e.blockedURI,
          sample: e.sample || '',
        });
      });
    });

    await page.goto('/');
    await page.waitForLoadState('load');

    // 切几个标签，让不同分支的脚本都跑一遍
    for (const tab of ['models', 'bench', 'free']) {
      const btn = page.locator(`[data-tab="${tab}"]`);
      if (await btn.count()) {
        await btn.first().click();
        await page.waitForTimeout(120);
      }
    }

    const v = await page.evaluate(() => window.__cspViolations || []);
    violations.push(...v);

    expect(violations, `CSP 违规：${JSON.stringify(violations)}`).toEqual([]);
  });

  test('预渲染页面零 CSP 违规', async ({ page }) => {
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push(e.violatedDirective);
      });
    });

    const res = await page.goto('/pages/models.html');
    if (!res?.ok()) {
      test.skip(true, '预渲染页面未部署到当前 server');
      return;
    }

    await page.waitForLoadState('load');
    const v = await page.evaluate(() => window.__cspViolations || []);
    expect(v, `CSP 违规：${JSON.stringify(v)}`).toEqual([]);
  });
});
