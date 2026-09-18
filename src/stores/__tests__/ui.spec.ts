import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useCommentStore } from '@/stores/comment'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('uiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUiStore().now = NOW
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
    expect(ui.lastDetail).toBeNull()
    expect(ui.navAnim).toBeNull()
    expect(ui.confirm).toBeNull()
    expect(ui.depEditFor).toBeNull()
    expect(ui.optionMenu).toBeNull()
    expect(ui.taskDatePicker).toBeNull()
    expect(ui.issueDatePicker).toBeNull()
    expect(ui.lightbox).toBeNull()
    expect(ui.expandedIssues).toEqual({})
    expect(ui.drag).toBeNull()
    expect(ui.linkLine).toBeNull()
    expect(ui.nearTaskId).toBeNull()
    expect(ui.hoverTaskId).toBeNull()
    expect(ui.rowHoverId).toBeNull()
    expect(ui.memberDrag).toBeNull()
  })

  it('todayIdx / todayIso 由 now 算出來', () => {
    const ui = useUiStore()
    expect(ui.todayIdx).toBe(dayIndex('2026-09-18'))
    expect(ui.todayIso).toBe('2026-09-18')
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

  it('closeDetail 設 lastDetail', () => {
    const ui = useUiStore()
    ui.openDetail('t3', 'task')
    ui.closeDetail()
    expect(ui.detail).toBeNull()
    expect(ui.lastDetail).toEqual({ id: 't3', kind: 'task' })
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
})
