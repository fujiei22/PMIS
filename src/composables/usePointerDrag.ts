import { inject, onBeforeUnmount, onMounted, provide, type InjectionKey, type Ref } from 'vue'
import { useAutoScroll } from '@/composables/useAutoScroll'
import { ROW_HEIGHT } from '@/constants/dashboard'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore, type DragState } from '@/stores/ui'
import type { DropTarget } from '@/types/models'

/**
 * 甘特圖上的七種指標拖曳：條的移動 / 左右縮放、拉線建相依、列與分類重排、畫布平移。
 *
 * 全部走 document 層的 pointermove / pointerup（legacy `_mm` / `_mu` :1923-1924），
 * 指標一旦離開原本的元素也不會斷。狀態寫進 `uiStore.drag`，
 * 樣式（抬起、淡化、落點底色、圓點）由 S3 的元件自己讀。
 *
 * legacy 對照：`startBar` :2591、`startLink` :2601、`onGrip` :2871 / :2766、
 * `onPanStart` :4106、`dragTick` :2483-2557、`hitRow` :2559、`onUp` :2571。
 */

/** 滑鼠離開條之後還留著連線圓點多久（ms）。legacy `clearHover`（:1877） */
const HOVER_LEAVE_MS = 280
/** 列重排兩次換位之間的最短間隔（ms）與最小位移（px）。legacy :2551 */
const REORDER_MS = 140
const REORDER_PX = 3
/** 分類重排兩次換位之間的最短間隔（ms）。legacy :2521 */
const GROUP_REORDER_MS = 220
/** 平移的位移小於這個值就當成「點空白處」，清掉選取。legacy :2584 */
const PAN_CLICK_PX = 4

/** 甘特圖裡拖曳會用到的三個容器。 */
export interface DragElements {
  /** 水平捲動容器（`.gantt-scroller`）。 */
  gantt: Ref<HTMLElement | null>
  /** 甘特畫布本體（`.gantt-chart`），連線座標以它的左上角為原點。 */
  chart: Ref<HTMLElement | null>
  /** 垂直捲動容器（`.gantt-body`）；捲不動時自動退回捲視窗。 */
  vscroll: Ref<HTMLElement | null>
}

export interface PointerDrag {
  /** 條本體 / 左右把手按下去：移動或縮放。未選取的條由呼叫端先擋掉。 */
  startBar: (e: PointerEvent, id: string, kind: 'move' | 'resL' | 'resR') => void
  /** 連線圓點按下去：開始拉相依線。 */
  startLink: (e: PointerEvent, id: string, side: 'L' | 'R') => void
  /** 任務列的 `⠿` 把手按下去：列重排。 */
  startReorder: (e: PointerEvent, id: string) => void
  /** 分類列的 `⠿` 把手按下去：分類重排。 */
  startGroupReorder: (e: PointerEvent, id: string) => void
  /** 畫布空白處按下去：平移。 */
  startPan: (e: PointerEvent) => void
  /** 滑鼠進到條或圓點上。 */
  setHover: (id: string) => void
  /** 滑鼠離開；延遲 280ms 才收圓點，讓指標有時間從條移到圓點上。 */
  clearHover: (id: string) => void
}

const NOOP: PointerDrag = {
  startBar: () => {},
  startLink: () => {},
  startReorder: () => {},
  startGroupReorder: () => {},
  startPan: () => {},
  setHover: () => {},
  clearHover: () => {},
}

const DRAG_KEY: InjectionKey<PointerDrag> = Symbol('pointer-drag')

/**
 * 在擁有甘特容器的元件（GanttPanel）呼叫一次，並把 API provide 給底下的列與條。
 */
