import { expect, test, type Page } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'

/**
 * S6 的驗收：詳細視窗、堆疊導覽、留言、檔案頁籤、Lightbox、相依編輯器。
 * 對應 spec §目標 行為 7 與行為 8 的相依編輯器部分。
 */

/** 詳細視窗本體（backdrop 與 Lightbox 都不是 dialog）。 */
function modal(page: Page) {
  return page.locator('.detail-modal')
}

/** 從看板卡片的 ⤢ 開任務詳情，等視窗畫出來。 */
async function openTaskDetail(page: Page, taskId: string): Promise<void> {
  await page.locator(`[data-card="${taskId}"] .caret`).click()
  await expect(modal(page)).toBeVisible()
}

test('開任務詳情、從 Issue 列切到 Issue 詳情、返回', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await openTaskDetail(page, 't3')

  await expect(modal(page)).toContainText('前端框架建置')
  await expect(modal(page)).toContainText('負責人')
  await expect(modal(page)).toContainText('執行狀態')
  // 任務詳情沒有返回鈕（不是從別的詳情堆疊過來的）
  await expect(page.getByTitle('返回任務')).toHaveCount(0)

  // i1 掛在 t3 底下，點它切到 Issue 詳情
  await modal(page).getByText('路由切換時狀態遺失').click()
  await expect(modal(page)).toContainText('等級 Class')
  await expect(modal(page)).toContainText('測試環境')
  await expect(modal(page)).not.toContainText('執行狀態')

  await page.getByTitle('返回任務').click()
  await expect(modal(page)).toContainText('負責人')
  await expect(modal(page)).toContainText('執行狀態')
  await expect(modal(page)).not.toContainText('等級 Class')
})

test('送出留言後出現在最上方、作者為 m1、草稿清空', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await openTaskDetail(page, 't3')

  // t3 原本只有 c5（成員1，2026-09-15）
  await expect(modal(page).locator('.comment-row')).toHaveCount(1)

  await modal(page).locator('.draft-input').fill('新的留言內容')
  await modal(page).locator('.send-btn').click()

  const rows = modal(page).locator('.comment-row')
  await expect(rows).toHaveCount(2)
  // 倒序：最新的在最上面
  await expect(rows.first()).toContainText('新的留言內容')
  await expect(rows.first().locator('.comment-author')).toHaveText('成員1')
  await expect(modal(page).locator('.draft-input')).toHaveValue('')
  // 頁籤上的計數跟著加
  await expect(modal(page).locator('.tab-comments')).toContainText('2')
})

test('Issue 詳情有獨立留言串', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await openTaskDetail(page, 't3')
  await expect(modal(page).locator('.comment-row')).toHaveCount(1)

  await modal(page).getByText('路由切換時狀態遺失').click()
  await expect(modal(page)).toContainText('等級 Class')
  // Issue 自己的留言串是空的，不會看到任務那邊的 c5
  await expect(modal(page).locator('.comment-row')).toHaveCount(0)
  await expect(modal(page)).toContainText('此篩選條件下沒有留言')

  await modal(page).locator('.draft-input').fill('Issue 專屬留言')
  await modal(page).locator('.send-btn').click()
  await expect(modal(page).locator('.comment-row')).toHaveCount(1)

  // 返回任務後，任務的留言串不受影響
  await page.getByTitle('返回任務').click()
  await expect(modal(page).locator('.comment-row')).toHaveCount(1)
  await expect(modal(page).locator('.comment-row').first()).toContainText('壓測結果附上')
})

test('檔案頁籤全選後下載按鈕啟用；切換 tab 後關閉再開仍在 files tab', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await openTaskDetail(page, 't3')

  // c5 帶兩個附件
  await expect(modal(page).locator('.tab-files')).toContainText('2')
  await modal(page).locator('.tab-files').click()
  await expect(modal(page).locator('.files-tab')).toBeVisible()
  await expect(modal(page).locator('.file-tile')).toHaveCount(2)
  await expect(modal(page).locator('.download-selected')).not.toHaveClass(/\bon\b/)

  await modal(page).locator('.file-select-all').click()
  await expect(modal(page).locator('.download-selected')).toHaveClass(/\bon\b/)
  await expect(modal(page).locator('.file-sel-label')).toHaveText('已選 2 / 2')

  // 關掉再開：頁籤留在檔案（legacy 跨次保留），但多選被清掉（§不重現的原頁面 bug 2）
  await modal(page).locator('.detail-close').click()
  await expect(modal(page)).toHaveCount(0)
  await openTaskDetail(page, 't3')
  await expect(modal(page).locator('.files-tab')).toBeVisible()
  await expect(modal(page).locator('.file-sel-label')).toHaveText('共 2 個檔案')
  await expect(modal(page).locator('.download-selected')).not.toHaveClass(/\bon\b/)
})

test('相依編輯器新增前置任務後甘特出現連線；循環候選不在選單', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  const depLines = page.locator('.dep-layer polyline.dep')
  await expect(depLines).toHaveCount(27)

  await openTaskDetail(page, 't3')
  await modal(page).locator('.dep-edit-link').click()
  const editor = page.locator('.dep-editor')
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('前端框架建置')

  // t4 是 t3 的後續，設成前置會成環 → 不在候選裡；t2 已是前置 → 也不在
  const predOptions = await editor.locator('.dep-pred-select option').allInnerTexts()
  expect(predOptions).not.toContain('UI 元件開發')
  expect(predOptions).not.toContain('設計系統與元件規範')
  expect(predOptions).toContain('API 規格定義')

  await editor.locator('.dep-pred-select').selectOption({ label: 'API 規格定義' })
  await expect(editor.locator('.dep-pred-row')).toHaveCount(2)

  await editor.locator('.dep-done').click()
  await expect(editor).toHaveCount(0)
  await modal(page).locator('.detail-close').click()
  await expect(depLines).toHaveCount(28)
})

test('從詳情刪任務後視窗正常關閉、body 可捲動', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await openTaskDetail(page, 't3')
  // 開啟期間 body 鎖捲動（legacy :1761）
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')

  await modal(page).locator('.delete-task').click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '繼續刪除' }).click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '確認刪除' }).click()

  await expect(modal(page)).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  await expect(app.card('t3')).toHaveCount(0)
  await expect(page.locator('[data-card]')).toHaveCount(29)
})
