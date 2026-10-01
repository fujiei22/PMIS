import { tokenMs, tokenValue } from '@/composables/motionTokens'
import { parseEasing } from '@/lib/easing'

export interface Timing { duration: number; ease: (p: number) => number }

/** 補間中的元素 → rAF id（再 hold 或再 release 時先停掉上一段）。 */
const running = new WeakMap<HTMLElement, number>()

/** 預設時長與曲線：--t-panel / --ease（執行期讀，reduced motion 把 token 設 0 就直接放開）。 */
function panelTiming(): Timing {
  return { duration: tokenMs('--t-panel'), ease: parseEasing(tokenValue('--ease')) }
}

function stop(el: HTMLElement): void {
  const id = running.get(el)
  if (id !== undefined) cancelAnimationFrame(id)
  running.delete(el)
}

/** 把高度寫死成現在看得到的值（內容要換之前呼叫）；補間中就停在當下。 */
export function holdHeight(el: HTMLElement | null | undefined): void {
  if (!el) return
  stop(el)
  el.style.height = `${el.getBoundingClientRect().height}px`
}

/**
 * 從寫死的高度補間到內容的自然高度，結束清掉 inline height。
 *
 * 撐高度的四個地方（泳道內卡片網格、卡片 / 時間軸 ↔ 空狀態、切檢視、速覽同列換卡）共用這一套（plan review Design M7）：
 * 每幀重量自然高度——容器裡還有別的過渡（展開中的卡被篩掉、抽屜在收）時目標會變，量一次就釘住會在結束那幀縮掉一截；
 * 時長與曲線預設執行期讀 token（--t-panel、--ease），token 是 0 就直接放開；靠時間收尾、不靠 transitionend，不會卡住。
 * 放開當下內容高度沒變（重新渲染但卡片沒進出）就直接清掉、不補間：每個補間每幀都要逼一次版面計算，
 * 篩選時每條泳道都會重新渲染；之後內容自己的過渡（抽屜開合）不撐住就是逐幀跟著走。
 * timing 可直接給（單元測試用，同批次 A 的 useRowMotion）。
 */
export function releaseHeight(el: HTMLElement | null | undefined, timing: Timing = panelTiming()): void {
  if (!el) return
  stop(el)
  const { duration: dur, ease } = timing
  if (!dur || !el.style.height) {
    el.style.height = ''
    return
  }
  const from = parseFloat(el.style.height)
  /**
   * 暫時拿掉 inline height 量自然高度。量的那次強制版面計算裡頁面會變矮：頁面捲在底部時瀏覽器當下就把捲動夾到新的底，
   * 之後每幀量都再夾一次，補間對被夾的捲動完全無效（平板捲到底切檢視時 scrollY 一幀 110 → 0）。
   * 所以量之前用 html 的 min-height 撐住現在的頁高，量完還原成原值（不是清空：別處可能也設了）。
   */
  const natural = (): number => {
    const held = el.style.height
    const html = document.documentElement
    const prev = html.style.minHeight
    html.style.minHeight = `${html.scrollHeight}px`
    try {
      el.style.height = ''
      return el.getBoundingClientRect().height
    } finally {
      el.style.height = held
      html.style.minHeight = prev
    }
  }
  if (Math.abs(natural() - from) < 0.5) {
    el.style.height = ''
    return
  }
  const t0 = performance.now()
  const step = (now: number): void => {
    const p = Math.min(1, (now - t0) / dur)
    if (p >= 1) {
      el.style.height = ''
      running.delete(el)
      return
    }
    el.style.height = `${from + (natural() - from) * ease(p)}px`
    running.set(el, requestAnimationFrame(step))
  }
  running.set(el, requestAnimationFrame(step))
}
