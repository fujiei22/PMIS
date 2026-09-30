import { expect, test } from '@playwright/test'
import { clickInPage, hasMid, idle, openDashboard, openTaskDetail, pause, peakThenFall, series, trace } from './helpers/motion'

/** 選單類浮層的進出場（動畫稽核 G12）與捲動處理（G5，Task 5）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

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

    // clickInPage 回傳頁內點擊時間，closing.at 就是實際點下去的那一刻
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

for (const m of [
  { name: '選項選單', trig: '[data-card="t3"] .st', pop: '.opt-menu' },
  { name: '任務日期選擇器', trig: '[data-card="t3"] .range-main', pop: '.task-date-picker' },
  { name: '完成日期選擇器', trig: '[data-card="t3"] .pill.clickable', pop: '.issue-date-picker' },
  { name: '列動作選單', trig: '[data-rowmore="t3"]', pop: '[data-rowmenu]' },
]) {
  test(`G5 ${m.name}：捲動頁面把觸發元素帶走就關閉`, async ({ page }) => {
    await openDashboard(page)
    await page.locator(m.trig).scrollIntoViewIfNeeded()
    await page.locator(m.trig).click()
    await expect(page.locator(m.pop)).toBeVisible()
    // 滾輪落在畫面左緣的遮罩上（遮罩不能捲，捲動交給頁面）
    await page.mouse.move(5, 540)
    await page.mouse.wheel(0, 240)
    await expect(page.locator(m.pop)).toHaveCount(0)
  })
}

test('G5 點卡片選取後馬上開狀態選單：甘特的橫向補間不會把選單關掉', async ({ page }) => {
  await openDashboard(page)
  await page.locator('[data-card="t3"]').scrollIntoViewIfNeeded()
  await page.locator('[data-card="t3"] .title').click()
  await page.locator('[data-card="t3"] .st').click()
  await expect(page.locator('.opt-menu')).toBeVisible()
  await pause(page, 1200)
  await expect(page.locator('.opt-menu')).toBeVisible()
})

test('G5 點甘特列選取後馬上開「⋮」：選單維持開著', async ({ page }) => {
  await openDashboard(page)
  await page.locator('[data-rowtask="t3"] .name').click()
  await page.locator('[data-rowmore="t3"]').click()
  await expect(page.locator('[data-rowmenu]')).toBeVisible()
  await pause(page, 1200)
  await expect(page.locator('[data-rowmenu]')).toBeVisible()
})

test('G5 桌機：焦點在日期選擇器的工期輸入框時捲動頁面，觸發元素被帶走照樣關閉', async ({ page }) => {
  await openDashboard(page)
  await page.locator('[data-card="t3"] .range-main').scrollIntoViewIfNeeded()
  await page.locator('[data-card="t3"] .range-main').click()
  await page.locator('.task-date-picker input[data-dur]').focus()
  await page.evaluate(() => window.scrollBy(0, 200))
  await expect(page.locator('.task-date-picker')).toHaveCount(0)
})

// 批次 A 合併後的守衛：專案起點外移時甘特會程式捲動 .gantt-scroller，同時看板卡片依起日換位置
test('G5 從看板卡片開起訖選擇器、選一個早於專案起點的起日：選擇器仍開著', async ({ page }) => {
  await openDashboard(page)
  const trig = page.locator('[data-card="t3"] .range-main')
  await trig.scrollIntoViewIfNeeded()
  await trig.click()
  const picker = page.locator('.task-date-picker')
  await expect(picker).toBeVisible()
  // 專案起點是 t1 的 2026-08-24：往回翻到 7 月，點 7/1
  await picker.locator('.cal-arrow').first().click()
  await picker.locator('.cal-arrow').first().click()
  await expect(picker.locator('.cal-title')).toHaveText('2026年7月')
  await picker.locator('.cal-cell:not(.dim)').first().click()
  await pause(page, 1200)
  await expect(picker).toBeVisible()
})

test.describe('觸控裝置（平板橫向）', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })

  test('G5 焦點在日期選擇器的工期輸入框時捲動頁面（叫出軟鍵盤），選擇器不關', async ({ page }) => {
    await openDashboard(page)
    await page.locator('[data-card="t3"] .range-main').scrollIntoViewIfNeeded()
    await page.locator('[data-card="t3"] .range-main').click()
    await page.locator('.task-date-picker input[data-dur]').focus()
    await page.evaluate(() => window.scrollBy(0, 200))
    await pause(page, 200)
    await expect(page.locator('.task-date-picker')).toBeVisible()
  })
})
