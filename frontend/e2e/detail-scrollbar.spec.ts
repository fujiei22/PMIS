import { expect, test } from '@playwright/test'
import { hasMid, idle, openDashboard, openTaskDetail, series, trace } from './helpers/motion'

/**
 * 有實體捲軸時的詳情開關（動畫稽核 G1）。headless 預設隱藏捲軸（寬 0），15px 的橫跳量不到，
 * 所以這個檔的瀏覽器要開真捲軸；launchOptions 是 worker 層級的設定，只能寫在檔案頂層（寫在 describe 內會整檔載入失敗）。
 */
test.use({
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
  viewport: { width: 1920, height: 1080 },
})

/** 開始數 layout-shift（捲動造成的位移不算，Layout Instability API 本來就排除）。 */
async function countShifts(page: import('@playwright/test').Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __shifts: number }
    w.__shifts = 0
    new PerformanceObserver((list) => {
      w.__shifts += list.getEntries().length
    }).observe({ type: 'layout-shift' })
  })
  return () => page.evaluate(() => (window as unknown as { __shifts: number }).__shifts)
}

test('G1 開關詳情：背景不左右跳、Modal 中心 x 整段不變', async ({ page }) => {
  await openDashboard(page)
  expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth), '要有實體捲軸').toBeGreaterThan(0)
  const shifts = await countShifts(page)
  const me = page.locator('.top-bar .me')
  const x0 = (await me.boundingBox())!.x

  await openTaskDetail(page, 't3')
  expect((await me.boundingBox())!.x, '開著時頂欄右側不動').toBe(x0)

  const tr = await trace(page, { modal: '.detail-modal' }, () => page.locator('.detail-close').click())
  const cxs = series(tr, 'modal').map((b) => b.cx)
  expect(cxs.length).toBeGreaterThan(2)
  expect(Math.max(...cxs) - Math.min(...cxs), '關閉動畫期間 Modal 中心 x').toBeLessThanOrEqual(0.5)

  await expect(page.locator('.detail-modal')).toHaveCount(0)
  await idle(page)
  expect((await me.boundingBox())!.x, '關閉後頂欄右側不動').toBe(x0)
  expect(await shifts(), 'layout-shift 筆數').toBe(0)
})

test('詳情內刪任務：確認框淡出期間中心 x 不變，全部關完後 body 解鎖、不留補寬', async ({ page }) => {
  await openDashboard(page)
  await openTaskDetail(page, 't3')
  await page.locator('.delete-task').click()
  await page.locator('.confirm-dialog .btn-next').click()
  await expect(page.locator('.confirm-dialog .btn-danger')).toBeVisible()
  await idle(page)
  const tr = await trace(page, { box: '.confirm-dialog' }, () =>
    page.evaluate(() => (document.querySelector('.confirm-dialog .btn-danger') as HTMLElement).click()),
  )
  const s = series(tr, 'box')
  expect(hasMid(s.filter((b) => b.t > tr.at).map((b) => b.o)), '確認框有淡出').toBe(true)
  expect(Math.max(...s.map((b) => b.cx)) - Math.min(...s.map((b) => b.cx)), '確認框中心 x').toBeLessThanOrEqual(0.5)
  await expect(page.locator('.detail-modal')).toHaveCount(0)
  await idle(page)
  expect(await page.evaluate(() => [document.body.style.overflow, document.body.style.paddingRight])).toEqual(['', ''])
})
