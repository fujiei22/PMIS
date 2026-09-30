import { expect, test, type Page } from '@playwright/test'
import { hasMid, idle, openDashboard, openTaskDetail, peakThenFall, series, trace } from './helpers/motion'

/** 選單類浮層的進出場（動畫稽核 G12）與捲動處理（G5，Task 5）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

/** 頁內直接點（不等 Playwright 往返），可選 ms 毫秒後再點第二個。 */
function clickInPage(page: Page, first: string, then?: { sel: string; ms: number }): Promise<void> {
  return page.evaluate(
    ({ first, then }) => {
      ;(document.querySelector(first) as HTMLElement).click()
      if (then) setTimeout(() => (document.querySelector(then.sel) as HTMLElement | null)?.click(), then.ms)
    },
    { first, then },
  )
}

const MENUS = [
  { name: '選項選單', open: '[data-card="t3"] .st', sel: '.opt-menu', mask: '.opt-mask' },
  { name: '任務日期選擇器', open: '[data-card="t3"] .range-main', sel: '.task-date-picker', mask: '.cal-mask' },
  { name: '完成日期選擇器', open: '[data-card="t3"] .pill.clickable', sel: '.issue-date-picker', mask: '.cal-mask' },
  { name: '列動作選單', open: '[data-rowmore="t3"]', sel: '[data-rowmenu]', mask: '.rm-mask' },
]

for (const m of MENUS) {
  test(`G12 ${m.name}：開關都有過渡、離場不攔點擊、快速開關不閃全亮`, async ({ page }) => {
    await openDashboard(page)
    await page.locator(m.open).scrollIntoViewIfNeeded()
    await idle(page)

    const opening = await trace(page, { pop: m.sel }, () => clickInPage(page, m.open))
    expect(hasMid(series(opening, 'pop').map((b) => b.o)), '進場有中間值').toBe(true)

    const closing = await trace(page, { pop: m.sel }, () => clickInPage(page, m.mask))
    const leaving = series(closing, 'pop').filter((b) => b.t > closing.at)
    expect(hasMid(leaving.map((b) => b.o)), '離場有中間值').toBe(true)
    expect(leaving.every((b) => b.pe === 'none'), '離場中不攔點擊').toBe(true)

    await idle(page)
    const quick = await trace(page, { pop: m.sel }, () => clickInPage(page, m.open, { sel: m.mask, ms: 60 }))
    const r = peakThenFall(series(quick, 'pop').map((b) => b.o))
    expect(r.peak, '被打斷了，最亮不到全亮').toBeLessThan(0.98)
    expect(r.rises, '過了最亮之後又變亮的幀數').toBe(0)
  })
}

for (const d of [
  { name: '留言日期下拉', trig: '.cdate-trigger', sel: '.cdate-menu' },
  { name: '留言成員下拉', trig: '.cmem-trigger', sel: '.cmem-menu' },
]) {
  test(`G12 ${d.name}：開關都有過渡`, async ({ page }) => {
    await openDashboard(page)
    await openTaskDetail(page, 't3')
    const opening = await trace(page, { pop: d.sel }, () => clickInPage(page, d.trig))
    expect(hasMid(series(opening, 'pop').map((b) => b.o)), '進場有中間值').toBe(true)
    // 再點一次觸發鈕是收合（ui.toggleDropdown）
    const closing = await trace(page, { pop: d.sel }, () => clickInPage(page, d.trig))
    expect(hasMid(series(closing, 'pop').filter((b) => b.t > closing.at).map((b) => b.o)), '離場有中間值').toBe(true)
  })
}

test('選項選單與留言成員下拉：內部捲到底不帶動頁面（overscroll-behavior: contain）', async ({ page }) => {
  await openDashboard(page)
  await page.locator('[data-card="t3"] .st').click()
  expect(await page.locator('.opt-menu').evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe('contain')
  await page.locator('.opt-mask').click()
  await openTaskDetail(page, 't3')
  await page.locator('.cmem-trigger').click()
  expect(await page.locator('.cmem-menu').evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe('contain')
})
