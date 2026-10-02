import { expect, test, type Page } from '@playwright/test'
import { OverviewPage } from './helpers/overviewPage'
import { clickInPage, hasMid, peakThenFall, series, trace, type Trace } from './helpers/motion'

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
 * 頁內點「進入」，等 Dashboard 淡入走了一段（透明度 > 0.15）的那一幀就按上一頁（太早按，往回的淡出依比例縮短到只剩一幀，量不到中間值）。
 * 回傳按上一頁的頁內時間（同 trace 的時間基準）與當時的透明度。不用固定毫秒數：第一次進 Dashboard 有掛載的長幀，
 * 固定 80ms 可能還沒開始淡入、也可能已經淡入完，要在「淡入途中」按才量得到 G9。
 */
async function enterThenBack(page: Page): Promise<{ t: number; o: number }> {
  return page.evaluate(
    (sel) =>
      new Promise<{ t: number; o: number }>((resolve, reject) => {
        const t0 = (window as unknown as { __trace: { t0: number } }).__trace.t0
        ;(document.querySelector(sel) as HTMLElement).click()
        const start = performance.now()
        const tick = (): void => {
          const el = document.querySelector('.dash')
          const o = el ? parseFloat(getComputedStyle(el).opacity) : 0
          if (o > 0.15) {
            history.back()
            resolve({ t: performance.now() - t0, o })
          } else if (performance.now() - start > 5000) reject(new Error('Dashboard 5 秒內沒有開始淡入'))
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    ENTER,
  )
}

/** 長幀：兩幀之間超過這麼久，transition 會在這段時間裡照常往前走一大截。 */
const LONG_FRAME_MS = 50

/**
 * 按上一頁到淡出第一幀之間有沒有長幀。有的話淡入會在這段時間裡順著走到接近全亮（實測 0.02 → 0.98），
 * 那是 transition 的正確行為，但量不到「從當下往回」。
 */
function longFrameBeforeLeave(tr: Trace, pressT: number): boolean {
  const first = tr.frames.findIndex((f) => f.boxes.leave)
  return tr.frames.some((f, i) => i <= first && f.t >= pressT && f.dt > LONG_FRAME_MS)
}

/**
 * 錄「進入 → 淡入途中按上一頁」。前提是在淡入途中按、而且按下到開始淡出之間沒有長幀：
 * 機器忙時淡入可能被一個長幀吃掉（0.02 → 1.00），或按下之後被長幀推到接近全亮，那時從高處往下淡出是對的、量不到 G9
 * ——回總覽重來，最多 3 次。keyframes 版沒有長幀時照樣是淡出第一幀就是 1，抓得到。
 * 回傳最後一次的錄影、按下時的透明度與這一次的前提成不成立。
 */
async function traceEnterBack(page: Page, ov: OverviewPage): Promise<{ tr: Trace; pressedAt: number; valid: boolean }> {
  let tr!: Trace
  let pressedAt = 1
  let valid = false
  let pressT = 0
  for (let attempt = 0; attempt < 3 && !valid; attempt++) {
    if (attempt) {
      await expect(page.locator('.dash')).toHaveCount(0)
      await expect(ov.card('pmis')).toBeVisible()
    }
    tr = await trace(
      page,
      TARGETS,
      async () => {
        const r = await enterThenBack(page)
        pressT = r.t
        pressedAt = r.o
      },
      { ms: 1000 },
    )
    valid = pressedAt < 0.5 && !longFrameBeforeLeave(tr, pressT)
  }
  return { tr, pressedAt, valid }
}

test('G9 Dashboard 淡入途中按上一頁：從當下的透明度往回淡出，不先跳回全亮', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto()
  const { tr, pressedAt, valid } = await traceEnterBack(page, ov)
  expect(valid, `3 次都沒在淡入途中按到上一頁、或按下後碰上長幀（機器太忙；最後一次按下時 ${pressedAt.toFixed(2)}）`).toBe(true)
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

/**
 * K1 這裡只守「淡入是 transition」：keyframes 的時鐘從新頁插入那一幀就開始走，掛載的長幀把淡入吃掉（修正前實測
 * 0.00 → 0.02 → 0.11 → 1.00）；transition 要等 Vue 隔兩幀拿掉 enter-from 才起步，落在掛載的主要長幀之後。
 * 不量「中間值至少幾幀」：掛載之後還有零星長幀，機器忙時（平行跑、防毒掃描）仍會把淡入吃掉一兩成，
 * 那是掛載成本本身的問題（延後掛載畫面外的面板），留給 K1 的後續批次。
 */
test('K1 第一次從總覽進 Dashboard：淡入用 transition（不是 keyframes），從 0 一路往上到全亮', async ({ page }) => {
  const ov = new OverviewPage(page)
  await ov.goto()
  // 淡入期間每幀記下 .dash 的 animation / transition 設定（掛載前就開始等，頁內 rAF）
  await page.evaluate(() => {
    const w = window as unknown as { __enterStyles: { animation: string; transition: string }[] }
    w.__enterStyles = []
    const start = performance.now()
    const tick = (): void => {
      const el = document.querySelector('.dash.page-view-enter-active')
      if (el) {
        const cs = getComputedStyle(el)
        w.__enterStyles.push({ animation: cs.animationName, transition: cs.transitionProperty })
      }
      if (performance.now() - start < 5000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  // 總覽淡出＋第一次掛 Dashboard 的長幀＋淡入，平行跑時會拉長，錄 2 秒
  const tr = await trace(page, TARGETS, () => clickInPage(page, ENTER), { ms: 2000 })
  const styles = await page.evaluate(
    () => (window as unknown as { __enterStyles: { animation: string; transition: string }[] }).__enterStyles,
  )
  expect(styles.length, '淡入期間量得到 .dash').toBeGreaterThan(0)
  // 修正前是 animation: fadeIn
  expect(styles.every((s) => s.animation === 'none' && /\bopacity\b|\ball\b/.test(s.transition)), JSON.stringify(styles[0])).toBe(true)

  const os = series(tr, 'dash').map((b) => b.o)
  // 失敗訊息只列到第一次全亮，後面全是 1
  const full = os.indexOf(1)
  const detail = (full < 0 ? os : os.slice(0, full + 1)).map((o) => o.toFixed(2)).join(' ')
  expect(os[0], `淡入從 0 起步（${detail}）`).toBeLessThan(0.05)
  expect(os.at(-1), `淡入結束是全亮（${detail}）`).toBe(1)
  expect(
    os.every((o, i) => i === 0 || o >= os[i - 1]! - 0.02),
    `淡入一路往上（${detail}）`,
  ).toBe(true)
})
