import type { Page } from '@playwright/test'

/**
 * 逐幀量測的共用工具（動畫稽核批次 D，docs/incidents/2026-09-30-motion-audit）。
 *
 * 取樣時機同 gantt-motion.spec 的 trace：ResizeObserver 回呼在所有 rAF 回呼與版面計算之後、paint 之前，
 * 量到的就是這一幀真的會畫出來的樣子。每幀重新用選擇器找元素，元素被換掉也追得到。
 */

/** 一幀裡某個元素的量測。 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
  /** 中心 x：開關動畫的 scale 以中心為原點，比位置要比這個，不受縮放影響。 */
  cx: number
  /** 實際看到的透明度：自己與所有祖先的 opacity 相乘（過渡可能寫在外層的遮罩或 layer 上）。 */
  o: number
  /** computed pointer-events（離場中要是 none）。 */
  pe: string
  /** 符合選擇器的元素數（離場中的舊元素與新元素並存時 > 1）。量測取最後一個。 */
  n: number
}

export interface Frame {
  /** 從開始記錄算起的 ms。 */
  t: number
  /** 與上一幀的間隔（ms）。 */
  dt: number
  /** 名稱 → 量測；null = 這一幀不在畫面上（不存在或 display:none）。 */
  boxes: Record<string, Box | null>
}

export interface Trace {
  frames: Frame[]
  /**
   * action 開始的時間（同 Frame.t 的基準）：action 回傳頁內時間時以它為準，否則是 action 送出前的時間。
   * 後者到頁面真的收到動作之間隔著 Playwright 的往返，可能夾著一幀動作前的畫面——要看「動作之後每一幀」的斷言，
   * action 請用 clickInPage 這類回傳頁內時間的寫法。
   */
  at: number
}

type TraceState = { t0: number; frames: Frame[]; stop: boolean }

/** 開 Dashboard（不固定時鐘），等甘特左欄畫出來、進場動畫跑完。 */
export async function openDashboard(page: Page): Promise<void> {
  await page.goto('/projects/pmis')
  await page.locator('[data-rowtask]').first().waitFor()
  await idle(page)
}

/** 在頁面裡等 ms（用頁面自己的計時器，不是 Node 端的）。 */
export async function pause(page: Page, ms: number): Promise<void> {
  await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), ms)
}

/** 等到頁面上沒有「有限長度且正在跑」的動畫 / 過渡（無限循環的不算），再多等 50ms。 */
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

/**
 * 逐幀記錄一組元素，期間執行 action；action 前先錄 80ms 當起點，之後再錄 ms。
 * action 回傳頁內時間（例：clickInPage 的回傳值）時，at 以它為準；否則 at 是 action 送出前的時間。
 */
