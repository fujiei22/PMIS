import { expect, test } from '@playwright/test'
import { openDashboard, pause, ui } from './helpers/motion'

/** 詳情 Modal 的開關銜接（動畫稽核 G2 / G3 / G4 / G10 / G13）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

test('G13 平滑捲動途中開詳情：背景停在開啟當下，關閉後不跳', async ({ page }) => {
  await openDashboard(page)
  await page.locator('.top-bar .board-link', { hasText: 'Issue' }).click()
  // 確認真的還在平滑捲動（捲完了這條就沒有鑑別力）
  const moving = await page.evaluate(async () => {
    const a = scrollY
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return scrollY !== a
  })
  expect(moving, '開詳情前還在捲').toBe(true)
  await ui(page, 'openDetail', 't3', 'task')
  await expect(page.locator('.detail-modal')).toBeVisible()
  const atOpen = await page.evaluate(() => scrollY)
  await pause(page, 600)
  expect(await page.evaluate(() => scrollY), '開著的期間背景不再捲').toBe(atOpen)
  await page.locator('.detail-close').click()
  await expect(page.locator('.detail-modal')).toHaveCount(0)
  expect(Math.abs((await page.evaluate(() => scrollY)) - atOpen), '關閉後沒有跳回半途').toBeLessThanOrEqual(1)
})
