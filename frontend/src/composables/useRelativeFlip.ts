import { onBeforeUpdate, onUpdated, toValue, type MaybeRefOrGetter } from 'vue'
import type { LeaveRect } from '@/composables/freezeLeave'
import { tokenMs, tokenValue } from '@/composables/motionTokens'
import { currentTranslate, FLIP_ID } from '@/lib/transform'

/**
 * 元素目前看得到的縮放（含進行中的過渡與動畫），沒有縮放回 1。卡片的進出場只有等比縮放，取 x 方向。
 * 瀏覽器讀 computed transform 的 a（m11）；jsdom 沒有 DOMMatrix 也不算動畫，退回解析 inline 的 matrix() / scale()。
 */
export function currentScale(el: Element): number {
  const t = getComputedStyle(el).transform || (el as HTMLElement).style?.transform || ''
  if (!t || t === 'none') return 1
  if (typeof DOMMatrixReadOnly !== 'undefined') return new DOMMatrixReadOnly(t).a
  const v = (/matrix\(([^,)]+)/.exec(t) ?? /scale\(([^,)]+)/.exec(t))?.[1]
  return v === undefined ? 1 : Number(v)
}

/**
 * 播一段 FLIP：從看得到的位移與縮放補間回版面位置（Web Animations、composite: 'add'、只動 transform、id = FLIP_ID），先取消上一段。
 * 縮放也放進同一段：Chromium 的 composite add 不會疊在進行中的 CSS transform 過渡上（實測：疊上去的期間進場的 scale
 * 過渡整段看不到，卡片當幀變回原尺寸），所以把當下看得到的縮放帶進起點，由這段補到原尺寸；沒有縮放時只播位移。
 * 給 useRelativeFlip 的重排與 useFreezeReenter 回來的卡共用（freezeLeave 取消位移時認 FLIP_ID）。
 * @param ms 時長；0（reduced motion）只取消不播
 * @param easing Web Animations 的 easing 字串
 */
export function playFlip(el: HTMLElement, from: { dx: number; dy: number; scale: number }, ms: number, easing: string): void {
  // jsdom 沒有 getAnimations / animate
  for (const a of el.getAnimations?.() ?? []) if (a.id === FLIP_ID) a.cancel()
  if (!ms || typeof el.animate !== 'function') return
  const scaled = Math.abs(from.scale - 1) > 0.001
  el.animate(
    [
      { transform: `translate(${from.dx}px, ${from.dy}px)${scaled ? ` scale(${from.scale})` : ''}` },
      { transform: `translate(0px, 0px)${scaled ? ' scale(1)' : ''}` },
    ],
    { duration: ms, easing, composite: 'add', id: FLIP_ID },
  )
}

