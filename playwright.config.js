/**
 * Playwright 配置（T0.5 · S9.8 子集）。
 *
 * 三条硬要求：
 * - 只对 `dist/` 起服务：e2e 验证的是构建产物，不是工作区里的源文件。
 * - 只跑 Chromium：与 AGENTS.md 一致，少一份浏览器就少一份不确定性。
 * - 拦截所有非同源请求：字体、汇率、统计一律不许出网，断网时也要能跑。
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
    // 截图只作为排障 artifact，不参与比较（字体渲染随系统变化）
    screenshot: 'only-on-failure',
    trace: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],

  webServer: {
    // scripts/serve.js 只服务 dist/，并在 Host 与点文件上把关。
    // no_proxy 让 Playwright 的就绪探测走直连：断网测试时外部代理不该拦回环地址。
    command: `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost node scripts/serve.js --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
