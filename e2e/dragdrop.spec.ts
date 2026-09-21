import { expect, test, type Page } from '@playwright/test'
import { DashboardPage, html5Drag, stepDrag } from './helpers/dashboardPage'

/**
 * spec §目標行為 4、5 的拖曳部分：
 * 甘特條移動 / 縮放、拖曳建立相依（含防循環）、列與分類重排、
 * 看板卡片與成員的 HTML5 拖放。
 *
 * 指標拖曳一律用 `page.mouse` 分步 move，因為實作是 document 層的 pointermove；
 * HTML5 拖放用 helper 的 `html5Drag`（理由見 helper 的註解）。
 */

/** 一天的預設寬度，與 `uiStore.dayWidth` 初始值一致。 */
const DAY_W = 32
/** 測試一律把甘特捲到這個位置，t3-t6 的條才都落在可視範圍內。 */
const SCROLL_X = 480

/** 從某個甘特條的右側圓點拖到另一個任務的條上，放開即嘗試建立相依。 */
async function dragLink(page: Page, app: DashboardPage, from: string, to: string): Promise<void> {
  // 圓點只在「已選取 + 滑鼠在條上」時才吃事件（legacy :2942-2948）
  await app.row(from).locator('.name').click()
  await app.freezeGanttScroll(SCROLL_X)
  const src = (await app.bar(from).boundingBox())!
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)

  const dot = app.linkDot(from, 'R')
  await expect(dot).toHaveClass(/shown/)
  const db = (await dot.boundingBox())!
  const tb = (await app.bar(to).boundingBox())!

  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('先選取再拖曳甘特條往右 3 天，下游任務跟著移', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await app.row('t3').locator('.name').click()
  // 選取會觸發 focus 捲動，先把捲動位置釘死再量條的位置
  await app.freezeGanttScroll(SCROLL_X)

  const box = (await app.bar('t3').boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 20, y)
  await page.mouse.down()
  await page.mouse.move(box.x + 20 + DAY_W * 3, y, { steps: 6 })
  await page.mouse.up()

  await expect(app.row('t3')).toContainText('2026/09/11 → 2026/09/19')
  // t4 原本 09-14 開始，被上游推 3 天（cascade）
  await expect(app.row('t4')).toContainText('2026/09/17')
})

test('拖右側把手只改結束日，不動開始日', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await app.row('t3').locator('.name').click()
  await app.freezeGanttScroll(SCROLL_X)

  const box = (await app.bar('t3').boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width - 4, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 4 + DAY_W * 2, y, { steps: 6 })
  await page.mouse.up()

  await expect(app.row('t3')).toContainText('2026/09/08 → 2026/09/18')
})

test('未選取的條拖曳無效', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await app.freezeGanttScroll(SCROLL_X)
  await expect(app.bar('t3')).toHaveAttribute('title', /點擊以選取後才能拖曳/)

  const box = (await app.bar('t3').boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 20, y)
  await page.mouse.down()
  await page.mouse.move(box.x + 20 + DAY_W * 3, y, { steps: 6 })
  await page.mouse.up()

  // 日期沒動；按住未選取的條只是平移畫布（放開時的 click 才把它選起來，同 legacy）
  await expect(app.row('t3')).toContainText('2026/09/08 → 2026/09/16')
})

test('從右側圓點拖到另一任務建立相依；反向循環被拒', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await expect(app.depLines).toHaveCount(27)

  await dragLink(page, app, 't3', 't5')
  await expect(app.depLines).toHaveCount(28)
  // 放開後預覽線要收掉
  await expect(app.linkPreview).toHaveCount(0)

  // t3 → t4 已存在，反向會成環，addDep 要回絕
  await dragLink(page, app, 't4', 't3')
  await expect(app.depLines).toHaveCount(28)
})

test('列拖曳重排到另一分類', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  expect((await app.rowOrder()).slice(5, 9)).toEqual(['t5', 't6', 'G:g2', 't7'])

  const gb = (await app.row('t6').locator('.grip').boundingBox())!
  const x = gb.x + gb.width / 2
  const y0 = gb.y + gb.height / 2
  // 第一步還在自己那一列裡（不動），第二步越過下緣才換位
  await stepDrag(page, { x, y: y0 }, [{ x, y: y0 + 14 }, { x, y: y0 + 28 }], 220)

  // g2 的第一筆變成 t6（legacy moveTaskTo 的 dir='down' → 插在該分類第一筆之前）
  expect((await app.rowOrder()).slice(5, 9)).toEqual(['t5', 'G:g2', 't6', 't7'])
})

test('分類拖曳交換順序', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await page.getByRole('button', { name: '▼ 全部收合' }).click()
  await expect(app.row('t1')).toHaveCount(0)
  expect((await app.rowOrder()).slice(0, 2)).toEqual(['G:g1', 'G:g2'])

  const gb = (await app.groupRow('g1').locator('.grip').boundingBox())!
  const x = gb.x + gb.width / 2
  const y0 = gb.y + gb.height / 2
  // 要越過自己整塊的下緣，而且超過下一塊的一半才交換（legacy :2523-2531）
  await stepDrag(page, { x, y: y0 }, [{ x, y: y0 + 16 }, { x, y: y0 + 44 }], 300)

  expect((await app.rowOrder()).slice(0, 2)).toEqual(['G:g2', 'G:g1'])
})

test('成員從面板拖到卡片指派', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await expect(app.card('t3').locator('.avatar')).toHaveCount(1)

  await app.memberPickerTrigger.click()
  await expect(app.memberRow(1)).toBeVisible()
  await html5Drag(page, '.mp-panel .mp-row:nth-child(2)', '[data-card="t3"]')

  await expect(app.card('t3').locator('.avatar')).toHaveCount(2)
  await expect(app.card('t3').locator('.avatar').nth(1)).toContainText('2')
})

test('卡片拖到別欄不改狀態', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await expect(app.column('doing').locator('[data-card="t3"]')).toHaveCount(1)

  await html5Drag(page, '[data-card="t3"]', '[data-col="done"]')

  await expect(app.column('doing').locator('[data-card="t3"]')).toHaveCount(1)
  await expect(app.column('done').locator('[data-card="t3"]')).toHaveCount(0)
  await expect(app.card('t3').locator('.st')).toContainText('執行中')
})

test('卡片拖到甘特分類列改分類', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await expect(app.card('t3').locator('.group')).toHaveText('前端開發')

  await html5Drag(page, '[data-card="t3"]', '[data-rowgroup="g3"]')

  await expect(app.card('t3').locator('.group')).toHaveText('資料與整合')
  const order = await app.rowOrder()
  expect(order[order.indexOf('G:g3') + 1]).toBe('t3')
})
