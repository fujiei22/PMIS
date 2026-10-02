import { expect, test, type Page } from '@playwright/test'
import { OverviewPage } from './helpers/overviewPage'
import { clickInPage, hasMid, peakThenFall, series, trace, type Trace } from './helpers/motion'
import { gotoOverview } from './helpers/ovMotion'

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

/** 一個長幀（long-animation-frame）的摘要：時間同 trace 的時間軸。 */
interface Loaf {
  start: number
  end: number
  /** App（src/ 與 Vue）的 script 合計時長。 */
  app: number
  /** 樣式與版面計算的時長（App 改了 DOM 造成的重算也算在這裡）。 */
  layout: number
  /** 失敗訊息用：最長的兩段 script（呼叫者、來源、時長）。 */
  who: string
}

/** 開始記錄長幀（掛在 trace 開始之後：時間以 __trace.t0 為 0）。 */
async function watchLongFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __loafs: Loaf[]; __trace: { t0: number } }
    w.__loafs = []
    type Entry = PerformanceEntry & {
      styleAndLayoutStart: number
      scripts: { invoker: string; sourceURL: string; sourceFunctionName: string; duration: number }[]
    }
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as Entry[]) {
        const t0 = w.__trace.t0
        w.__loafs.push({
          start: e.startTime - t0,
          end: e.startTime + e.duration - t0,
          app: e.scripts.filter((s) => /\/src\/|\/\.vite\/deps\//.test(s.sourceURL)).reduce((a, s) => a + s.duration, 0),
          layout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
          who: [...e.scripts]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 2)
            .map((x) => `${x.invoker} ${x.sourceURL.replace(/^.*\//, '').replace(/\?.*$/, '')}:${x.sourceFunctionName} ${Math.round(x.duration)}ms`)
            .join('; '),
        })
      }
    }).observe({ type: 'long-animation-frame' })
  })
}

/**
 * 淡入期間的幀：Dashboard 第一次出現（含那一幀前面的空檔）起，到第一次全亮為止。
 * 用 trace 的幀（ResizeObserver 每幀一筆）而不是只看長幀紀錄：整個瀏覽器被系統排擠時（平行跑十個 worker、防毒掃描）
 * 主執行緒根本沒在跑，不會留下長幀紀錄，只看得到幀與幀之間隔很久。
 */
function fadeFrames(tr: Trace): Trace['frames'] {
  const first = tr.frames.findIndex((f) => f.boxes.dash)
  const full = tr.frames.findIndex((f) => (f.boxes.dash?.o ?? 0) >= 1)
  return first < 0 ? [] : tr.frames.slice(first, full < 0 ? undefined : full + 1)
}

/** 淡入期間重疊到的長幀紀錄（失敗訊息用）。 */
function fadeLongFrames(tr: Trace, loafs: Loaf[]): Loaf[] {
  const fs = fadeFrames(tr)
  if (!fs.length) return []
  const from = fs[0]!.t - fs[0]!.dt
  const to = fs[fs.length - 1]!.t
  return loafs.filter((l) => l.end > from && l.start < to && l.end - l.start > LONG_FRAME_MS)
}

/**
 * K1 前提用的幀間隔門檻：超過兩個 60Hz 幀（33.3ms）就算一段空檔。淡入只有 180ms，連續幾幀 40–50ms 就只剩兩個中間值，
 * 所以比 G9 的 LONG_FRAME_MS（50ms）嚴；50ms 以下的長幀沒有長幀紀錄可歸因，一律當外部。
 */
const FADE_GAP_MS = 34

/**
 * K1 前提：淡入期間每一段超過 FADE_GAP_MS 的幀間隔，都是 App 自己造成的（同時段有 App script ≥ 10ms 的長幀）。
 * 其他的間隔是外部的：平行跑的其他 worker、防毒搶 CPU / GPU，主執行緒沒在跑、或樣式繪製被拖長（CPU 降速 4 倍單獨跑時，
 * 淡入期間每幀 17ms、主執行緒幾乎沒事；繪製在淡入起步前的透明幀就做完了）。transition 照時間往前走、吃掉中間值，
 * 那不是掛載成本的問題——回總覽重來。App 自己的長幀照樣算失敗（這正是 K1 要修的）。
 */
