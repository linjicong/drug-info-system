import { defineConfig } from '@playwright/test';

/**
 * usage-tracking 6A 确定性 E2E 配置
 * 前置：dev server 运行在 http://localhost:3457
 * 运行：npx playwright test --config=.specs/usage-tracking/playwright.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3457',
    headless: true,
  },
});
