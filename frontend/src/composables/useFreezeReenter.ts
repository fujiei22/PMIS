import { onBeforeUpdate, onUpdated, toValue, type MaybeRefOrGetter } from 'vue'
import { tokenMs, tokenValue } from '@/composables/motionTokens'
import { currentScale, playFlip } from '@/composables/useRelativeFlip'
import { currentTranslate } from '@/lib/transform'

/** 更新前量到的離場中元素（freezeLeave 釘住的）：元素本身、看得到的位置（版面位置 ＋ translate）、透明度、縮放。 */
interface Leaving {
  el: Element
  top: number
  left: number
  o: number
  s: number
}

const isLeaving = (el: Element): boolean => Array.from(el.classList).some((k) => k.endsWith('-leave-active'))

/**
 * 釘位離場的清單（泳道內的卡片，離場由 freezeLeave 釘在原位淡出）：同一個 key 在離場途中又回來時，
 * 新元素從舊元素當下看得到的位置、透明度與縮放接續，補間回自己的格子。
 *
 * 為什麼要：Vue 會先把離場中的舊元素移除，新元素照 class 從透明、縮小（enter-from）在自己的格子重新淡入——
 * 淡出到一半的卡一幀消失、再從頭淡入（R3）；舊卡若是移動途中被篩掉，釘在半路，新卡還會一幀跳回自己的格子。
 * 那時舊元素已量不到，所以在清單更新前先量好。
 *
 * 怎麼接：
 * - 透明度與縮放交給 class 的進場過渡（ov-card-enter-active）：先關過渡、拿掉 enter-from、寫起點、強制算一次樣式，
 *   再交還過渡、清掉 inline——下一次算樣式就從起點往 1 / 原尺寸過渡，不等 Vue 兩幀後才換 enter-to（等的話會多停在起點，同 useCollapseReenter）。
 *   用 CSS 過渡、不用 Web Animations：又被篩掉時 freezeLeave 留著只有縮放的過渡、接續到離場的淡出縮小；
 *   Web Animations 的優先序比 CSS 過渡高，留著的話會蓋掉離場的淡出。
 * - 舊卡釘在別處（版面位置不同）時另播一段 FLIP（playFlip：位移 ＋ 同一個縮放起點，id = FLIP_ID）。Chromium 的 composite add
 *   不疊在進行中的 CSS transform 過渡上，FLIP 期間由它接手縮放；兩段同時長、同曲線，FLIP 被取消（又被篩掉、又重排）時，
 *   CSS 的縮放過渡正好在同一個地方接手。
 * useRelativeFlip 不量離場中的元素、也不動新進場的元素，兩者不重疊。
 *
 * 時序（同 useRelativeFlip）：本元件的 onBeforeUpdate 在清單更新前量；onUpdated 在清單（TransitionGroup）更新之後執行，
 * 這時舊元素已被移除、新元素已插入（帶著 enter-from / enter-active），還沒畫出來。
 *
 * @param container 清單容器（元素的 offsetParent，同 useRelativeFlip）
 * @param keyAttr 用來對應新舊元素的屬性名，例如 `data-project`
 * @param duration FLIP 時長：token 名（預設 `--t-panel`，同卡片的進出場過渡）或毫秒數（單元測試用）；曲線一律 `--ease`
 */
export function useFreezeReenter(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  keyAttr: string,
  duration: string | number = '--t-panel',
): void {
  let leaving = new Map<string, Leaving>()

  // 清單更新前：記下離場中元素看得到的樣子（這時還沒有任何 class 在換，讀樣式不會打斷進行中的過渡）
  onBeforeUpdate(() => {
    leaving = new Map()
    for (const c of Array.from(toValue(container)?.children ?? [])) {
      const key = c.getAttribute(keyAttr)
      if (!key || !isLeaving(c) || !(c instanceof HTMLElement)) continue
      const t = currentTranslate(c)
      const o = parseFloat(getComputedStyle(c).opacity)
      leaving.set(key, { el: c, top: c.offsetTop + t.y, left: c.offsetLeft + t.x, o: Number.isNaN(o) ? 1 : o, s: currentScale(c) })
    }
  })

  onUpdated(() => {
    if (!leaving.size) return
    const back: { el: HTMLElement; snap: Leaving; dx: number; dy: number }[] = []
    // 先全部讀完再寫
    for (const c of Array.from(toValue(container)?.children ?? [])) {
      const snap = leaving.get(c.getAttribute(keyAttr) ?? '')
      if (!snap || snap.el === c || isLeaving(c) || !(c instanceof HTMLElement)) continue
      back.push({ el: c, snap, dx: snap.left - c.offsetLeft, dy: snap.top - c.offsetTop })
    }
    // 量到的只用這一次：沒回來的下一次更新重新量
    leaving = new Map()
    if (!back.length) return
    const ms = typeof duration === 'number' ? duration : tokenMs(duration)
    const easing = tokenValue('--ease') || 'ease'
    for (const { el, snap, dx, dy } of back) {
      el.style.transition = 'none'
      for (const k of Array.from(el.classList)) if (k.endsWith('-enter-from')) el.classList.remove(k)
      el.style.opacity = String(snap.o)
      el.style.transform = `scale(${snap.s})`
      void getComputedStyle(el).opacity
      el.style.transition = ''
      el.style.opacity = ''
      el.style.transform = ''
      if (Math.abs(dx) + Math.abs(dy) >= 0.5) playFlip(el, { dx, dy, scale: snap.s }, ms, easing)
    }
  })
}
