import { expect, test, type Page } from '@playwright/test'
import { OverviewPage } from './helpers/overviewPage'
import { clickInPage, hasMid, peakThenFall, series, trace } from './helpers/motion'

/**
 * 切頁過渡（App.vue 的 page-view，A29）的逐幀量測（動畫稽核批次 E：G9 / K1）。
 * 量 Dashboard 頁面根元素 .dash 的透明度；`leave` 只在 .dash 帶著 page-view-leave-active 的幀上才量得到，
 * 用來分出「淡入中」與「已經開始淡出」的幀。
 */
test.use({ viewport: { width: 1920, height: 1080 } })

/** 總覽卡片右緣的「進入」直條（PMIS 那張）。 */
const ENTER = '[data-view-panel="cards"] [data-project="pmis"] .enter-edge'

const TARGETS = { dash: '.dash', leave: '.dash.page-view-leave-active' }

/**
 * 頁內點「進入」，等 Dashboard 淡入到看得到（透明度 > 0.05）的那一幀就按上一頁。
 * 回傳按上一頁的頁內時間（同 trace 的時間基準）。不用固定毫秒數：第一次進 Dashboard 有掛載的長幀，
 * 固定 80ms 可能還沒開始淡入、也可能已經淡入完，要在「淡入途中」按才量得到 G9。
 */
async function enterThenBack(page: Page): Promise<number> {
  return page.evaluate(
    (sel) =>
      new Promise<number>((resolve, reject) => {
        const t0 = (window as unknown as { __trace: { t0: number } }).__trace.t0
        ;(document.querySelector(sel) as HTMLElement).click()
        const start = performance.now()
        const tick = (): void => {
          const el = document.querySelector('.dash')
          if (el && parseFloat(getComputedStyle(el).opacity) > 0.05) {
            history.back()
            resolve(performance.now() - t0)
          } else if (performance.now() - start > 5000) reject(new Error('Dashboard 5 秒內沒有開始淡入'))
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    ENTER,
  )
}

test('G9 Dashboard 淡入途中按上一頁：從當下的透明度往回淡出，不先跳回全亮', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto()
  const tr = await trace(page, TARGETS, () => enterThenBack(page), { ms: 1000 })
  // 失敗訊息用：還沒帶 leave class 的 .dash 幀＝淡入中，帶了的＝淡出中
  const entering = tr.frames.filter((f) => f.boxes.dash && !f.boxes.leave).map((f) => f.boxes.dash!.o)
  const leaving = series(tr, 'leave').map((b) => b.o)
  const detail = `淡入 ${entering.map((o) => o.toFixed(2)).join(' ')}｜淡出 ${leaving.map((o) => o.toFixed(2)).join(' ')}`
  // 不要求淡出的幀數：往回走的過渡會依已走的比例縮短（CSS 規則），淡入才到 0.16 就切走時，淡出只剩約 26ms、兩幀
  expect(leaving.length, `有淡出的幀（${detail}）`).toBeGreaterThan(0)
  // keyframes 被打斷會從頭播：淡出第一幀就是 1（修正前實測淡入 0.11 → 淡出 1.00 → 1.00 → 0.85 …）。
  // transition 會順著淡入多走 1–2 幀再往回（Vue 隔一兩幀才加 leave-to），峰值仍遠低於全亮（實測 0.16–0.55）。
  const r = peakThenFall(leaving)
  expect(r.peak, `淡出中不跳回全亮（${detail}）`).toBeLessThan(0.95)
  expect(r.rises, `過了峰值一路往下（${detail}）`).toBe(0)
  expect(hasMid(leaving), `淡出有中間值（${detail}）`).toBe(true)
  await expect(page.locator('[data-view="overview"]')).toBeVisible()
})

test('K1 第一次從總覽進 Dashboard：掛載的長幀之後淡入照常有中間值（≥ 3 幀），不卡幾幀就直接全亮', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto()
  // 總覽淡出＋第一次掛 Dashboard 的長幀＋淡入，平行跑時會拉長，錄 2 秒
  const tr = await trace(page, TARGETS, () => clickInPage(page, ENTER), { ms: 2000 })
  const os = series(tr, 'dash').map((b) => b.o)
  // 失敗訊息只列到第一次全亮，後面全是 1
  const full = os.indexOf(1)
  const detail = (full < 0 ? os : os.slice(0, full + 1)).map((o) => o.toFixed(2)).join(' ')
  // 修正前（keyframes）實測 0.00 → 0.02 → 0.11 → 1.00、0.00 → 0.00 → 1.00：動畫時鐘在長幀裡照走，只剩 0–1 幀中間值
  expect(os.filter((o) => o > 0.05 && o < 0.95).length, `淡入的中間值幀數（${detail}）`).toBeGreaterThanOrEqual(3)
  expect(os.at(-1), `淡入結束是全亮（${detail}）`).toBe(1)
  expect(
    os.every((o, i) => i === 0 || o >= os[i - 1]! - 0.02),
    `淡入一路往上（${detail}）`,
  ).toBe(true)
})
