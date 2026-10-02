import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/types'
import { dayIndex } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useProjectStore } from '@/stores/project'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('uiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useClockStore().now = NOW
    // 清理 watch 掛在 store 的 setup 裡，資料進來前就要先建立（契約 E、review DX 8）
    useSelectionStore()
    useUiStore()
    useTaskStore().load(structuredClone(sampleProject))
  })

  it('初始值為契約 D 列的預設', () => {
    const ui = useUiStore()
    expect(ui.dayWidth).toBe(32)
    expect(ui.zooming).toBe(false)
    expect(ui.panelOff).toEqual({ gantt: false, kanban: false, issues: false })
    expect(ui.openDropdown).toBeNull()
    expect(ui.memberPickerOpen).toBe(false)
    expect(ui.filterCalendarOpen).toBe(false)
    expect(ui.editing).toBeNull()
    expect(ui.pickerFor).toBeNull()
    expect(ui.detail).toBeNull()
    expect(ui.navAnim).toBeNull()
    expect(ui.confirm).toBeNull()
    expect(ui.depEditFor).toBeNull()
    expect(ui.optionMenu).toBeNull()
    expect(ui.rowMenu).toBeNull()
    expect(ui.taskDatePicker).toBeNull()
    expect(ui.issueDatePicker).toBeNull()
    expect(ui.lightbox).toBeNull()
    expect(ui.expandedIssues).toEqual({})
    expect(ui.drag).toBeNull()
    expect(ui.linkLine).toBeNull()
    expect(ui.nearTaskId).toBeNull()
    expect(ui.hoverTaskId).toBeNull()
  })

  // 時鐘在 clock store（契約 C / E），ui 不再轉接——見 clock.spec
  it('clock 的 todayIdx / todayIso 由 now 算出來', () => {
    const clock = useClockStore()
    expect(clock.todayIdx).toBe(dayIndex('2026-09-18'))
    expect(clock.todayIso).toBe('2026-09-18')
  })

  it('setDayWidth 夾在 14-32 並吸附到 0.25', () => {
    const ui = useUiStore()
    ui.setDayWidth(20.1)
    expect(ui.dayWidth).toBe(20)
    ui.setDayWidth(20.2)
    expect(ui.dayWidth).toBe(20.25)
    ui.setDayWidth(2)
    expect(ui.dayWidth).toBe(14)
    ui.setDayWidth(99)
    expect(ui.dayWidth).toBe(32)
  })

  it('toggleDropdown 互斥並關 memberPicker / filterCalendar', () => {
    const ui = useUiStore()
    ui.memberPickerOpen = true
    ui.filterCalendarOpen = true
    ui.toggleDropdown('status')
    expect(ui.openDropdown).toBe('status')
    expect(ui.memberPickerOpen).toBe(false)
    expect(ui.filterCalendarOpen).toBe(false)
    ui.toggleDropdown('prio')
    expect(ui.openDropdown).toBe('prio')
    ui.toggleDropdown('prio')
    expect(ui.openDropdown).toBeNull()
  })

  it('toggleMemberPicker 開啟時關掉下拉與日曆', () => {
    const ui = useUiStore()
    ui.toggleDropdown('status')
    ui.filterCalendarOpen = true
    ui.toggleMemberPicker()
    expect(ui.memberPickerOpen).toBe(true)
    expect(ui.openDropdown).toBeNull()
    expect(ui.filterCalendarOpen).toBe(false)
    ui.toggleMemberPicker()
    expect(ui.memberPickerOpen).toBe(false)
  })

  it('closeAllPopups 全關', () => {
    const ui = useUiStore()
    ui.toggleDropdown('status')
    ui.memberPickerOpen = true
    ui.filterCalendarOpen = true
    ui.closeAllPopups()
    expect(ui.openDropdown).toBeNull()
    expect(ui.memberPickerOpen).toBe(false)
    expect(ui.filterCalendarOpen).toBe(false)
  })

  it('openDetail 清 pickerFor / editing / openDropdown 與留言草稿、fileSel', () => {
    const ui = useUiStore()
    const c = useCommentStore()
    ui.pickerFor = 't1'
    ui.editing = { kind: 't', id: 't1' }
    ui.toggleDropdown('status')
    c.draft = '打到一半'
    c.fileSel = ['c1:0']
    ui.openDetail('t3', 'task')
    expect(ui.detail).toEqual({ id: 't3', kind: 'task', from: null })
    expect(ui.pickerFor).toBeNull()
    expect(ui.editing).toBeNull()
    expect(ui.openDropdown).toBeNull()
    expect(c.draft).toBe('')
    expect(c.fileSel).toEqual([])
  })

  it('openDetail 帶 from 時記錄來源並播放 paneIn', () => {
    const ui = useUiStore()
    ui.openDetail('i1', 'issue', 't3')
    expect(ui.detail).toEqual({ id: 'i1', kind: 'issue', from: 't3' })
    expect(ui.navAnim).toBe('in')
  })

  it('closeDetail 清掉 detail 與詳情裡的暫態；關閉動畫交給 DetailModal 的 Transition，不再留 lastDetail', () => {
    const ui = useUiStore()
    ui.openDetail('t3', 'task')
    ui.pickerFor = 't3'
    ui.editing = { kind: 'dt', id: 't3' }
    ui.closeDetail()
    expect(ui.detail).toBeNull()
    expect(ui.pickerFor).toBeNull()
    expect(ui.editing).toBeNull()
    expect('lastDetail' in ui).toBe(false)
  })

  it('detailBack 回到來源任務並播放 paneBack', () => {
    const ui = useUiStore()
    ui.openDetail('t3', 'task')
    ui.openDetail('i1', 'issue', 't3')
    ui.detailBack()
    expect(ui.detail).toEqual({ id: 't3', kind: 'task', from: null })
    expect(ui.navAnim).toBe('back')
  })

  it('detailBack 沒有來源時等同關閉', () => {
    const ui = useUiStore()
    ui.openDetail('i1', 'issue')
    ui.detailBack()
    expect(ui.detail).toBeNull()
  })

  // ── 懸空 id 清理（契約 E）──────────────────────────────────────────────────
  // 資料層不再回頭清 ui：改由這裡 watch 實體在不在，flush:'sync' 保證同一個 tick 清完。
  describe('懸空 id 由 watch 清掉', () => {
    it('Issue 被刪 → detail / confirm / expandedIssues 一起清', () => {
      const ui = useUiStore()
      ui.openDetail('i1', 'issue')
      ui.confirm = { kind: 'issue', id: 'i1', step: 1 }
      ui.expandedIssues.i1 = true
      useIssueStore().applyEvent({ type: 'issue.deleted', payload: { id: 'i1' } })
      expect(ui.detail).toBeNull()
      expect(ui.confirm).toBeNull()
      expect(ui.expandedIssues.i1).toBeUndefined()
    })

    it('任務被刪 → detail / depEditFor / pickerFor / confirm / rowMenu 一起清', () => {
      const ui = useUiStore()
      ui.openDetail('t3', 'task')
      ui.depEditFor = 't3'
      ui.pickerFor = 't3'
      ui.confirm = { kind: 'task', id: 't3', step: 2 }
      ui.rowMenu = { id: 't3', left: 10, top: 20 }
      useTaskStore().applyEvent({ type: 'task.deleted', payload: { id: 't3' } })
      expect(ui.detail).toBeNull()
      expect(ui.depEditFor).toBeNull()
      expect(ui.pickerFor).toBeNull()
      expect(ui.confirm).toBeNull()
      expect(ui.rowMenu).toBeNull()
    })

    it('來源任務被刪 → detail.from 清掉，Issue 詳情本身還開著', () => {
      const ui = useUiStore()
      ui.openDetail('i1', 'issue', 't3')
      useTaskStore().applyEvent({ type: 'task.deleted', payload: { id: 't3' } })
      expect(ui.detail).toEqual({ id: 'i1', kind: 'issue', from: null })
    })

    it('分類被刪 → 指向它的 confirm 清掉', () => {
      const ui = useUiStore()
      ui.confirm = { kind: 'group', id: 'g6', step: 1 }
      useTaskStore().applyEvent({ type: 'group.deleted', payload: { id: 'g6' } })
      expect(ui.confirm).toBeNull()
    })

    it('相依被刪 → 指向它的 confirm 清掉', () => {
      const ui = useUiStore()
      ui.confirm = { kind: 'dep', id: 'd1', step: 1 }
      useTaskStore().applyEvent({ type: 'dep.deleted', payload: { id: 'd1' } })
      expect(ui.confirm).toBeNull()
    })

    // review F8：getter 回位元遮罩（同 selection.ts），expandedIssues 另外一條 watch。
    // 改個任務名字不該讓「展開中的 Issue 卡還在不在」整份重算。
    it('改名不會讓懸空清理去掃 expandedIssues', () => {
      const ui = useUiStore()
      const issues = useIssueStore()
      ui.expandedIssues.i1 = true
      ui.openDetail('t3', 'task')
      const byId = vi.spyOn(issues, 'byId')

      useTaskStore().applyLocalPatch('t3', { name: '改名' })

      expect(byId).not.toHaveBeenCalled()
      expect(ui.expandedIssues.i1).toBe(true)
      byId.mockRestore()
    })

    it('還在的 id 不會被動到', () => {
      const ui = useUiStore()
      ui.openDetail('t3', 'task')
      ui.pickerFor = 't3'
      useTaskStore().applyEvent({ type: 'task.deleted', payload: { id: 't9' } })
      expect(ui.detail).toEqual({ id: 't3', kind: 'task', from: null })
      expect(ui.pickerFor).toBe('t3')
    })
  })

  // ── 載入狀態與錯誤條（契約 C）────────────────────────────────────────────
  describe('loadState / errors', () => {
    beforeEach(() => {
      // 這一段驗的是「還沒載入」的狀態，外層 beforeEach 已經載完了，換一個乾淨的 pinia
      setActivePinia(createPinia())
      useClockStore().now = NOW
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('載入狀態的初始值是 idle', () => {
      const ui = useUiStore()
      expect(ui.loadState).toBe('idle')
      expect(ui.loadError).toBeNull()
      expect(ui.errors).toEqual([])
    })

    it('pushError 記下 label / code / message / cause 並 console.error', () => {
      const ui = useUiStore()
      const err = new ApiError('not_found', '任務 t99 不存在', 404, 'updateTask')
      ui.pushError({ label: '更新任務', error: err })
      expect(ui.errors).toHaveLength(1)
      expect(ui.errors[0]).toMatchObject({
        label: '更新任務',
        code: 'not_found',
        message: '任務 t99 不存在',
        cause: err,
        count: 1,
      })
      expect(ui.errors[0]!.at).toBe(useClockStore().now)
      expect(console.error).toHaveBeenCalledWith('[api]', '更新任務', err)
    })

    it('非 ApiError 的例外歸成 unknown', () => {
      const ui = useUiStore()
      ui.pushError({ label: '更新任務', error: new Error('爆了') })
      expect(ui.errors[0]!.code).toBe('unknown')
      expect(ui.errors[0]!.message).toBe('爆了')
    })

    it('同 label 在 5 秒內合併成一筆並累加 count', () => {
      const ui = useUiStore()
      ui.pushError({ label: '更新任務', error: new ApiError('network', 'a') })
      ui.pushError({ label: '更新任務', error: new ApiError('network', 'b') })
      expect(ui.errors).toHaveLength(1)
      expect(ui.errors[0]!.count).toBe(2)

      // 超過 5 秒就是新的一筆
      useClockStore().now += 6000
      ui.pushError({ label: '更新任務', error: new ApiError('network', 'c') })
      expect(ui.errors).toHaveLength(2)
      expect(ui.errors[0]!.count).toBe(1)
    })

    it('不同 label 各自一筆、新的排在前面，最多留 5 筆', () => {
      const ui = useUiStore()
      for (let i = 1; i <= 7; i++) {
        ui.pushError({ label: `錯誤 ${i}`, error: new ApiError('network', 'x') })
      }
      expect(ui.errors).toHaveLength(5)
      expect(ui.errors.map((e) => e.label)).toEqual([
        '錯誤 7',
        '錯誤 6',
        '錯誤 5',
        '錯誤 4',
        '錯誤 3',
      ])
    })

    it('dismissError 只關掉那一筆', () => {
      const ui = useUiStore()
      ui.pushError({ label: 'A', error: new ApiError('network', 'x') })
      ui.pushError({ label: 'B', error: new ApiError('network', 'x') })
      ui.dismissError(ui.errors[0]!.id)
      expect(ui.errors.map((e) => e.label)).toEqual(['A'])
      // 不存在的 id 不影響
      ui.dismissError('nope')
      expect(ui.errors).toHaveLength(1)
    })
  })

  it('resetTransient 清掉所有暫態浮層，保留版面偏好', () => {
    const ui = useUiStore()
    const task = useTaskStore().tasks[0]!
    ui.openDetail(task.id, 'task')
    ui.confirm = { kind: 'task', id: task.id, step: 1 }
    ui.depEditFor = task.id
    ui.optionMenu = { id: task.id, kind: 'status', left: 0, top: 0 }
    ui.taskDatePicker = { id: task.id, target: 'start', month: '2026-09', left: 0, top: 0 }
    ui.issueDatePicker = { id: 'x', field: 'due', kind: 'issue', month: '2026-09', left: 0, top: 0 }
    ui.lightbox = { url: 'u', name: 'n', size: '1 KB' }
    ui.openDropdown = 'status'
    ui.memberPickerOpen = true
    ui.filterCalendarOpen = true
    ui.pickerFor = task.id
    ui.editing = { kind: 't', id: task.id }
    ui.linkLine = { x1: 0, y1: 0, x2: 1, y2: 1 }
    ui.nearTaskId = task.id
    ui.hoverTaskId = task.id
    ui.rowMenu = { id: task.id, left: 0, top: 0 }
    ui.zooming = true
    ui.pushError({ label: '更新任務', error: new Error('x') })
    ui.panelOff.gantt = true
    ui.setDayWidth(20)
    ui.toggleGroup('g1')

    ui.resetTransient()

    expect(ui.detail).toBeNull()
    expect(ui.confirm).toBeNull()
    expect(ui.depEditFor).toBeNull()
    expect(ui.optionMenu).toBeNull()
    expect(ui.taskDatePicker).toBeNull()
    expect(ui.issueDatePicker).toBeNull()
    expect(ui.lightbox).toBeNull()
    expect(ui.openDropdown).toBeNull()
    expect(ui.memberPickerOpen).toBe(false)
    expect(ui.filterCalendarOpen).toBe(false)
    expect(ui.pickerFor).toBeNull()
    expect(ui.editing).toBeNull()
    expect([ui.linkLine, ui.nearTaskId, ui.hoverTaskId, ui.rowMenu]).toEqual([
      null,
      null,
      null,
      null,
    ])
    expect(ui.drag).toBeNull()
    expect(ui.zooming).toBe(false)
    expect(ui.errors).toEqual([])
    // 版面偏好不動
    expect(ui.panelOff.gantt).toBe(true)
    expect(ui.dayWidth).toBe(20)
    expect(ui.collapsedGroups.has('g1')).toBe(true)
  })
})

