import { test, expect } from '@playwright/test'
import { setFixedTime } from './helpers/clock'

test.beforeEach(async ({ page }) => {
  await setFixedTime(page)
})

test('首頁可開且有標題', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Project' })).toBeVisible()
  // S3 起頂部列與看板頭各有一份任務計數，取第一個
  await expect(page.getByTestId('task-count').first()).toHaveText('共 30 個任務')
})

test('legacy 頁可離線載入', async ({ page }) => {
  // 擋掉所有外部請求，確保 React / Babel 真的來自 legacy/vendor/ 而不是 CDN。
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort())

  await page.goto('/legacy/Dashboard.html')
  await expect(page.locator('[data-rowtask]')).toHaveCount(30, { timeout: 15000 })
})
