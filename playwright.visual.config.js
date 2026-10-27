/**
 * 截图对比配置（T5.5 · S9.8）。
 *
 * 只在 Playwright 官方 Linux 容器里跑：字体渲染随系统变化，macOS 生成的基线
 * 拿到 CI 上必然全红。基线由 `.github/workflows/visual.yml` 手动触发，
 * 在本机跑只当作审美评审的输入，不提交。
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;

export default defineConfig({
  testDir: './test/visual',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // 基线路径固定，不带平台后缀：只有 Linux 容器生成的基线才允许提交。
  snapshotPathTemplate: 'test/visual/__screenshots__/{arg}{ext}',
  forbidOnly: !!process.env.CI,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
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
    command: `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost node scripts/serve.js --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
