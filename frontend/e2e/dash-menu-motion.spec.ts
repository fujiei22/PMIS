import { expect, test, type Locator, type Page } from '@playwright/test'
import { clickInPage, openDashboard, pause, series, trace } from './helpers/motion'

/**
 * Dashboard 頂欄的浮層（動畫稽核批次 C 的 Dashboard 部分，docs/incidents/2026-09-30-motion-audit）。
 * G19：日曆開著時點頂欄其他下拉，第一下不被吃掉；點日期膠囊切換端點時日曆不關不閃。
 * G7：下拉 / 成員面板開著勾選項讓觸發鈕變寬時，選單不被帶著跑。
 */
test.use({ viewport: { width: 1920, height: 1080 } })

/** 用真的滑鼠點元素（照實際的命中測試：被遮罩蓋住就點到遮罩；locator.click() 會一直等到點得到）。 */
async function mouseClick(
  page: Page,
  target: Locator,
  at?: { x: number; y: number },
): Promise<void> {
  const b = await target.boundingBox()
  if (!b) throw new Error('找不到要點的元素')
  await page.mouse.click(b.x + (at?.x ?? b.width / 2), b.y + (at?.y ?? b.height / 2))
}

const calendar = (page: Page): Locator => page.locator('.top-row .cal')

/** 等日曆進場過渡跑完（pop-enter-* 的 class 拿掉）。 */
async function calendarSettled(page: Page): Promise<void> {
  await calendar(page).waitFor()
  await expect(calendar(page)).not.toHaveClass(/pop-enter/)
}

/** 從「日期」下拉選日期模式；選完日曆會自動打開。 */
async function openCalendar(page: Page, mode: '大於' | '介於'): Promise<void> {
  await page.locator('.top-row .dd-trigger', { hasText: '日期' }).click()
  await page.locator('.top-row .dd-item', { hasText: mode }).click()
  await calendarSettled(page)
}

/** 開始數日曆「離場」的次數：.cal 被加上 pop-leave-* 或被移除（關了又重開也算）。 */
async function countCalendarLeaves(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __calLeaves: number }
    w.__calLeaves = 0
    const isCal = (n: Node): boolean => n instanceof Element && n.classList.contains('cal')
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (
          r.type === 'attributes' &&
          isCal(r.target) &&
          (r.target as Element).className.includes('pop-leave')
        )
          w.__calLeaves++
        if (r.type === 'childList') for (const n of r.removedNodes) if (isCal(n)) w.__calLeaves++
      }
    }).observe(document.querySelector('.top-row')!, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  })
  return () => page.evaluate(() => (window as unknown as { __calLeaves: number }).__calLeaves)
}

test('G19 日曆開著時點頂欄「狀態」下拉：第一下就打開，日曆收起', async ({ page }) => {
  await openDashboard(page)
  await openCalendar(page, '大於')
  await mouseClick(page, page.locator('.top-row .dd-trigger').first())
  await expect(
    page.locator('.top-row .dd').first().locator('.dd-menu'),
    '狀態下拉打開了',
  ).toBeVisible()
  await expect(calendar(page), '日曆收起').toHaveCount(0)
})

test('G19 「介於」日曆開著時點另一顆日期膠囊：日曆不關不閃，改填另一端', async ({ page }) => {
  await openDashboard(page)
  await openCalendar(page, '介於')
  const ends = calendar(page).locator('.cal-end')
  await expect(ends.nth(0)).toHaveClass(/aimed/)

  const leaves = await countCalendarLeaves(page)
  await mouseClick(page, page.locator('.top-row .date-pill').nth(1))
  await pause(page, 300)
  expect(await leaves(), '日曆沒有開始離場、也沒有關掉重開').toBe(0)
  await expect(ends.nth(1), '改填結束日').toHaveClass(/aimed/)
})

test('G19 日曆開著時點頁面空白處：日曆收起', async ({ page }) => {
  await openDashboard(page)
  await openCalendar(page, '大於')
  await mouseClick(page, page.locator('[data-panel="gantt"] .panel-head'), { x: 5, y: 5 })
  await expect(calendar(page), '點面板標題列空白處').toHaveCount(0)

  // 頂欄裡的空白處（專案名稱）也一樣
  await mouseClick(page, page.locator('.top-row .date-pill'))
  await calendarSettled(page)
  await mouseClick(page, page.locator('.top-row .project'))
  await expect(calendar(page), '點頂欄的專案名稱').toHaveCount(0)
})

/**
 * G7 錨點：頂欄一行時篩選器靠右排（flex-end），觸發鈕變寬是左緣往左長、右緣不動；兩列時靠左排，左緣不動。
 * 下拉 / 成員面板開著勾選項讓觸發鈕變寬，選單要錨在不動的那一側，不能被帶著跑。
 */
for (const vp of [
  { width: 1920, stacked: false },
  { width: 1366, stacked: true },
]) {
  test.describe(`${vp.width}px（${vp.stacked ? '兩列' : '一行'}）`, () => {
    test.use({ viewport: { width: vp.width, height: 900 } })

    for (const m of [
      {
        name: '狀態下拉開著勾第一項',
        open: '.top-row .dd-trigger',
        sel: '.top-row .dd-menu',
        pick: '.top-row .dd-menu .dd-item',
      },
      {
        name: '成員面板開著勾一位',
        open: '.mp-trigger',
        sel: '.mp-panel',
        pick: '.mp-panel .mp-row',
      },
    ]) {
      test(`G7 ${m.name}：選單位置不動`, async ({ page }) => {
        await openDashboard(page)
        await expect(page.locator('.top-row.stacked'), '前提：版型').toHaveCount(vp.stacked ? 1 : 0)
        await page.locator(m.open).first().click()
        await expect(page.locator(m.sel)).not.toHaveClass(/pop-enter/)
        const trigger = await page.locator(m.open).first().boundingBox()

        const tr = await trace(page, { menu: m.sel }, () => clickInPage(page, m.pick))
        const after = await page.locator(m.open).first().boundingBox()
        expect(Math.abs(after!.width - trigger!.width), '前提：觸發鈕寬度變了').toBeGreaterThan(2)

        const xs = series(tr, 'menu').map((b) => b.x)
        const drift = Math.max(...xs.map((x) => Math.abs(x - xs[0]!)))
        expect(drift, '選單左緣的位移（px）').toBeLessThanOrEqual(1)
        expect(Math.min(...xs), '選單不超出視窗左緣').toBeGreaterThanOrEqual(0)
      })
    }
  })
}
