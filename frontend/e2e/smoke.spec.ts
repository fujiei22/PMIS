import { test, expect } from '@playwright/test'
import { setFixedTime } from './helpers/clock'

test.beforeEach(async ({ page }) => {
  await setFixedTime(page)
})

test('Dashboard 頁可開且有標題', async ({ page }) => {
  await page.goto('/projects/pmis')
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

test('首頁是所有專案總覽', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-view="overview"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '所有專案' })).toBeVisible()
})

test('Dashboard 在 /projects/:id，左上角可回總覽；打錯的網址導回總覽', async ({ page }) => {
  await page.goto('/projects/pmis')
  await expect(page.locator('[data-panel="gantt"]')).toBeVisible()
  await page.getByRole('link', { name: '所有專案' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('[data-view="overview"]')).toBeVisible()
  await page.goto('/no-such-page')
  await expect(page).toHaveURL(/\/$/)
})

test('Dashboard 開著詳細視窗時離開，回來不會自己打開', async ({ page }) => {
  await page.goto('/')
  await page.goto('/projects/pmis')
  // 開詳細視窗的方式照 e2e/detail.spec.ts 的 openTaskDetail
  await page.locator('[data-card] .caret').first().click()
  await expect(page.locator('.detail-modal')).toBeVisible()
  await page.goBack()
  await expect(page.locator('[data-view="overview"]')).toBeVisible()
  await page.goForward()
  await expect(page.locator('[data-panel="gantt"]')).toBeVisible()
  await expect(page.locator('.detail-modal')).toHaveCount(0)
})

test('總覽頁載入後有 7 張卡片', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-view-panel="cards"] [data-project]')).toHaveCount(7)
})

test('總覽頁 #timeline 直接開時間軸', async ({ page }) => {
  await page.goto('/#timeline')
  await expect(page.locator('[data-view-panel="timeline"] [data-project]')).toHaveCount(7)
})
