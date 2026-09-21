import { expect, test } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'

/**
 * S3 的驗收：版面畫得出來、唯讀顯示的數字正確、面板收合 / 縮放 / 今天 / 分類收合會動。
 * 互動（篩選、排序、就地編輯、拖曳、詳細視窗）是 S4-S6 的範圍，不在這裡斷言。
 */

test('首頁渲染四張卡與三個面板', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  // legacy 的專案區間是 2026-08-24 ~ 2026-11-10，共 79 天
  await expect(app.summary('duration')).toContainText('79 天')
  await expect(app.summary('duration')).toContainText('2026-08-24 ~ 2026-11-10')
  await expect(app.summary('progress')).toBeVisible()
  await expect(app.summary('tasks')).toBeVisible()
  await expect(app.summary('issues')).toBeVisible()

  await expect(app.taskCount).toHaveText('共 30 個任務')
  await expect(app.issueCount).toHaveText('共 12 筆 Issue')

  await expect(page.locator('[data-rowtask]')).toHaveCount(30)
  await expect(page.locator('[data-rowgroup]')).toHaveCount(6)
  // 全部展開時沒有摘要條，所以 bar 數 = 任務數
  await expect(page.locator('[data-taskid]')).toHaveCount(30)
  await expect(page.locator('[data-card]')).toHaveCount(30)
  await expect(page.locator('[data-issuerow]')).toHaveCount(12)

  // 固定時鐘 2026-09-18；t3 的 end 是 2026-09-16 且未完成 → 延遲
  await expect(app.row('t3')).toHaveAttribute('data-status', 'delayed')
  await expect(app.bar('t3')).toHaveAttribute('data-status', 'delayed')
  await expect(app.card('t3')).toHaveAttribute('data-status', 'delayed')

  // 未選取時三面板的 data-selected 都是 false
  await expect(app.card('t3')).toHaveAttribute('data-selected', 'false')
  await expect(app.row('t3')).toHaveAttribute('data-selected', 'false')
})

test('收合分類顯示摘要條、面板收合、縮放、今天按鈕', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  // ── 分類收合 → 該分類的任務列消失，右側改畫一條摘要條 ──────────────────
  await app.groupRow('g1').locator('.caret').click()
  await expect(app.bar('sum-g1')).toBeVisible()
  await expect(page.locator('[data-rowtask]')).toHaveCount(24)
  await expect(page.locator('[data-taskid]')).toHaveCount(25) // 24 條 + 1 條摘要
  await app.groupRow('g1').locator('.caret').click()
  await expect(page.locator('[data-rowtask]')).toHaveCount(30)

  // ── 面板收合 → 內容卸載 ───────────────────────────────────────────────
  await app.panelToggle('kanban').click()
  await expect(page.locator('[data-card]')).toHaveCount(0)
  await app.panelToggle('kanban').click()
  await expect(page.locator('[data-card]')).toHaveCount(30)

  await app.panelToggle('issues').click()
  await expect(page.locator('[data-issuerow]')).toHaveCount(0)
  await app.panelToggle('issues').click()
  await expect(page.locator('[data-issuerow]')).toHaveCount(12)

  // ── 縮放滑桿 → 甘特畫布變窄 ───────────────────────────────────────────
  const wide = (await app.ganttChart.boundingBox())!.width
  await app.zoomSlider.fill('14')
  await expect.poll(async () => (await app.ganttChart.boundingBox())!.width).toBeLessThan(wide)
  await app.zoomSlider.fill('32')
  await expect.poll(async () => (await app.ganttChart.boundingBox())!.width).toBe(wide)

  // ── 今天按鈕 → 捲回今天，尺規跟著同步 ─────────────────────────────────
  await app.ganttScroller.evaluate((el) => {
    el.scrollLeft = 0
  })
  await expect.poll(() => app.scrollLeftOf(app.ganttScroller)).toBe(0)
  await app.todayButton.click()
  await expect.poll(() => app.scrollLeftOf(app.ganttScroller), { timeout: 5000 }).toBeGreaterThan(0)
  const x = await app.scrollLeftOf(app.ganttScroller)
  expect(Math.abs((await app.scrollLeftOf(app.ganttRuler)) - x)).toBeLessThanOrEqual(1)
})

test('sticky 標題偏移依量測值', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  const topH = await app.heightOf(app.topBar)
  expect(topH).toBeGreaterThan(0)

  for (const key of ['gantt', 'kanban', 'issues'] as const) {
    await expect(app.panelHead(key)).toHaveCSS('top', `${topH}px`)
  }

  // 甘特尺規那一列黏在「頂列 + 甘特面板頭」之下
  const ganttHeadH = await app.heightOf(app.panelHead('gantt'))
  await expect(app.ganttRulerRow).toHaveCSS('top', `${topH + ganttHeadH}px`)

  // 看板欄位頭黏在「頂列 + 看板面板頭」之下
  const kanbanHeadH = await app.heightOf(app.panelHead('kanban'))
  await expect(app.panel('kanban').locator('.col-head').first()).toHaveCSS(
    'top',
    `${topH + kanbanHeadH}px`,
  )
})
