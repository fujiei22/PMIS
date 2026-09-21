import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/types'
import { dayIndex } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
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

  // ── 載入狀態與錯誤條（契約 C）────────────────────────────────────────────
  describe('loadState / errors', () => {
    beforeEach(() => {
      // 這一段驗的是「還沒載入」的狀態，外層 beforeEach 已經載完了，換一個乾淨的 pinia
      setActivePinia(createPinia())
      useUiStore().now = NOW
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
})
