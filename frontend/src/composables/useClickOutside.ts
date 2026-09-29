import { onBeforeUnmount, onMounted } from 'vue'
import { useSelectionStore } from '@/stores/selection'
import { useUiStore } from '@/stores/ui'

/**
 * 點在這些元素（或其後代）上不算「點到外面」，選取要留著。
 * 逐字取自 legacy `_docDown` 的 closest 清單（:1908），再加上新頁自己的 `[data-keep-selection]`：
 * 只改怎麼看、不該清掉選取的控制項（平板甘特左欄的展開鈕——選了任務再展開，就是想看它的日期）。
 */
const KEEP_SELECTION =
  '[data-card],[data-taskid],[data-rowtask],[data-rowgroup],[data-issuerow],[data-dd],[data-errorbar],[data-keep-selection],input,textarea,select,label'

/** 點在這裡面不算「點到浮層外面」：下拉本體，以及錯誤條的 ✕（review M11）。 */
const KEEP_POPUP = '[data-dd],[data-errorbar]'

/**
 * 全域的「點到外面」處理，掛在 DashboardView。
 * 用 pointerdown + capture，這樣在任何元件自己的 click 之前就決定要不要關浮層 / 清選取（legacy :1905-1913）。
 *
 * 手指例外：pointerdown 時還不知道是「點一下」還是「開始捲動」。在 pointerdown 就清選取的話，
 * 平板上一捲動頁面選取就沒了。所以觸控的清選取延到 click——捲動會變成 pointercancel、不會有 click。
 */
export function useClickOutside(): void {
  const ui = useUiStore()
  const selection = useSelectionStore()
  /** 最近一次 pointerdown 是不是手指；click 事件本身不一定帶 pointerType。 */
  let lastWasTouch = false

  function clearSelectionIfOutside(target: Element | null): void {
    // 詳細視窗開著時不動選取；沒有任何選取時也沒事做
    if (ui.detail) return
    if (!(selection.taskId || selection.issueId || selection.groupId)) return
    if (target?.closest(KEEP_SELECTION)) return
    selection.clear()
  }

  function onPointerDown(e: PointerEvent): void {
    const target = e.target instanceof Element ? e.target : null
    lastWasTouch = e.pointerType === 'touch'

    // 1) 任何浮層開著而點擊落在 [data-dd] 之外 → 全部關掉（手指開始捲動時收起浮層也合理）
    const popupOpen = !!ui.openDropdown || ui.memberPickerOpen || ui.filterCalendarOpen
    if (popupOpen && !target?.closest(KEEP_POPUP)) ui.closeAllPopups()

    // 2) 清選取；手指延到 click
    if (!lastWasTouch) clearSelectionIfOutside(target)
  }

  function onClick(e: MouseEvent): void {
    if (!lastWasTouch) return
    clearSelectionIfOutside(e.target instanceof Element ? e.target : null)
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('click', onClick, true)
  })
}
