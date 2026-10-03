import { expect, test, type Page } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'
import { OverviewPage } from './helpers/overviewPage'

/**
 * 前推排程在畫面上的樣子（規則見 docs/reference/scheduling.md）：
 * 假日標示、計畫與延遲（PM 改了就是新計畫，不用確認）、開始日由前置決定的條沒有左把手、假日資料載入失敗時的提示。
 * 今天固定 2026-09-18（helpers/clock.ts）；09-18 延遲的是 t13（計畫 09-14 結束，推算推到今天）。
 */

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

// PM 改了就是新計畫：拉長延遲任務的工期，計畫跟著延長，延遲當場消失，不跳確認框
test('計畫：t13 延遲；PM 在列選單把工期 +1，計畫跟著改、延遲消失，不用確認', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  expect(await delayedRows(page)).toEqual(['t13'])

  await app.rowMore('t13').click()
  await app.rowMenu.locator('.rm-step', { hasText: '+1' }).click()
  await expect(app.row('t13')).toHaveAttribute('data-status', 'doing')
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

// 還沒開始的根任務，開始日可以改到今天以前：計畫照 PM 點的日子，最快今天開工，所以馬上延遲（PM 說了算，2026-10-03 定案）
test('t24 還沒開始：日期選擇器提醒，選今天以前的 09-15 就算延遲；開始顯示今天、說明行還在', async ({
  page,
}) => {
  const app = new DashboardPage(page)
  await app.goto()
  await app.row('t24').locator('.date-range').click()
  const picker = app.taskDatePicker
  await expect(picker.locator('.cal-note')).toHaveText('未開始：最快今天開工，選今天以前會算延遲')
  await picker.locator('.cal-arrow').first().click()
  await picker.locator('[data-date="2026-09-15"]').click()
  await expect(app.row('t24')).toHaveAttribute('data-status', 'delayed')
  await expect(picker.locator('.cal-end').first()).toHaveText('2026/09/18')
  await expect(picker.locator('.cal-note')).toHaveText('未開始：最快今天開工，選今天以前會算延遲')
  await expect(app.confirmDialog).toHaveCount(0)
})

test('假日資料載入失敗：標題列提示只排除週末', async ({ page }) => {
  // 第一次進 Dashboard 就要失敗：先開總覽（mock 的 __mockApi 要等 app 載入才有），設好再點進去
  const ov = new OverviewPage(page)
  await ov.goto()
  // eslint-disable-next-line playwright/no-skipped-test -- 接上真後端時沒有 __mockApi（同 readonly.spec）
  test.skip(!(await page.evaluate(() => !!window.__mockApi)))
  await page.evaluate(() => window.__mockApi!.failNext('getCalendar'))
  await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
  await page.waitForURL('**/projects/pmis')
  await page.locator('[data-rowtask]').first().waitFor()

  await expect(page.getByTestId('cal-notice')).toHaveText(
    '假日資料載入失敗，只排除週末；重新整理可重試',
  )
})
