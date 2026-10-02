import { expect, test, type Page } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'
import { OverviewPage } from './helpers/overviewPage'

/**
 * 前推排程在畫面上的樣子（規則見 docs/reference/scheduling.md）：
 * 假日標示、基準鎖（上鎖一步、解鎖兩步確認）、開始日由前置決定的條沒有左把手、假日資料載入失敗時的提示。
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

test('基準鎖：解鎖（兩步確認）後不再標延遲；再上鎖（一步）以當下排程為基準，延遲歸零', async ({
  page,
}) => {
  const app = new DashboardPage(page)
  await app.goto()
  await expect(lockButton(page)).toHaveAttribute('aria-pressed', 'true')
  expect(await delayedRows(page)).toEqual(['t3', 't13'])

  // 解鎖：第一步說明會不再標延遲、目前延遲幾個；第二步說明重新上鎖會覆蓋原本的基準
  await lockButton(page).click()
  await expect(app.confirmDialog).toContainText('解除基準鎖？')
  await expect(app.confirmDialog).toContainText('目前 2 個任務已延遲')
  await confirmButton(app, '繼續').click()
  await expect(app.confirmDialog).toContainText('解鎖後，下一次編輯就會把基準改成目前的排程，原本的基準無法復原。')
  await confirmButton(app, '確認解鎖').click()
  await expect(app.confirmDialog).toHaveCount(0)
  await expect(lockButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(app.row('t3')).toHaveAttribute('data-status', 'doing')
  expect(await delayedRows(page)).toEqual([])

  // 上鎖：一步就執行
  await lockButton(page).click()
  await expect(app.confirmDialog).toContainText('鎖定計畫基準？')
  await confirmButton(app, '鎖定').click()
  await expect(app.confirmDialog).toHaveCount(0)
  await expect(lockButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(lockButton(page)).toHaveAttribute('title', /基準鎖定於 2026\/09\/18/)
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

  await expect(page.getByTestId('cal-notice')).toHaveText('假日資料載入失敗，只排除週末；重新整理可重試')

  // 上鎖中可以解鎖（解鎖不需要日曆）；解鎖之後上鎖鈕停用，說明為什麼
  await expect(lockButton(page)).toBeEnabled()
  await lockButton(page).click()
  await confirmButton(app, '繼續').click()
  await confirmButton(app, '確認解鎖').click()
  await expect(lockButton(page)).toBeDisabled()
  await expect(lockButton(page)).toHaveAttribute('title', '假日資料載入失敗，暫時不能上鎖')
})
