import { expect, test, type Page } from '@playwright/test'
import { idle, pause } from './helpers/motion'
import { OverviewPage } from './helpers/overviewPage'

/**
 * 首屏外的面板延後掛載（動畫稽核 K1，composables/useDeferredPanels.ts）：從總覽切進 Dashboard、又不還原捲動時，
 * 看板與 Issue 面板等淡入跑完、瀏覽器空閒才掛；面板捷徑、上一頁 / 下一頁的捲動還原、高螢幕首屏看得到的面板照常。
 */
test.use({ viewport: { width: 1920, height: 1080 } })

const ENTER = '[data-view-panel="cards"] [data-project="pmis"] .enter-edge'

interface EnterFrame {
  /** Dashboard 根元素的透明度（-1＝還沒掛）。 */
  o: number
  kanban: boolean
  issues: boolean
}

/** 頁內點「進入」，逐幀（rAF）記下 Dashboard 的透明度與兩個面板在不在，錄 ms 毫秒。 */
async function recordEnter(page: Page, ms = 1500): Promise<EnterFrame[]> {
  return page.evaluate(
    ({ sel, ms }) =>
      new Promise<EnterFrame[]>((resolve) => {
        const out: EnterFrame[] = []
        ;(document.querySelector(sel) as HTMLElement).click()
        const t0 = performance.now()
        const tick = (): void => {
          const d = document.querySelector('.dash')
          out.push({
            o: d ? parseFloat(getComputedStyle(d).opacity) : -1,
            kanban: !!document.querySelector('[data-panel="kanban"]'),
            issues: !!document.querySelector('[data-panel="issues"]'),
          })
          if (performance.now() - t0 < ms) requestAnimationFrame(tick)
          else resolve(out)
        }
        requestAnimationFrame(tick)
      }),
    { sel: ENTER, ms },
  )
}

test('從總覽進 Dashboard：第一幀只有首屏（沒有看板 / Issue），淡入跑完才掛上', async ({ page }) => {
  await new OverviewPage(page).goto()
  const frames = await recordEnter(page)
  const shown = frames.filter((f) => f.o >= 0)
  expect(shown.length, 'Dashboard 有掛上').toBeGreaterThan(0)
  expect(shown[0]!.kanban, 'Dashboard 第一幀沒有看板（首屏外，延後掛）').toBe(false)
  expect(shown[0]!.issues, 'Dashboard 第一幀沒有 Issue').toBe(false)
  // 淡入跑完（全亮）之前都不掛：掛載的長任務不能落在淡入期間
  const firstKanban = shown.findIndex((f) => f.kanban)
  const full = shown.findIndex((f) => f.o >= 1)
  expect(full, '淡入跑到全亮').toBeGreaterThanOrEqual(0)
  expect(firstKanban, '看板在淡入全亮之後才掛').toBeGreaterThanOrEqual(full)
  await expect(page.locator('[data-panel="kanban"]'), '最後看板掛上').toBeAttached()
  await expect(page.locator('[data-panel="issues"]'), '最後 Issue 掛上').toBeAttached()
})

test('剛進 Dashboard 就點頂欄「任務」捷徑：看板立刻掛上並捲過去', async ({ page }) => {
  await new OverviewPage(page).goto()
  await page.locator(ENTER).click()
  // Dashboard 一出現就點（看板多半還沒掛）
  await page.locator('.dash .board-link', { hasText: '任務' }).click()
  const head = page.locator('[data-panel="kanban"]')
  await expect(head).toBeAttached()
  // 平滑捲動停下：面板頂端停在頂部列下方（legacy jumpPanel 的 12px）
  await expect
    .poll(async () => {
      const top = await head.evaluate((el) => el.getBoundingClientRect().top)
      const bar = await page.locator('.top-row').evaluate((el) => el.getBoundingClientRect().bottom)
      return Math.round(top - bar)
    })
    .toBeLessThanOrEqual(40)
  expect(await page.evaluate(() => window.scrollY), '真的捲下去了').toBeGreaterThan(800)
})

test('Dashboard 捲到看板後回總覽、再按上一頁：回到原本的捲動位置（掛上當下就是最終高度）', async ({ page }) => {
  await new OverviewPage(page).goto()
  // 從總覽切進來（會延後掛），等全部掛好再捲到看板中段
  await page.locator(ENTER).click()
  await expect(page.locator('[data-panel="issues"]')).toBeAttached()
  await idle(page)
  await page.evaluate(() => window.scrollTo(0, 2600))
  await pause(page, 100)
  const y = await page.evaluate(() => window.scrollY)
  expect(y, '捲到看板中段').toBeGreaterThan(2000)
  await page.locator('.dash .burger').click()
  await expect(page.locator('[data-view="overview"]')).toBeVisible()
  await page.goBack()
  await expect(page.locator('[data-panel="gantt"]')).toBeVisible()
  // 上一頁要還原到非 0 的位置：不延後，掛上當下就有看板與 Issue，捲動不會被短的頁面夾掉
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y)
})

test.describe('高螢幕', () => {
  test.use({ viewport: { width: 1920, height: 2400 } })

  test('甘特下緣在視窗內：看板第一幀就在（同步掛），不在看得到的地方晚一步冒出來', async ({ page }) => {
    await new OverviewPage(page).goto()
    const frames = await recordEnter(page)
    const shown = frames.filter((f) => f.o >= 0)
    expect(shown.length, 'Dashboard 有掛上').toBeGreaterThan(0)
    expect(shown[0]!.kanban, '看板第一幀就在').toBe(true)
  })
})

test('直接開 Dashboard（重新整理）：不延後，一開始就有看板與 Issue', async ({ page }) => {
  await page.goto('/projects/pmis')
  // 甘特列出現的同一刻就要在（不等空閒）：同一次頁內求值裡一起看
  const at = await page.evaluate(
    () =>
      new Promise<{ kanban: boolean; issues: boolean }>((resolve) => {
        const tick = (): void => {
          if (document.querySelector('[data-rowtask]'))
            resolve({
              kanban: !!document.querySelector('[data-panel="kanban"]'),
              issues: !!document.querySelector('[data-panel="issues"]'),
            })
          else requestAnimationFrame(tick)
        }
        tick()
      }),
  )
  expect(at).toEqual({ kanban: true, issues: true })
})

test('總覽捲到下面才點「進入」：照樣延後（首屏看得到的判斷用頁面座標，不受上一頁的捲動位置影響）', async ({ page }) => {
  await new OverviewPage(page).goto()
  // 總覽本身在 1080 高捲不了多少：在 #app 後面墊一塊 3000px 讓頁面可捲（只加文件高度，不影響面板在頁面裡的位置）。
  // 捲 600px：甘特下緣（頁面座標約 1598）減掉捲動量落在 1080 以內，用視窗座標判斷就會誤以為看板在首屏、不延後
  await page.evaluate(() => {
    const pad = document.createElement('div')
    pad.style.height = '3000px'
    document.body.appendChild(pad)
    window.scrollTo(0, 600)
  })
  await pause(page, 100)
  expect(await page.evaluate(() => window.scrollY), '總覽捲下去了（前提）').toBe(600)
  const frames = await recordEnter(page)
  const shown = frames.filter((f) => f.o >= 0)
  expect(shown.length, 'Dashboard 有掛上').toBeGreaterThan(0)
  expect(shown[0]!.kanban, 'Dashboard 第一幀沒有看板').toBe(false)
})
