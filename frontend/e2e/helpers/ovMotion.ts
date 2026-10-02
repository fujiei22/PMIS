import type { Page } from '@playwright/test'
import { FIXED_NOW } from './clock'

/**
 * 總覽逐幀量測（動畫稽核批次 B，docs/incidents/2026-09-30-motion-audit）。
 * 取樣同 gantt-motion.spec 的 trace：ResizeObserver 回呼在 rAF 與版面計算之後、paint 之前，量到的就是這一幀畫出來的樣子。
 */

export interface Box { x: number; y: number; w: number; h: number; /** 自己的 computed opacity */ o: number }
export interface Frame {
  /** 從開始記錄算起的 ms。 */
  t: number
  /** 與上一幀的間隔（ms）。 */
  dt: number
  /** 這一幀的 scrollY。 */
  sy: number
  boxes: Record<string, Box | null>
}
export interface Trace { frames: Frame[]; /** action 開始的時間（同 Frame.t 基準） */ at: number }
type State = { t0: number; frames: Frame[]; stop: boolean }

/**
 * 開總覽，只把「現在」換成 FIXED_NOW（之後照真實時間往前走）：總覽的「需注意」、進度與時間軸範圍都跟今天有關。
 * 不用 OverviewPage.goto 的 clock.setFixedTime：它把 rAF / performance.now / setTimeout 一起換成模擬，
 * 逐幀量到的不是真的畫面幀，App 自己的 rAF 補間也不和繪製對齊（plan review Eng m1）。
 */
export async function gotoOverview(page: Page, hash = ''): Promise<void> {
  await page.addInitScript((fixed: number) => {
    const Real = Date
    const offset = fixed - Real.now()
    function FixedDate(...args: unknown[]): unknown {
      const d = args.length
        ? new (Real as unknown as new (...a: unknown[]) => Date)(...args)
        : new Real(Real.now() + offset)
      return new.target ? d : d.toString()
    }
    FixedDate.prototype = Real.prototype
    FixedDate.now = (): number => Real.now() + offset
    FixedDate.parse = Real.parse
    FixedDate.UTC = Real.UTC
    ;(globalThis as unknown as { Date: unknown }).Date = FixedDate
  }, FIXED_NOW.getTime())
  await page.goto('/' + hash)
  await page.locator('[data-view="overview"] [data-view-panel]').first().waitFor()
  await idle(page)
}

export async function pause(page: Page, ms: number): Promise<void> {
  await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), ms)
}

/** 等到沒有「有限長度且正在跑」的動畫 / 過渡，再多等 50ms。 */
export async function idle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity),
    null,
    { polling: 50, timeout: 5000 },
  )
  await pause(page, 50)
}

/** 把 selector 目前符合的元素標上 data-probe="<prefix><i>"，回傳追蹤用的選擇器（離場移除後就找不到）。 */
export async function probe(page: Page, selector: string, prefix: string): Promise<string[]> {
  const n = await page.evaluate(
    ({ selector, prefix }) => {
      const els = [...document.querySelectorAll(selector)]
      els.forEach((el, i) => el.setAttribute('data-probe', `${prefix}${i}`))
      return els.length
    },
    { selector, prefix },
  )
  return Array.from({ length: n }, (_, i) => `[data-probe="${prefix}${i}"]`)
}

