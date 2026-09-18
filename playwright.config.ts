import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * 測試用 port。平行施工的子任務各自指定 PLAYWRIGHT_PORT，避免搶同一個 port。
 * See https://playwright.dev/docs/test-configuration.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 5174)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  /* 單一測試上限 */
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  /* CI 上誤留 test.only 直接失敗 */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    actionTimeout: 0,
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  /* 一律用 dev server，並且一律自己起一份（不沿用既有 server，避免測到舊程式） */
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
})
