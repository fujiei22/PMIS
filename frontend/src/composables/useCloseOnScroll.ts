import { onUpdated, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { TOUCH_UI_QUERY } from '@/composables/useMediaQuery'

/** 觸發元素位移超過這個距離（px）才算被捲走；再小的是次像素誤差。 */
const MOVED_PX = 2

/** 主要輸入是手指的裝置（同 useMediaQuery 的判斷）；沒有 matchMedia 的環境（jsdom）當桌機。 */
function isTouchUi(): boolean {
  return window.matchMedia?.(TOUCH_UI_QUERY)?.matches ?? false
}

export interface CloseOnScrollOptions {
  /** 浮層的狀態（ui.optionMenu 這類）：null / undefined = 關著；換成另一筆會重新記觸發元素的位置。 */
  state: MaybeRefOrGetter<unknown>
  /** 浮層根元素：浮層自己的內部捲動不算；觸控裝置上焦點在裡面時不關。 */
  popover: MaybeRefOrGetter<HTMLElement | null | undefined>
  /** 打開它的觸發元素（useMenus 記在 menuAnchors）。 */
  anchor: () => HTMLElement | null
  close: () => void
}

/**
 * fixed 浮層開著時，捲動把觸發元素帶走了就關閉（G5）。
 *
 * 為什麼關閉而不是跟著移：位置只在開啟時量一次（lib/anchor），legacy 同；關閉最不會錯位。
 * 只看「會帶走觸發元素的捲動」：捲的容器（捲整頁時是 document）要包含觸發元素才比位移。
 * 選取任務後甘特的橫向補間、專案起點外移時捲 .gantt-scroller，都跟看板卡片、甘特左欄不是祖先關係，自然不算。
 * 觸發元素已經不在 DOM（任務被刪、清單重畫）時浮層失去錨點，一捲動就關。
 * 觸控裝置上焦點在浮層裡（日期選擇器的工期輸入框）時不關：叫出軟鍵盤會捲動頁面；桌機照樣關。
 * 基準位置在開啟那次渲染之後才量（flush: 'post'）：開啟的點擊造成的版面變化先套用。
 * 資料造成的移位（例：改起日後卡片依起日換位，加上瀏覽器 scroll anchoring 的補償）只重設基準：
 * 宿主（選擇器 / 選單）每次重畫後重量一次；只有使用者或程式捲動把觸發元素帶走才關。
 * 監聽用 capture：元素的 scroll 事件不冒泡，document 只有在捕獲階段收得到。
 */
export function useCloseOnScroll({ state, popover, anchor, close }: CloseOnScrollOptions): void {
  /** 開著時的觸發元素與它的基準位置；關著時是 null。 */
  let el: HTMLElement | null = null
  let start: DOMRect | null = null

  watch(
    () => toValue(state),
    (value, _old, onCleanup) => {
      el = value ? anchor() : null
      if (!el) return
      start = el.getBoundingClientRect()
      const onScroll = (e: Event): void => {
        if (!el || !start) return
        const pop = toValue(popover)
        const target = e.target
        // 浮層自己的內部捲動
        if (pop && target instanceof Node && pop.contains(target)) return
        if (!el.isConnected) return close()
        // 捲的容器不含觸發元素：帶不走它
        if (!(target instanceof Node && target.contains(el))) return
        // 觸控裝置上焦點在浮層裡：叫出軟鍵盤會捲動頁面
        if (isTouchUi() && pop?.contains(document.activeElement)) return
        const now = el.getBoundingClientRect()
        if (Math.abs(now.left - start.left) > MOVED_PX || Math.abs(now.top - start.top) > MOVED_PX)
          close()
      }
      document.addEventListener('scroll', onScroll, { capture: true, passive: true })
      onCleanup(() => {
        document.removeEventListener('scroll', onScroll, { capture: true })
        el = null
        start = null
      })
    },
    { immediate: true, flush: 'post' },
  )

  // 宿主重畫時版面已經照新資料排好（瀏覽器的 anchoring 補償也在這次量測的版面計算裡套用）
  onUpdated(() => {
    if (el?.isConnected) start = el.getBoundingClientRect()
  })
}