/** 逐幀記錄一組元素與 scrollY，期間執行 action；action 前先錄 80ms，之後再錄 ms。 */
export async function trace(
  page: Page,
  targets: Record<string, string>,
  action: () => Promise<unknown>,
  { ms = 900 }: { ms?: number } = {},
): Promise<Trace> {
  await page.evaluate((targets) => {
    const state: State = { t0: performance.now(), frames: [], stop: false }
    ;(window as unknown as { __ovTrace: State }).__ovTrace = state
    const probeEl = document.createElement('div')
    probeEl.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;visibility:hidden'
    document.body.appendChild(probeEl)
    let last = state.t0
    const ro = new ResizeObserver(() => {
      const now = performance.now()
      const boxes: Record<string, Box | null> = {}
      for (const [name, sel] of Object.entries(targets)) {
        const el = document.querySelector(sel)
        const cs = el ? getComputedStyle(el) : null
        if (!el || !cs || cs.display === 'none') {
          boxes[name] = null
          continue
        }
        const r = el.getBoundingClientRect()
        boxes[name] = { x: r.left, y: r.top, w: r.width, h: r.height, o: parseFloat(cs.opacity) }
      }
      state.frames.push({ t: now - state.t0, dt: now - last, sy: scrollY, boxes })
      last = now
    })
    ro.observe(probeEl)
    // 每幀改一次 probe 的寬度，ResizeObserver 才會每幀都回呼
    let flip = false
    const tick = (): void => {
      if (state.stop) {
        ro.disconnect()
        probeEl.remove()
        return
      }
      flip = !flip
      probeEl.style.width = flip ? '2px' : '1px'
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, targets)
  await pause(page, 80)
  const at = await page.evaluate(() => performance.now() - (window as unknown as { __ovTrace: State }).__ovTrace.t0)
  await action()
  await pause(page, ms)
  const frames = await page.evaluate(() => {
    const s = (window as unknown as { __ovTrace: State }).__ovTrace
    s.stop = true
    return s.frames
  })
  return { frames, at }
}

/** 某個元素在畫面上的每一幀（不在的幀略過）；from 之前的只留最後一幀當起點。 */
export function series(tr: Trace, name: string, from = -Infinity): (Box & { t: number; dt: number; sy: number })[] {
  const shown = tr.frames.filter((f) => f.boxes[name]).map((f) => ({ ...f.boxes[name]!, t: f.t, dt: f.dt, sy: f.sy }))
  const before = shown.filter((b) => b.t < from).at(-1)
  return (before ? [before] : []).concat(shown.filter((b) => b.t >= from))
}

/** scrollY 的逐幀序列。 */
export function scrollSeries(tr: Trace, from = -Infinity): { t: number; dt: number; v: number }[] {
  return tr.frames.filter((f) => f.t >= from).map((f) => ({ t: f.t, dt: f.dt, v: f.sy }))
}

const span = (vs: number[]): number => (vs.length ? Math.max(...vs) - Math.min(...vs) : 0)

/**
 * 單幀跳動：間隔正常（dt < 25ms）的幀裡，變化超過全距 ratio 的次數。
 * --ease 最陡一幀約走兩成，前一幀卡住時最多約四成；瞬移是一次走完大部分（稽核量到 68%–100%）。
 * 分母用全距：跳走又跳回的淨變化很小，用淨變化會放過（plan review Eng m2）。全距 < 4px 視為沒動。
 */
export function jumpCount(pts: { dt: number; v: number }[], ratio = 0.5): number {
  const range = span(pts.map((p) => p.v))
  if (range < 4) return 0
  return pts.filter((p, i) => i > 0 && p.dt < 25 && Math.abs(p.v - pts[i - 1]!.v) > ratio * range).length
}

/**
 * 速度不連續（捲動、黏住的標頭這類由瀏覽器夾出來的位置）：單幀變化 > 8px，且速度（Δ/dt）大於前後兩幀各 2.5 倍。
 * 頁面在底部變短時捲動一定會被往上夾，逐幀跟著內容夾就是連續的（plan review Design M6）。
 */
export function speedJumps(pts: { t: number; v: number }[]): number {
  const sp = pts.map((p, i) => (i === 0 ? 0 : Math.abs(p.v - pts[i - 1]!.v) / Math.max(1, p.t - pts[i - 1]!.t)))
  let n = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.abs(pts[i]!.v - pts[i - 1]!.v)
    const prev = sp[i - 1] ?? 0
    const next = sp[i + 1] ?? 0
    if (d > 8 && sp[i]! > 2.5 * prev && sp[i]! > 2.5 * next) n++
  }
  return n
}

/** 朝終點走的途中往回超過 tol（px）。 */
export function reverses(vs: number[], tol = 2): boolean {
  if (vs.length < 2) return false
  const dir = Math.sign(vs[vs.length - 1]! - vs[0]!)
  return vs.some((v, i) => i > 0 && (v - vs[i - 1]!) * dir < -tol)
}

/**
 * 結尾瞬移：最後一次有變化（> 0.3px）的那一幀，變化量超過 max(2px, 前一次變化的 3 倍)。
 * user 在 demo 看到的「過渡結束前小幅瞬移到終點」就是這種：前面每幀動 0.3px，最後一幀跳 6px。
 */
export function endSnap(vs: number[]): boolean {
  const steps = vs.map((v, i) => (i === 0 ? 0 : Math.abs(v - vs[i - 1]!))).filter((d) => d > 0.3)
  if (steps.length < 2) return false
  const last = steps[steps.length - 1]!
  return last > Math.max(2, 3 * steps[steps.length - 2]!)
}

/** 錄製的最後 ms 毫秒內值不再變（±0.5）：過渡結束後不會再多跳一次。 */
export function settledFor(pts: { t: number; v: number }[], ms = 150): boolean {
  if (!pts.length) return false
  const end = pts[pts.length - 1]!
  const tail = pts.filter((p) => p.t >= end.t - ms)
  return end.t - pts[0]!.t >= ms && tail.every((p) => Math.abs(p.v - end.v) <= 0.5)
}

/** 看得見（o > 0.05）期間，中心點離第一幀最遠多少 px；樣本不足 2 幀回 NaN（呼叫端要斷言有樣本）。 */
export function drift(boxes: Box[]): number {
  const cs = boxes.filter((b) => b.o > 0.05).map((b) => [b.x + b.w / 2, b.y + b.h / 2] as const)
  if (cs.length < 2) return NaN
  return Math.max(...cs.map(([x, y]) => Math.hypot(x - cs[0]![0], y - cs[0]![1])))
}

/** 單幀透明度跳 > 0.35（dt < 34 的幀才算）。 */
export function opacityJumps(pts: { dt: number; o: number }[]): boolean {
  return pts.some((p, i) => i > 0 && p.dt < 34 && Math.abs(p.o - pts[i - 1]!.o) > 0.35)
}
