import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * 總覽浮層（下拉、排序選單）的關閉規則：開著時在元件外按下、或按 Esc，就 `close()`。
 * Esc 關閉後把焦點還給觸發鈕，鍵盤使用者才不會掉到頁首。
 *
 * 不沿用 `useClickOutside`：那一支綁著 Dashboard 的 ui / selection store，
 * 總覽的浮層狀態在 overview store。判斷「點在外面」用 `contains`，不用 DOM 選擇器（契約 F）。
 *
 * @param el 浮層的根元素（觸發鈕與面板都在裡面）
 * @param open 目前是否開著
 * @param close 關閉動作
 * @param returnFocus Esc 關閉後要拿回焦點的元素
 */
export function useDismiss(
  el: Ref<HTMLElement | null>,
  open: () => boolean,
  close: () => void,
  returnFocus?: Ref<HTMLElement | null>,
): void {
  function onPointerDown(e: PointerEvent): void {
    if (!open()) return
    const target = e.target instanceof Node ? e.target : null
    if (target && el.value?.contains(target)) return
    close()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!open() || e.key !== 'Escape') return
    close()
    returnFocus?.value?.focus()
  }

  // capture：在其他元件自己的 click 之前就決定要不要關，和 useClickOutside 同一個時機
  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown)
  })
}
