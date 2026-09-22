import { onBeforeUnmount, onMounted } from 'vue'
import { useSelectionStore } from '@/stores/selection'
import { useUiStore } from '@/stores/ui'

/**
 * 點在這些元素（或其後代）上不算「點到外面」，選取要留著。
 * 逐字取自 legacy `_docDown` 的 closest 清單（:1908）。
 */
const KEEP_SELECTION =
  '[data-card],[data-taskid],[data-rowtask],[data-rowgroup],[data-issuerow],[data-dd],[data-errorbar],input,textarea,select,label'

/** 點在這裡面不算「點到浮層外面」：下拉本體，以及錯誤條的 ✕（review M11）。 */
const KEEP_POPUP = '[data-dd],[data-errorbar]'

/**
 * 全域的「點到外面」處理，掛在 DashboardView。
 * 用 pointerdown + capture，這樣在任何元件自己的 click 之前就決定要不要關浮層 / 清選取（legacy :1905-1913）。
 */
export function useClickOutside(): void {
  const ui = useUiStore()
  const selection = useSelectionStore()

  function onPointerDown(e: PointerEvent): void {
    const target = e.target instanceof Element ? e.target : null

    // 1) 任何浮層開著而點擊落在 [data-dd] 之外 → 全部關掉
    const popupOpen = !!ui.openDropdown || ui.memberPickerOpen || ui.filterCalendarOpen
    if (popupOpen && !target?.closest(KEEP_POPUP)) ui.closeAllPopups()

    // 2) 詳細視窗開著時不動選取；沒有任何選取時也沒事做
    if (ui.detail) return
    if (!(selection.taskId || selection.issueId || selection.groupId)) return
    if (target?.closest(KEEP_SELECTION)) return
    selection.clear()
  }

  onMounted(() => document.addEventListener('pointerdown', onPointerDown, true))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
}
