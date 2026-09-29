import { expect, test, type Locator } from '@playwright/test'
import { OverviewPage } from './helpers/overviewPage'

/**
 * 總覽在平板直向（768×1024、觸控）的版面與手指操作。
 *
 * 版面：面板標題列維持一行（計數短寫、排序 chips 放不下時左右滑）、排序選單開在畫面內、整頁沒有橫向捲動；
 * 卡片檢視的 PM 標頭改在卡片上方、卡片一列兩張，速覽抽屜橫跨整列；
 * 時間軸左欄縮成 260px、只留實際 %，bar 起點捲到左欄底下時名稱仍停在可見範圍。
 * 手指操作：點過的卡片與時間軸列不會留著 hover 樣式（看起來像沒收合）；排序 chip 的 ✕ 點偏一點也算。
 */

test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true })

/** 元件垂直中線的 y。 */
async function midY(loc: Locator): Promise<number> {
  const b = (await loc.boundingBox())!
  return b.y + b.height / 2
}

test('卡片：標題列一行、計數短寫；排序選單開在畫面內，整頁沒有橫向捲動', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto()
  const head = page.locator('[data-view-panel="cards"] .panel-head')
  await expect(ov.count()).toHaveText('7 專案 · 3 需注意 · 4 PM')
  expect(Math.abs((await midY(head.locator('.panel-title'))) - (await midY(head.locator('.panel-toggle'))))).toBeLessThan(2)

  await head.locator('.sort-trigger').tap()
  const menu = head.locator('.sort-menu')
  await expect(menu).toBeVisible()
  await page.waitForFunction(() => document.getAnimations().length === 0)
  const m = (await menu.boundingBox())!
  expect(m.x + m.width).toBeLessThanOrEqual(768)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
})

test('卡片：PM 標頭在卡片上方、卡片一列兩張；展開的速覽和整列一樣寬、排在整列下方', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto()
  const head = (await page.locator('[data-pm-col="m5"] .lane-head').boundingBox())!
  const pmis = (await ov.card('pmis').boundingBox())!
  const pay = (await ov.card('payment').boundingBox())!
  expect(head.y + head.height).toBeLessThanOrEqual(pmis.y)
  expect(pay.y).toBeCloseTo(pmis.y, 0)
  expect(pay.x).toBeGreaterThan(pmis.x + pmis.width)

  await ov.card('pmis').locator('.card-name').tap()
  await expect.poll(async () => (await ov.drawer('pmis').boundingBox())?.height ?? 0).toBeGreaterThan(200)
  const d = (await ov.drawer('pmis').boundingBox())!
  expect(d.x).toBeCloseTo(pmis.x, 0)
  expect(d.width).toBeCloseTo(pay.x + pay.width - pmis.x, 0)
  expect(d.y).toBeGreaterThanOrEqual(pay.y + pay.height)
})

test('時間軸：標題列一行；左欄 260px、只留實際 %；起點在左欄底下的 bar 名稱仍看得到', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto('#timeline')
  const head = page.locator('[data-view-panel="timeline"] .panel-head')
  expect(Math.abs((await midY(head.locator('.panel-title'))) - (await midY(head.getByTestId('overview-today'))))).toBeLessThan(2)

  expect((await page.locator('.tl-left-head').boundingBox())!.width).toBe(260)
  await expect(ov.row('pmis').locator('.pct-plan')).toBeHidden()

  // 進頁捲到今天：挑出起點在左欄底下、而且右邊還放得下名稱的 bar，名稱都要停在左欄右緣之後
  const cut = await page.evaluate(() => {
    const edge = document.querySelector('.tl-left-head')!.getBoundingClientRect().right
    return [...document.querySelectorAll('[data-view-panel="timeline"] [data-project]')]
      .map((b) => {
        const bar = b.querySelector('.bar')!.getBoundingClientRect()
        const label = b.querySelector('.bar-label')!.getBoundingClientRect()
        return { cut: bar.left < edge && bar.right > edge + label.width + 14, visible: label.left >= edge }
      })
      .filter((r) => r.cut)
  })
  expect(cut.length).toBeGreaterThan(0)
  expect(cut.every((r) => r.visible)).toBe(true)
})

test('點卡片展開再收合：卡片不會留著 hover 的上浮與陰影', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto()
  const card = ov.card('payment')
  await card.locator('.card-name').tap()
  await expect(ov.drawer('payment')).toBeVisible()
  await card.locator('.card-name').tap()
  await expect(card).toHaveAttribute('aria-expanded', 'false')
  await expect(card).toHaveCSS('translate', 'none')
  await expect(card).toHaveCSS('box-shadow', 'none')
})

test('點時間軸列展開再收合：bar 不會留著選取時的光暈', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto('#timeline')
  const row = ov.row('payment')
  const plain = await ov.row('app').locator('.bar').evaluate((el) => getComputedStyle(el).boxShadow)
  await row.locator('.p-name').tap()
  await expect(row.locator('.p-row')).toHaveAttribute('aria-expanded', 'true')
  await row.locator('.p-name').tap()
  await expect(row.locator('.p-row')).toHaveAttribute('aria-expanded', 'false')
  await expect(row.locator('.bar')).toHaveCSS('box-shadow', plain)
})

test('排序 chip 的 ✕：點在圓圈左邊幾 px 也算移除，不會翻方向', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto()
  const chips = page.locator('[data-view-panel="cards"] .sort-chip')
  await expect(chips).toHaveCount(2)
  const x = (await page.locator('[data-view-panel="cards"] .chip-x').first().boundingBox())!
  // 圓圈左邊 4px：沒有外擴熱區時落在 chip 本體上，會變成翻方向
  await page.touchscreen.tap(x.x - 4, x.y + x.height / 2)
  await expect(chips).toHaveCount(1)
  await expect(chips.first().locator('.chip-label')).toHaveText('專案到期日')
})
