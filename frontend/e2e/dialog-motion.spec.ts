import { expect, test, type Page } from '@playwright/test'
import { hasMid, idle, openDashboard, openDepEditor, peakThenFall, series, trace, uiSet } from './helpers/motion'

/** 對話框類浮層的進出場（動畫稽核 G12）與相依編輯器位置（G15）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

/**
 * 頁內直接點（不等 Playwright 往返），回傳點下去的時間（同 trace 的時間基準）：
 * trace 的 at 在 Playwright 往返之前就記了，at 到實際點擊之間可能夾著一幀點擊前的畫面，「離場中」要從這個時間算。
 */
const click = (page: Page, sel: string): Promise<number> =>
  page.evaluate((sel) => {
    const tr = (window as unknown as { __trace?: { t0: number } }).__trace
    const at = tr ? performance.now() - tr.t0 : 0
    ;(document.querySelector(sel) as HTMLElement).click()
    return at
  }, sel)

/** 甘特列「⋮」→「刪除任務…」開第一步確認框。 */
async function openConfirm(page: Page): Promise<void> {
  const more = page.locator('[data-rowmore="t3"]')
  await more.scrollIntoViewIfNeeded()
  await more.click()
  await page.locator('[data-rowmenu] .rm-item', { hasText: '刪除任務' }).click()
  await page.locator('.confirm-dialog').waitFor()
  await idle(page)
}

test('G12 相依編輯器：關閉時連同遮罩淡出，離場不攔點擊', async ({ page }) => {
  await openDashboard(page)
  await openDepEditor(page, 't3')
  let clicked = 0
  const tr = await trace(page, { backdrop: '.dep-backdrop', box: '.dep-editor' }, async () => {
    clicked = await click(page, '.dep-done')
  })
  for (const name of ['backdrop', 'box']) {
    const s = series(tr, name).filter((b) => b.t > clicked)
    expect(hasMid(s.map((b) => b.o)), `${name} 離場有中間值`).toBe(true)
  }
  expect(series(tr, 'backdrop').filter((b) => b.t > clicked).every((b) => b.pe === 'none'), '離場中不攔點擊').toBe(true)
})

test('G12 確認框：取消時連同遮罩淡出；快速開關不閃全亮', async ({ page }) => {
  await openDashboard(page)
  await openConfirm(page)
  const tr = await trace(page, { box: '.confirm-dialog' }, () => click(page, '.confirm-dialog .btn-cancel'))
  expect(hasMid(series(tr, 'box').filter((b) => b.t > tr.at).map((b) => b.o)), '離場有中間值').toBe(true)

  // 開啟 60ms 就取消：直接寫 store 開（選單流程太慢），頁內排程取消
  await idle(page)
  const quick = await trace(page, { box: '.confirm-dialog' }, async () => {
    await uiSet(page, 'confirm', { kind: 'task', id: 't3', step: 1 })
    await page.evaluate(() => setTimeout(() => (document.querySelector('.confirm-dialog .btn-cancel') as HTMLElement | null)?.click(), 60))
  })
  const r = peakThenFall(series(quick, 'box').map((b) => b.o))
  expect(r.peak).toBeLessThan(0.98)
  expect(r.rises).toBe(0)
})

test('G12 Lightbox：只淡入淡出，說明文字不位移縮放', async ({ page }) => {
  await openDashboard(page)
  const opening = await trace(page, { box: '.lightbox', cap: '.lightbox .caption' }, () =>
    uiSet(page, 'lightbox', { url: '', name: 'demo.png', size: '12 KB' }),
  )
  expect(hasMid(series(opening, 'box').map((b) => b.o)), '進場有中間值').toBe(true)
  const closing = await trace(page, { box: '.lightbox', cap: '.lightbox .caption' }, () => click(page, '.lightbox'))
  expect(hasMid(series(closing, 'box').filter((b) => b.t > closing.at).map((b) => b.o)), '離場有中間值').toBe(true)
  const ws = [...series(opening, 'cap'), ...series(closing, 'cap')].map((b) => b.w)
  expect(Math.max(...ws) - Math.min(...ws), '說明文字寬度（有縮放就會變）').toBeLessThanOrEqual(0.5)
})

test('G15 相依編輯器：打開時置中，之後增刪列上緣不動、底部不超出視窗', async ({ page }) => {
  await openDashboard(page)
  await openDepEditor(page, 't3')
  const box = () => page.locator('.dep-editor').boundingBox().then((b) => b!)
  const b0 = await box()
  expect(Math.abs(b0.y + b0.height / 2 - 540), '打開時垂直置中').toBeLessThanOrEqual(1)
  for (let i = 0; i < 3; i++) {
    await page.locator('.dep-pred-select').selectOption({ index: 1 })
    await idle(page)
    const b = await box()
    expect(Math.abs(b.y - b0.y), `新增第 ${i + 1} 筆後上緣`).toBeLessThanOrEqual(0.5)
    expect(b.y + b.height, '底部在視窗內').toBeLessThanOrEqual(1080)
  }
  await page.locator('.dep-pred-row .dep-x').first().click()
  await idle(page)
  expect(Math.abs((await box()).y - b0.y), '刪除後上緣').toBeLessThanOrEqual(0.5)
})