describe('uiStore 的唯讀（F2）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useClockStore().now = NOW
    useUiStore()
    useTaskStore().load(structuredClone(sampleProject))
  })

  /** 變成唯讀：同一份專案、canEdit 改 false（後端算的值變了，例如背景重載時 PM 已經換人）。 */
  function becomeReadonly(): void {
    const project = useProjectStore()
    project.setAll(project.meta, false)
  }

  it('canEdit 跟著 project store', () => {
    const ui = useUiStore()
    expect(ui.canEdit).toBe(true)
    becomeReadonly()
    expect(ui.canEdit).toBe(false)
  })

  it('可編輯時 askDelete / openDepEditor / toggleAssigneePicker / startEdit 照常打開', () => {
    const ui = useUiStore()
    ui.askDelete('dep', 'd1', 'A → B')
    expect(ui.confirm).toEqual({ kind: 'dep', id: 'd1', step: 1, label: 'A → B' })
    ui.askDelete('task', 't1')
    expect(ui.confirm).toEqual({ kind: 'task', id: 't1', step: 1 })
    ui.openDepEditor('t1')
    expect(ui.depEditFor).toBe('t1')
    ui.toggleAssigneePicker('t1')
    expect(ui.pickerFor).toBe('t1')
    ui.toggleAssigneePicker('t1')
    expect(ui.pickerFor).toBeNull()
    ui.startEdit('g', 'g1')
    expect(ui.editing).toEqual({ kind: 'g', id: 'g1' })
  })

  it('唯讀時這幾支一律不開', () => {
    const ui = useUiStore()
    becomeReadonly()
    ui.askDelete('task', 't1')
    ui.openDepEditor('t1')
    ui.toggleAssigneePicker('t1')
    ui.startEdit('t', 't1')
    expect([ui.confirm, ui.depEditFor, ui.pickerFor, ui.editing]).toEqual([null, null, null, null])
  })

  it('變成唯讀時關掉編輯類的浮層與就地編輯，看的東西（詳細視窗、下拉）不動', () => {
    const ui = useUiStore()
    ui.openDetail('t1', 'task')
    ui.toggleDropdown('ksort')
    ui.startEdit('dt', 't1')
    ui.askDelete('task', 't2')
    ui.openDepEditor('t2')
    ui.toggleAssigneePicker('t1')
    ui.optionMenu = { id: 't1', kind: 'status', left: 0, top: 0 }
    ui.rowMenu = { id: 't1', left: 0, top: 0 }
    ui.taskDatePicker = { id: 't1', target: 'start', month: '2026-09', left: 0, top: 0 }
    ui.issueDatePicker = {
      id: 'i1',
      field: 'due',
      kind: 'issue',
      month: '2026-09',
      left: 0,
      top: 0,
    }

    becomeReadonly()

    expect(ui.editing).toBeNull()
    expect(ui.confirm).toBeNull()
    expect(ui.depEditFor).toBeNull()
    expect(ui.pickerFor).toBeNull()
    expect(ui.optionMenu).toBeNull()
    expect(ui.rowMenu).toBeNull()
    expect(ui.taskDatePicker).toBeNull()
    expect(ui.issueDatePicker).toBeNull()
    expect(ui.detail?.id).toBe('t1')
    expect(ui.openDropdown).toBe('ksort')
  })
})
