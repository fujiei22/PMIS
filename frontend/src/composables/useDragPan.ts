import { onBeforeUnmount, ref, type Ref } from 'vue'

/** 位移小於這個值就當成「點一下」，照常觸發點擊（同 usePointerDrag 的 PAN_CLICK_PX）。 */
const PAN_CLICK_PX = 4

/** 這些區域按下去不平移：左欄、速覽、原生互動元素。 */
const NO_PAN = '.p-left, .g-left, .qv, a, button, input, select, textarea'

export interface DragPan {
  /** 超過門檻、正在平移。 */
  panning: Ref<boolean>
  /** 綁在捲動容器的 pointerdown 上。 */
  onPointerDown: (e: PointerEvent) => void
}

/**
 * 總覽時間軸的按住拖曳平移：只動水平捲動，其他拖曳（條的移動等）時間軸都沒有，所以不走 usePointerDrag。
 *
 * - 只接滑鼠 / 筆的主鍵；觸控本來就能原生滑動。
 * - move / up 掛在 document 上，指標拖出容器也不會斷。
 * - 真的拖過之後吃掉緊接著的那次 click，列才不會在放手時被展開。
 *
 * @param scroller 水平捲動容器
 */
export function useDragPan(scroller: Ref<HTMLElement | null>): DragPan {
  const panning = ref(false)

  let startX = 0
  let startLeft = 0
  let moved = false

  function onMove(e: PointerEvent): void {
    const el = scroller.value
    if (!el) return
    const dx = e.clientX - startX
    if (!moved && Math.abs(dx) < PAN_CLICK_PX) return
    if (!moved) {
      moved = true
      panning.value = true
      document.body.style.cursor = 'grabbing'
      // 門檻前可能已經開始選字，清掉
      window.getSelection()?.removeAllRanges()
    }
    el.scrollLeft = startLeft - dx
  }

  function swallowClick(e: MouseEvent): void {
    e.stopPropagation()
    e.preventDefault()
  }

  function end(): void {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', end)
    document.removeEventListener('pointercancel', end)
    if (!moved) return
    moved = false
    panning.value = false
    document.body.style.cursor = ''
    // click 緊接在 pointerup 之後同步派發；放手在別的元素上時不會有 click，下一輪就撤掉，免得吃到下一次真的點擊
    window.addEventListener('click', swallowClick, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 0)
  }

  function onPointerDown(e: PointerEvent): void {
    const el = scroller.value
    if (!el || e.button !== 0 || e.pointerType === 'touch') return
    if ((e.target as Element | null)?.closest(NO_PAN)) return
    startX = e.clientX
    startLeft = el.scrollLeft
    moved = false
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
  }

  onBeforeUnmount(end)

  return { panning, onPointerDown }
}
