import { toValue, watch, type MaybeRefOrGetter } from 'vue'

/** 觸發元素位移超過這個距離（px）才算被捲走；再小的是次像素誤差。 */
const MOVED_PX = 2

export interface CloseOnScrollOptions {
  /** 浮層的狀態（ui.optionMenu 這類）：null / undefined = 關著；換成另一筆會重新記觸發元素的位置。 */
  state: MaybeRefOrGetter<unknown>
  /** 浮層根元素：浮層自己的內部捲動不算；焦點在裡面時不關。 */
  popover: MaybeRefOrGetter<HTMLElement | null | undefined>
  /** 打開它的觸發元素（useMenus 記在 menuAnchors）。 */
  anchor: () => HTMLElement | null
  close: () => void
}

/**
 * fixed 浮層開著時，捲動把觸發元素帶走了就關閉（G5）。
 *
 * 為什麼關閉而不是跟著移：位置只在開啟時量一次（lib/anchor），legacy 同；關閉最不會錯位。
 * 為什麼看「觸發元素有沒有動」而不是「有沒有捲動」：選取任務後甘特會橫向補間捲動 460–1150ms、
 * 載入後會捲到今天，這些程式捲動不會帶動看板卡片或甘特左欄（sticky）上的觸發元素；
 * 有捲動就關的話，「點卡片 → 馬上開狀態選單」會被自己關掉。
 * 焦點在浮層裡（日期選擇器的工期輸入框）時不關：平板叫出軟鍵盤會捲動頁面。
 * 監聽用 capture：元素的 scroll 事件不冒泡，document 只有在捕獲階段收得到。
 */
export function useCloseOnScroll({ state, popover, anchor, close }: CloseOnScrollOptions): void {
  watch(
    () => toValue(state),
    (value, _old, onCleanup) => {
      const el = value ? anchor() : null
      if (!el) return
      const start = el.getBoundingClientRect()
      const onScroll = (e: Event): void => {
        const pop = toValue(popover)
        if (
          pop &&
          ((e.target instanceof Node && pop.contains(e.target)) ||
            pop.contains(document.activeElement))
        )
          return
        const now = el.getBoundingClientRect()
        if (Math.abs(now.left - start.left) > MOVED_PX || Math.abs(now.top - start.top) > MOVED_PX)
          close()
      }
      document.addEventListener('scroll', onScroll, { capture: true, passive: true })
      onCleanup(() => document.removeEventListener('scroll', onScroll, { capture: true }))
    },
    { immediate: true },
  )
}