/**
 * 以「相對於容器」的位移做 FLIP 重排動畫，給巢狀在另一個會移動的容器裡的清單用
 * （卡片檢視的泳道內卡片、時間軸的群組內專案列）。
 *
 * 為什麼不用 TransitionGroup 內建的 move：它量頁面上的絕對位置，外層泳道 / 群組自己也在移動時會把外層的位移再算一次。
 * 這裡量 offsetTop / offsetLeft（相對容器，容器必須 position: relative），外層怎麼動都不影響。
 *
 * 起點用「看得到的位置與縮放」＝版面位置 ＋ 目前的 translate、目前的 scale：上一段 FLIP 還沒跑完就又重排（打字打到一半刪掉），
 * 從半路接續而不是先瞬移到上一個終點（T4）；進場放大中的卡被重排，縮放也從當下接續（見 playFlip）。
 * 只有版面位置真的變了才重新起跳：篩選結果沒變的重新渲染不打斷進行中的位移。
 * 位移用 Web Animations（composite: 'add'、只動 transform），不寫 inline transition：寫了會蓋掉 class 上的進出場過渡
 * （淡入中的卡直接變實心 T5、列外層的原地收合直接到位），Vue 判斷內建 move 時複製第一個子元素也會連 inline 一起複製。
 * 用法：容器內 TransitionGroup 的 move-class 指到 `ov-card-still` / `ov-row-still`（overview-motion.css）停用內建 move。
 * 時序：本元件的 onBeforeUpdate 在 DOM 更新前記位置；onUpdated 在子元件（TransitionGroup）之後執行，量到的是更新後的版面。
 * 離場元素在這時的版面依清單而不同：
 * - 卡片（PmLane）：離場的卡已被 freezeLeave 釘成 absolute、不佔版面，留下的卡量到的就是終點。
 * - 時間軸的列（TimelineGroup）：原地收合，離場的列不釘位、留在版面流裡，量的當下還是全高（收合從這一幀才開始，見 useCollapseReenter 的 startLeaveNow），
 *   留下的列量到的位置含著它；之後它收起時，下面的列由版面帶著上移，不是這裡的 FLIP。
 * 離場中的元素不量也不動；同一個 key 離場中又回來的新元素由 useFreezeReenter（卡片）/ useCollapseReenter（列）接續
 * （它在更新前不在，這裡當新進場略過）。
 *
 * @param container 清單容器（元素的 offsetParent）
 * @param keyAttr 用來對應新舊元素的屬性名，例如 `data-project`
 * @param duration 時長：token 名（預設 `--t-panel`）或毫秒數（單元測試用）；曲線一律 `--ease`
 * @returns snapshotOf：更新前的位置，給同一次 patch 版面已先改掉的離場元素釘位用（freezeLeave 的 rectOf）
 */
export function useRelativeFlip(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  keyAttr: string,
  duration: string | number = '--t-panel',
): { snapshotOf: (el: Element) => LeaveRect | undefined } {
  /** 更新前看得到的位置，與當時的版面位置（offset，不含 translate）。 */
  let before = new Map<string, { seen: LeaveRect; top: number; left: number }>()
  let byEl = new WeakMap<Element, LeaveRect>()

  /** 容器裡留下的元素（離場中的不算：它們由 freezeLeave 釘在原位）。 */
  function items(): HTMLElement[] {
    const el = toValue(container)
    if (!el) return []
    return Array.from(el.children).filter(
      (c): c is HTMLElement =>
        c instanceof HTMLElement &&
        c.hasAttribute(keyAttr) &&
        !Array.from(c.classList).some((k) => k.endsWith('-leave-active')),
    )
  }

  onBeforeUpdate(() => {
    before = new Map()
    byEl = new WeakMap()
    for (const el of items()) {
      const t = currentTranslate(el)
      const top = el.offsetTop
      const left = el.offsetLeft
      const seen = { top: top + t.y, left: left + t.x, width: el.offsetWidth, height: el.offsetHeight }
      before.set(el.getAttribute(keyAttr)!, { seen, top, left })
      byEl.set(el, seen)
    }
  })

  onUpdated(() => {
    const ms = typeof duration === 'number' ? duration : tokenMs(duration)
    const easing = tokenValue('--ease') || 'ease'
    const moved: { el: HTMLElement; dx: number; dy: number; scale: number }[] = []
    // 先全部讀完再動，避免讀寫交錯逼瀏覽器反覆重排
    for (const el of items()) {
      const old = before.get(el.getAttribute(keyAttr)!)
      if (!old) continue // 新進場的交給 enter 過渡（同 key 回來的交給 useFreezeReenter）
      const top = el.offsetTop
      const left = el.offsetLeft
      // 版面位置沒變（打字但篩選結果不變也會重新渲染）：進行中的 FLIP 終點沒變，照跑；從頭起跳會讓卡片頓一下再重新加速
      if (Math.abs(old.left - left) + Math.abs(old.top - top) < 0.5) continue
      moved.push({ el, dx: old.seen.left - left, dy: old.seen.top - top, scale: currentScale(el) })
    }
    for (const { el, ...from } of moved) playFlip(el, from, ms, easing)
  })

  return { snapshotOf: (el) => byEl.get(el) }
}
