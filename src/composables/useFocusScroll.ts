import { watch } from 'vue'
import { useSelectionStore } from '@/stores/selection'

/** 選取後各面板收到的捲動請求。 */
export interface FocusRequest {
  taskId: string
  src: 'card' | null
}

/**
 * 訂閱「選取了某個任務」的捲動請求（legacy `focus()` :2399）。
 * 用 flush:'post' 等 DOM 更新完再跑，才量得到新的卡片位置。
 *
 * @param handler 收到請求時要做的捲動
 */
export function useFocusRequest(handler: (req: FocusRequest) => void): void {
  const selection = useSelectionStore()
  watch(
    () => selection.focusRequest,
    (req) => {
      if (req) handler({ taskId: req.taskId, src: req.src })
    },
    { flush: 'post' },
  )
}

/**
 * 把 `el` 捲進 `container` 的可視範圍（只動垂直方向）。legacy :2406-2418。
 * container 本身沒有可捲的高度就什麼都不做——legacy 也是這樣判斷。
 *
 * @param pad 捲完後在容器頂端留的空白（px）
 */
export function scrollIntoContainer(
  el: Element | null | undefined,
  container: Element | null | undefined,
  pad: number,
): void {
  if (!el || !container) return
  if (container.scrollHeight <= container.clientHeight + 1) return
  const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top - pad
  container.scrollTop = Math.max(
    0,
    Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + delta),
  )
}