function externalLongFrameDuringFade(tr: Trace, loafs: Loaf[]): boolean {
  return fadeFrames(tr).some(
    (f) => f.dt > FADE_GAP_MS && !loafs.some((l) => l.app >= 10 && l.end > f.t - f.dt && l.start < f.t),
  )
}

/** 失敗訊息用：淡入期間的長幀（起訖、App script、樣式版面、最長的 script）。 */
const fmtLoafs = (ls: Loaf[]): string =>
  ls.map((l) => `[${Math.round(l.start)}–${Math.round(l.end)} app ${Math.round(l.app)} layout ${Math.round(l.layout)} ${l.who}]`).join(' ')

/**
 * 掛載成本（K1）：第一次從總覽進 Dashboard，淡入要照常有中間值（≥ 3 幀）。
 * 修正前掛載之後還有 App 的長幀（甘特在掛載後 60ms 才捲到今天、捲動逼出整頁版面），機器忙時把淡入吃掉、卡幾幀就全亮。
 * 前提檢查見 externalLongFrameDuringFade：只有外部長幀才重來，最多 3 次。
 */
/**
 * 錄「第一次從總覽進 Dashboard」；淡入期間碰上外部長幀就回總覽（重新載入）重來，最多 3 次。
 * 開頁用 helpers/ovMotion 的 gotoOverview（只固定 Date）：OverviewPage.goto 的 clock.setFixedTime 連計時器與
 * requestIdleCallback 一起換成模擬，延後掛的面板會在「下一輪」就掛、不等真的空閒，量到的不是真實排程。
 */
async function traceFirstEnter(page: Page): Promise<{ tr: Trace; valid: boolean; loafs: Loaf[] }> {
  let tr!: Trace
  let valid = false
  let loafs: Loaf[] = []
  for (let attempt = 0; attempt < 3 && !valid; attempt++) {
    await gotoOverview(page)
    tr = await trace(
      page,
      TARGETS,
      async () => {
        await watchLongFrames(page)
        return clickInPage(page, ENTER)
      },
      { ms: 2000 },
    )
    loafs = await page.evaluate(() => (window as unknown as { __loafs: Loaf[] }).__loafs)
    valid = !externalLongFrameDuringFade(tr, loafs)
  }
  return { tr, valid, loafs: fadeLongFrames(tr, loafs) }
}

test('K1 第一次從總覽進 Dashboard：掛載之後淡入照常有中間值（≥ 3 幀），不卡幾幀就直接全亮', async ({ page }) => {
  const { tr, valid, loafs } = await traceFirstEnter(page)
  expect(valid, '3 次淡入期間都碰上 App 以外的長幀（機器太忙）').toBe(true)
  const os = series(tr, 'dash').map((b) => b.o)
  const full = os.indexOf(1)
  const detail = `${(full < 0 ? os : os.slice(0, full + 1)).map((o) => o.toFixed(2)).join(' ')}；淡入期間長幀 ${fmtLoafs(loafs)}`
  // 修正前（keyframes）實測 0.00 → 0.02 → 0.11 → 1.00；transition 但掛載後還有長幀時，機器忙時 0.00 → 0.31 → 1.00
  expect(os.filter((o) => o > 0.05 && o < 0.95).length, `淡入的中間值幀數（${detail}）`).toBeGreaterThanOrEqual(3)
  expect(os.at(-1), `淡入結束是全亮（${detail}）`).toBe(1)
  expect(
    os.every((o, i) => i === 0 || o >= os[i - 1]! - 0.02),
    `淡入一路往上（${detail}）`,
  ).toBe(true)
})