export function usePointerDrag(els: DragElements): PointerDrag {
  const ui = useUiStore()
  const taskStore = useTaskStore()
  const selection = useSelectionStore()

  /** 最後一次指標座標；不需要響應式，每次 tick 直接讀。legacy `_ptr`（:2432） */
  let ptr: { x: number; y: number } | null = null
  let hoverTimer: ReturnType<typeof setTimeout> | undefined

  const auto = useAutoScroll({
    // pan 自己就在捲，不再疊加自動捲動（legacy :2440）
    pointer: () => (ui.drag && ui.drag.kind !== 'pan' ? ptr : null),
    // 列重排只會上下移動，水平捲反而會讓落點判斷亂掉（legacy :2445）
    horizontal: () => (ui.drag?.kind === 'reorder' ? null : els.gantt.value),
    vertical: () => els.vscroll.value,
    onScrolled: () => dragTick(),
  })

  /** 一個分類連同它底下的列在畫面上佔的範圍。legacy `blockRect`（:1821） */
  function blockRect(gid: string): { top: number; bottom: number; height: number } | null {
    const head = document.querySelector(`[data-rowgroup="${gid}"]`)
    if (!head) return null
    const hr = head.getBoundingClientRect()
    let bottom = hr.bottom
    for (const t of taskStore.tasks) {
      if (t.groupId !== gid) continue
      const el = document.querySelector(`[data-rowtask="${t.id}"]`)
      if (el) bottom = Math.max(bottom, el.getBoundingClientRect().bottom)
    }
    return { top: hr.top, bottom, height: bottom - hr.top }
  }

  /** 條的移動與左右縮放：換算成整數天再寫回 store。legacy :2486-2496 */
  function tickBar(d: Extract<DragState, { kind: 'move' | 'resL' | 'resR' }>, p: { x: number; y: number }): void {
    const sl = els.gantt.value?.scrollLeft ?? 0
    // 加上捲動位移，自動捲動時才不會因為畫面移動而多算幾天（legacy :2489）
    const delta = Math.round((p.x + sl - (d.x0 + d.sl0)) / ui.dayWidth)
    if (delta === d.last) return
    d.last = delta
    if (d.kind === 'move') {
      taskStore.updateTask(d.id, {
        start: isoFromIndex(d.s0 + delta),
        end: isoFromIndex(d.e0 + delta),
      })
    } else if (d.kind === 'resL') {
      // 左把手不能越過結束日
      taskStore.updateTask(d.id, { start: isoFromIndex(Math.min(d.s0 + delta, d.e0)) })
    } else {
      taskStore.updateTask(d.id, { end: isoFromIndex(Math.max(d.e0 + delta, d.s0)) })
    }
  }

  /** 相依預覽線 + 目前壓在哪一列。legacy :2497-2505 */
  function tickLink(d: Extract<DragState, { kind: 'link' }>, p: { x: number; y: number }): void {
    const box = els.chart.value
    if (!box) return
    const r = box.getBoundingClientRect()
    const y = p.y - r.top
    const row = taskStore.visibleRows[Math.floor(y / ROW_HEIGHT)]
    ui.linkLine = { x1: d.ax, y1: d.ay, x2: p.x - r.left, y2: y }
    ui.nearTaskId = row && row.kind === 't' && row.id !== d.id ? row.id : null
  }

  /** 分類重排：越過自己整塊的邊界、且過了鄰塊一半才交換。legacy :2506-2520 */
  function tickGroupReorder(
    d: Extract<DragState, { kind: 'greorder' }>,
    p: { x: number; y: number },
  ): void {
    // 節流用單調時鐘：e2e 會把 Date.now() 固定住，差值永遠是 0 就再也不會換位
    const now = performance.now()
    if (now - d.lastAt < GROUP_REORDER_MS) return
    const order = taskStore.groups.map((g) => g.id)
    const i = order.indexOf(d.id)
    const self = blockRect(d.id)
    if (!self) return
    const nextId = order[i + 1]
    const prevId = order[i - 1]
    if (i < order.length - 1 && nextId && p.y > self.bottom) {
      const nb = blockRect(nextId)
      if (nb && p.y > nb.top + nb.height / 2) {
        d.lastAt = now
        taskStore.moveGroup(d.id, 1)
      }
    } else if (i > 0 && prevId && p.y < self.top) {
      const nb = blockRect(prevId)
      if (nb && p.y < nb.bottom - nb.height / 2) {
        d.lastAt = now
        taskStore.moveGroup(d.id, -1)
      }
    }
  }

  /** 列重排：往上 / 往下找第一個可以落腳的列或分類。legacy :2521-2553 */
  function tickReorder(
    d: Extract<DragState, { kind: 'reorder' }>,
    p: { x: number; y: number },
  ): void {
    const self = document.querySelector(`[data-rowtask="${d.id}"]`)
    if (!self) return
    const y = p.y
    const selfR = self.getBoundingClientRect()
    const rows = taskStore.visibleRows
    const myIdx = rows.findIndex((v) => v.kind === 't' && v.id === d.id)
    const myGroup = taskStore.taskById(d.id)?.groupId
    let best: DropTarget | null = null

    if (y > selfR.bottom) {
      for (let k = myIdx + 1; k < rows.length; k++) {
        const v = rows[k]!
        // 自己那個分類的標題列不算落點
        if (v.kind === 'g' && v.id === myGroup) continue
        best = v.kind === 'g' ? { kind: 'g', id: v.id, dir: 'down' } : { kind: 't', id: v.id }
        break
      }
    } else if (y < selfR.top) {
      for (let k = myIdx - 1; k >= 0; k--) {
        const v = rows[k]!
        if (v.kind === 'g' && v.id === myGroup) continue
        if (v.kind === 'g') {
          best = { kind: 'g', id: v.id, dir: 'up' }
          break
        }
        const tv = taskStore.taskById(v.id)
        // 往上碰到別的分類的任務 → 落在那個分類的最後面
        best =
          tv && tv.groupId !== myGroup
            ? { kind: 'g', id: tv.groupId, dir: 'up' }
            : { kind: 't', id: v.id }
        break
      }
    }
    d.over = best

    const now = performance.now()
    if (best && best.id !== d.id && now - d.lastAt > REORDER_MS && Math.abs(y - d.lastY) > REORDER_PX) {
      d.lastAt = now
      d.lastY = y
      taskStore.moveTaskTo(d.id, best)
    }
  }

  /** 畫布平移：反向套用位移。legacy :2554-2557 */
  function tickPan(d: Extract<DragState, { kind: 'pan' }>, p: { x: number; y: number }): void {
    const dx = p.x - d.x0
    const dy = p.y - d.y0
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy))
    const sc = els.gantt.value
    const vs = els.vscroll.value
    if (sc) sc.scrollLeft = d.sl - dx
    if (vs) vs.scrollTop = d.st - dy
  }

  /** 指標移動（或自動捲動）之後重算一次拖曳結果。legacy `dragTick`（:2483） */
  function dragTick(): void {
    const d = ui.drag
    const p = ptr
    if (!d || !p) return
    if (d.kind === 'move' || d.kind === 'resL' || d.kind === 'resR') tickBar(d, p)
    else if (d.kind === 'link') tickLink(d, p)
    else if (d.kind === 'greorder') tickGroupReorder(d, p)
    else if (d.kind === 'reorder') tickReorder(d, p)
    else if (d.kind === 'pan') tickPan(d, p)
  }

  /** 共同的開場：記下狀態與指標、開自動捲動、擋住文字選取。legacy :2596 / :2777 */
  function begin(state: DragState, e: PointerEvent): void {
    ui.drag = state
    ptr = { x: e.clientX, y: e.clientY }
    auto.start()
    // base.css 沒有行內的 user-select 規則，拖曳期間直接改 body 樣式（legacy :2598）
    document.body.style.userSelect = 'none'
  }

  function startBar(e: PointerEvent, id: string, kind: 'move' | 'resL' | 'resR'): void {
    if (e.button !== 0) return
    e.stopPropagation()
    const t = taskStore.taskById(id)
    if (!t) return
    begin(
      {
        kind,
        id,
        x0: e.clientX,
        sl0: els.gantt.value?.scrollLeft ?? 0,
        s0: dayIndex(t.start),
        e0: dayIndex(t.end),
        last: 0,
      },
      e,
    )
  }

  function startLink(e: PointerEvent, id: string, side: 'L' | 'R'): void {
    e.stopPropagation()
    e.preventDefault()
    const t = taskStore.taskById(id)
    if (!t) return
    const dw = ui.dayWidth
    const idx = taskStore.visibleRows.findIndex((v) => v.kind === 't' && v.id === id)
    const barL = (dayIndex(t.start) - taskStore.range.a) * dw
    const barW = (dayIndex(t.end) - dayIndex(t.start) + 1) * dw
    // 起點落在圓點中心（右側 +10.5、左側 -9.5）。legacy :2606
    const ax = side === 'R' ? barL + barW + 10.5 : barL - 9.5
    const ay = idx * ROW_HEIGHT + 17
    begin({ kind: 'link', id, side, ax, ay }, e)
    ui.linkLine = { x1: ax, y1: ay, x2: ax, y2: ay }
  }

  function startReorder(e: PointerEvent, id: string): void {
    if (e.button !== 0) return
    e.stopPropagation()
    begin({ kind: 'reorder', id, over: null, lastAt: 0, lastY: 0 }, e)
  }

  function startGroupReorder(e: PointerEvent, id: string): void {
    if (e.button !== 0) return
    e.stopPropagation()
    begin({ kind: 'greorder', id, lastAt: 0 }, e)
  }

  function startPan(e: PointerEvent): void {
    if (e.button !== 0) return
    begin(
      {
        kind: 'pan',
        x0: e.clientX,
        y0: e.clientY,
        sl: els.gantt.value?.scrollLeft ?? 0,
        st: els.vscroll.value?.scrollTop ?? 0,
        moved: 0,
      },
      e,
    )
    document.body.style.cursor = 'grabbing'
  }

  function setHover(id: string): void {
    if (ui.drag) return
    clearTimeout(hoverTimer)
    if (ui.hoverTaskId !== id) ui.hoverTaskId = id
  }

  function clearHover(id: string): void {
    if (ui.drag) return
    clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => {
      if (ui.drag) return
      if (ui.hoverTaskId === id) ui.hoverTaskId = null
    }, HOVER_LEAVE_MS)
  }

  function onMove(e: PointerEvent): void {
    if (!ui.drag) return
    ptr = { x: e.clientX, y: e.clientY }
    dragTick()
  }

  /** 結束一段拖曳：共同的收尾（清狀態、停自動捲動、還原 body 樣式與預覽線）。 */
  function finish(): DragState | null {
    const d = ui.drag
    if (!d) return null
    ui.drag = null
    auto.stop()
    document.body.style.userSelect = ''
    if (d.kind === 'pan') document.body.style.cursor = ''
    return d
  }

  /**
   * 拖曳被瀏覽器接管而中止（觸控被捲動搶走、手寫筆離開、指標捕捉被收回）。
   *
   * review M3：legacy :2571 只聽 pointerup，觸控 / 手寫筆一被接管就再也收不到放開事件，
   * `ui.drag` 卡住、body 的 userSelect / cursor 回不來。這裡收尾但**不結算**——
   * 不建相依、也不把平移當成「點一下空白處」而清掉選取。
   */
  function onCancel(): void {
    if (!finish()) return
    ui.linkLine = null
    ui.nearTaskId = null
  }

  /** 放開：連線要結算成相依，平移要判斷是不是「只是點一下空白處」。legacy `onUp`（:2571） */
  function onUp(e: PointerEvent): void {
    const d = finish()
    if (!d) return

    if (d.kind === 'link') {
      // 命中條或圓點都算，都沒中就用最後壓到的那一列（legacy :2574-2576）
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const hit = el?.closest('[data-taskid]') ?? el?.closest('[data-linkfor]') ?? null
      const to =
        hit?.getAttribute('data-taskid') ?? hit?.getAttribute('data-linkfor') ?? ui.nearTaskId
      ui.linkLine = null
      ui.nearTaskId = null
      if (to && to !== d.id) {
        // 從右側拉出去 → 自己是前置；從左側拉出去 → 自己是後續
        const from = d.side === 'R' ? d.id : to
        const target = d.side === 'R' ? to : d.id
        taskStore.addDep(from, target)
      }
    } else if (d.kind === 'pan') {
      if (d.moved < PAN_CLICK_PX) selection.clear()
    }
  }

  onMounted(() => {
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    document.addEventListener('lostpointercapture', onCancel)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onCancel)
    document.removeEventListener('lostpointercapture', onCancel)
    clearTimeout(hoverTimer)
    auto.stop()
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  })

  const api: PointerDrag = {
    startBar,
    startLink,
    startReorder,
    startGroupReorder,
    startPan,
    setHover,
    clearHover,
  }
  provide(DRAG_KEY, api)
  return api
}

/** 甘特圖底下的元件取用拖曳 API；不在甘特圖裡時全部是 no-op。 */
export function usePointerDragContext(): PointerDrag {
  return inject(DRAG_KEY, NOOP)
}