export async function trace(
  page: Page,
  targets: Record<string, string>,
  action: () => Promise<unknown>,
  { ms = 700 }: { ms?: number } = {},
): Promise<Trace> {
  await page.evaluate((targets) => {
    const state: TraceState = { t0: performance.now(), frames: [], stop: false }
    ;(window as unknown as { __trace: TraceState }).__trace = state
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;visibility:hidden'
    document.body.appendChild(probe)
    let last = state.t0
    const ro = new ResizeObserver(() => {
      // 這一幀的開始時間（動畫時鐘），不是回呼當下：CSS 過渡照它推進；負載下某幀晚了、下一幀緊接著來時，
      // 回呼時間只差幾 ms，拿它算速度會算出假的突變（批次③：ov-leave 連刪 chip 在平行跑時的誤判）
      const now = (document.timeline.currentTime as number | null) ?? performance.now()
      const boxes: Record<string, Box | null> = {}
      for (const [name, sel] of Object.entries(targets)) {
        const all = document.querySelectorAll(sel)
        const el = all[all.length - 1]
        const cs = el ? getComputedStyle(el) : null
        if (!el || !cs || cs.display === 'none') {
          boxes[name] = null
          continue
        }
        let o = 1
        for (let n: Element | null = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity)
        const r = el.getBoundingClientRect()
        boxes[name] = { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, o, pe: cs.pointerEvents, n: all.length }
      }
      state.frames.push({ t: now - state.t0, dt: now - last, boxes })
      last = now
    })
    ro.observe(probe)
    // 每幀改一次 probe 的寬度，ResizeObserver 才會每幀都回呼
    let flip = false
    const tick = (): void => {
      if (state.stop) {
        ro.disconnect()
        probe.remove()
        return
      }
      flip = !flip
      probe.style.width = flip ? '2px' : '1px'
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, targets)
  await pause(page, 80)
  const sent = await page.evaluate(() => performance.now() - (window as unknown as { __trace: TraceState }).__trace.t0)
  const ret = await action()
  await pause(page, ms)
  const frames = await page.evaluate(() => {
    const s = (window as unknown as { __trace: TraceState }).__trace
    s.stop = true
    return s.frames
  })
  return { frames, at: typeof ret === 'number' ? ret : sent }
}

/** 某個元素在畫面上的每一幀（不在畫面上的幀略過）。 */
export function series(tr: Trace, name: string): (Box & { t: number; dt: number })[] {
  return tr.frames.filter((f) => f.boxes[name]).map((f) => ({ ...f.boxes[name]!, t: f.t, dt: f.dt }))
}

/** 有沒有 0.05～0.95 的中間透明度（有過渡、不是瞬間出現 / 消失）。 */
export function hasMid(os: number[]): boolean {
  return os.some((o) => o > 0.05 && o < 0.95)
}

/** 最亮的值，與過了最亮之後又變亮（> 0.02）的幀數。 */
export function peakThenFall(os: number[]): { peak: number; rises: number } {
  if (!os.length) return { peak: 0, rises: 0 }
  const peak = Math.max(...os)
  const at = os.indexOf(peak)
  let rises = 0
  for (let i = at + 1; i < os.length; i++) if (os[i]! > os[i - 1]! + 0.02) rises++
  return { peak, rises }
}

type Pinia = { _s: Map<string, Record<string, unknown>> }
type AppEl = { __vue_app__: { config: { globalProperties: { $pinia: Pinia } } } }

/** 直接呼叫 ui store 的 action（卡片在平滑捲動中或被 Modal 蓋住時點不穩；稽核腳本同法）。 */
export async function ui(page: Page, fn: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(
    ({ fn, args }) => {
      const store = (document.querySelector('#app') as unknown as AppEl).__vue_app__.config.globalProperties.$pinia._s.get('ui')!
      ;(store[fn] as (...a: unknown[]) => void)(...args)
    },
    { fn, args },
  )
}

/** 直接寫 ui store 的欄位（例：Lightbox 沒有範例圖片可點，直接開）。 */
export async function uiSet(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      ;(document.querySelector('#app') as unknown as AppEl).__vue_app__.config.globalProperties.$pinia._s.get('ui')![key] = value
    },
    { key, value },
  )
}

/** 從看板卡片的 ⤢ 開任務詳情，等開啟動畫跑完。 */
export async function openTaskDetail(page: Page, id: string): Promise<void> {
  const caret = page.locator(`[data-card="${id}"] .caret`)
  await caret.scrollIntoViewIfNeeded()
  await caret.click()
  await page.locator('.detail-modal').waitFor()
  await idle(page)
}

/** 從甘特列的「⋮」→「相依設定…」開相依編輯器，等開啟動畫跑完。 */
export async function openDepEditor(page: Page, id: string): Promise<void> {
  const more = page.locator(`[data-rowmore="${id}"]`)
  await more.scrollIntoViewIfNeeded()
  await more.click()
  await page.locator('[data-rowmenu] .rm-item', { hasText: '相依設定' }).click()
  await page.locator('.dep-editor').waitFor()
  await idle(page)
}

/**
 * 頁內直接點（不等 Playwright 往返），可選 ms 毫秒後再點第二個。
 * 回傳第一下點下去的頁內時間（同 trace 的時間基準）：當作 trace 的 action 回傳值時，trace 的 at 就是實際點擊的時間。
 */
export async function clickInPage(page: Page, sel: string, then?: { sel: string; ms: number }): Promise<number> {
  return page.evaluate(
    ({ sel, then }) => {
      const tr = (window as unknown as { __trace?: TraceState }).__trace
      const at = tr ? performance.now() - tr.t0 : 0
      ;(document.querySelector(sel) as HTMLElement).click()
      if (then) setTimeout(() => (document.querySelector(then.sel) as HTMLElement | null)?.click(), then.ms)
      return at
    },
    { sel, then },
  )
}
