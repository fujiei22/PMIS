import { toValue, type MaybeRefOrGetter } from 'vue'

/** 更新前量到的離場中項目：看得到的高度與透明度。 */
interface Leaving {
  h: number
  o: number
}

/**
 * 原地收合的清單（泳道、時間軸群組與列）：同一個 key 在離場途中又回來時，從舊元素當下的高度與透明度接續長回去。
 *
 * 為什麼要：Vue 會先把離場中的舊元素移除（並呼叫它的 after-leave），才讓新元素進場；新元素照 class 從 0fr、透明開始，
 * 下方的清單與面板底邊會一幀上跳再推回（打錯字馬上刪最常見，plan review Design C2）。那時舊元素已量不到，
 * 所以在清單更新前先量好。
 *
 * 結構約定：項目外層是 grid（過渡寫在 ov-col / ov-group / ov-row 的 class，0fr ↔ 1fr），第一個子元素是裁切層，
 * 裁切層的第一個子元素是內容（間距用它的 margin-bottom，放在裁切層裡跟著收）。
 *
 * 綁在 TransitionGroup 上：`@vue:before-update="reenter.snapshot"`、`@enter="reenter.onEnter"`。
 * - snapshot 綁 TransitionGroup 自己的 before-update，不用擁有者的 onBeforeUpdate：清單寫在插槽裡（例如 OvPanel 的內容）時，
 *   篩選只會讓 TransitionGroup 重新渲染，擁有者不會更新。
 * - onEnter 只收一個參數，Vue 仍自己偵測過渡結束。
 */
export function useCollapseReenter(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  keyAttr: string,
): { onEnter: (el: Element) => void; snapshot: () => void } {
  let leaving = new Map<string, Leaving>()

  /** 清單更新前：記下離場中項目看得到的高度與透明度（這時還沒有任何 class 在換，讀樣式不會打斷進行中的過渡）。 */
  function snapshot(): void {
    const next = new Map<string, Leaving>()
    for (const c of Array.from(toValue(container)?.children ?? [])) {
      const key = c.getAttribute(keyAttr)
      if (!key || !Array.from(c.classList).some((k) => k.endsWith('-leave-active'))) continue
      next.set(key, { h: c.getBoundingClientRect().height, o: parseFloat(getComputedStyle(c).opacity) })
    }
    leaving = next
  }

  /**
   * 同 key 回來的新元素：以 snapshot 量到的高度比例（fr）與透明度當起點，立刻往 1fr / 1 過渡。
   * 1. 先關掉過渡再寫起點、強制算一次樣式：上面量完整高度時，瀏覽器已經用 enter-from（0fr、透明）算過一次樣式，
   *    直接改 inline 會從 0 過渡到起點，等於從 0 重長。
   * 2. 交還 class 的過渡，同時拿掉 enter-from、清掉 inline：目標直接是 1fr / 1，下一次算樣式就從起點往回長。
   *    不等 Vue 兩幀後才把 enter-from 換成 enter-to：等的話反悔後多停在起點，實測第 3–4 幀才往回；立刻放開是第 2–3 幀，
   *    和一次全新的篩選一樣快（剩下的一兩幀是瀏覽器新建過渡的起步）。之後 Vue 再拿 enter-from 是空操作。
   */
  function onEnter(el: Element): void {
    const node = el as HTMLElement
    const key = node.getAttribute(keyAttr)
    const snap = key ? leaving.get(key) : undefined
    if (!key || !snap) return
    leaving.delete(key)
    const inner = node.firstElementChild?.firstElementChild as HTMLElement | null | undefined
    if (!inner) return
    const full = inner.offsetHeight + (parseFloat(getComputedStyle(inner).marginBottom) || 0)
    if (!full) return
    node.style.transition = 'none'
    node.style.gridTemplateRows = `${Math.min(1, snap.h / full)}fr`
    node.style.opacity = String(snap.o)
    void node.offsetHeight
    node.style.transition = ''
    for (const k of Array.from(node.classList)) if (k.endsWith('-enter-from')) node.classList.remove(k)
    node.style.gridTemplateRows = ''
    node.style.opacity = ''
  }

  return { onEnter, snapshot }
}
