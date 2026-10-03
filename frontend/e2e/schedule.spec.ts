import { expect, test, type Page } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'
import { OverviewPage } from './helpers/overviewPage'

/**
 * 前推排程在畫面上的樣子（規則見 docs/reference/scheduling.md）：
 * 假日標示、基準鎖（解鎖一步、原基準保留；上鎖時排程跟原基準有差異才問更新或沿用）、
 * 開始日由前置決定的條沒有左把手、假日資料載入失敗時的提示。
 * 今天固定 2026-09-18（helpers/clock.ts）；範例在 2026-08-24 上鎖，09-18 延遲的是 t3、t13。
 */

/** 甘特標題列的基準鎖按鈕。 */
function lockButton(page: Page) {
  return page.getByTestId('baseline-lock')
}

/** 確認框裡的某顆按鈕。 */
function confirmButton(app: DashboardPage, name: string) {
  return app.confirmDialog.getByRole('button', { name, exact: true })
}

/** 甘特列裡標成延遲的任務 id。 */
function delayedRows(page: Page): Promise<string[]> {
  return page
    .locator('[data-rowtask][data-status="delayed"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-rowtask') ?? ''))
}

test('假日標示：中秋（09-25）的尺規格與日底色都是非工作天，尺規格寫假日名稱', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  const ruler = page.locator('.days .day[title="中秋節"]')
  await expect(ruler).toHaveClass(/off/)
  const idx = await ruler.getAttribute('data-idx')
  await expect(page.locator(`.day-bg[data-idx="${idx}"]`)).toHaveClass(/off/)
})

/** 解鎖：一步確認，說明原基準會保留；之後不標延遲。 */
async function unlock(app: DashboardPage, page: Page) {
  await lockButton(page).click()
  await expect(app.confirmDialog).toContainText('解除基準鎖？')
  await expect(app.confirmDialog).toContainText('原本的基準會保留')
  await confirmButton(app, '解鎖').click()
  await expect(app.confirmDialog).toHaveCount(0)
  await expect(lockButton(page)).toHaveAttribute('aria-pressed', 'false')
}

test('基準鎖：解鎖（一步）後不標延遲；上鎖選「沿用原本的基準」，延遲照原計畫回來', async ({
  page,
}) => {
  const app = new DashboardPage(page)
  await app.goto()
  await expect(lockButton(page)).toHaveAttribute('aria-pressed', 'true')
  expect(await delayedRows(page)).toEqual(['t3', 't13'])

  await unlock(app, page)
  await expect(app.row('t3')).toHaveAttribute('data-status', 'doing')
  expect(await delayedRows(page)).toEqual([])

  // 上鎖：排程跟原基準有 2 個任務不同（t3、t13），問要更新還是沿用
  await lockButton(page).click()
  await expect(app.confirmDialog).toContainText('要更新計畫基準嗎？')
  await expect(app.confirmDialog).toContainText('有 2 個任務不同')
  await confirmButton(app, '沿用原本的基準').click()
  await expect(app.confirmDialog).toHaveCount(0)
  await expect(lockButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(lockButton(page)).toHaveAttribute('title', /基準鎖定於 2026\/09\/18/)
  expect(await delayedRows(page)).toEqual(['t3', 't13'])
})

test('基準鎖：上鎖選「更新基準」以當下排程為基準，延遲歸零；之後沒有差異時直接上鎖、不問', async ({
  page,
}) => {
  const app = new DashboardPage(page)
  await app.goto()
  await unlock(app, page)

  await lockButton(page).click()
  await confirmButton(app, '更新基準').click()
  await expect(app.confirmDialog).toHaveCount(0)
  await expect(lockButton(page)).toHaveAttribute('aria-pressed', 'true')
  expect(await delayedRows(page)).toEqual([])

  // 排程跟剛更新的基準一樣：按下就鎖上，不開確認框
  await unlock(app, page)
  await lockButton(page).click()
  await expect(lockButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(app.confirmDialog).toHaveCount(0)
  expect(await delayedRows(page)).toEqual([])
})

test('有前置、還沒開始的 t5：選取後沒有左把手，右把手（改工期）還在', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await app.row('t5').locator('.name').click()
  await expect(app.bar('t5')).toHaveClass(/pinned/)
  await expect(app.bar('t5').locator('.handle-l')).toHaveCount(0)
  await expect(app.bar('t5').locator('.handle-r')).toHaveCount(1)
})

test('假日資料載入失敗：標題列提示只排除週末；解鎖後不能再上鎖', async ({ page }) => {
  // 第一次進 Dashboard 就要失敗：先開總覽（mock 的 __mockApi 要等 app 載入才有），設好再點進去
  const ov = new OverviewPage(page)
  await ov.goto()
  // eslint-disable-next-line playwright/no-skipped-test -- 接上真後端時沒有 __mockApi（同 readonly.spec）
  test.skip(!(await page.evaluate(() => !!window.__mockApi)))
  await page.evaluate(() => window.__mockApi!.failNext('getCalendar'))
  await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
  await page.waitForURL('**/projects/pmis')
  await page.locator('[data-rowtask]').first().waitFor()
  const app = new DashboardPage(page)

  await expect(page.getByTestId('cal-notice')).toHaveText(
    '假日資料載入失敗，只排除週末；重新整理可重試',
  )

  // 上鎖中可以解鎖（解鎖不需要日曆）；解鎖之後上鎖鈕停用，說明為什麼
  await expect(lockButton(page)).toBeEnabled()
  await unlock(app, page)
  await expect(lockButton(page)).toBeDisabled()
  await expect(lockButton(page)).toHaveAttribute('title', '假日資料載入失敗，暫時不能上鎖')
})
