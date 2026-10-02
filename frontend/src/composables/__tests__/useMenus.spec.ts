import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSample, useSampleCalendar } from '@/__tests__/loadSample'
import { clearMenuAnchors, menuAnchors, useMenus } from '@/composables/useMenus'
import { anchorCalendar, anchorOptionMenu, anchorRowMenu } from '@/lib/anchor'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useProjectStore } from '@/stores/project'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** jsdom 的 getBoundingClientRect 一律回 0，換一顆能控的觸發元素。 */
function triggerAt(left: number, top: number, bottom: number): MouseEvent {
  const el = document.createElement('div')
  const rect = { left, top, bottom, right: left + 40, width: 40, height: bottom - top } as DOMRect
  el.getBoundingClientRect = () => rect
  const e = new MouseEvent('click')
  Object.defineProperty(e, 'currentTarget', { value: el })
  return e
}

const VP = { width: window.innerWidth, height: window.innerHeight }

beforeEach(() => {
  setActivePinia(createPinia())
  useSampleCalendar()
  useTaskStore().load(structuredClone(sampleProject))
})

describe('useMenus', () => {
  it('openOptionMenu 寫入 id / kind 與 anchorOptionMenu 算出的座標', () => {
    const ui = useUiStore()
    const menus = useMenus()
    const rect = { left: 120, top: 200, bottom: 224 }

    menus.openOptionMenu(triggerAt(rect.left, rect.top, rect.bottom), 't1', 'status')

    // status 有 5 列（legacy :2673）
    expect(ui.optionMenu).toEqual({
      id: 't1',
      kind: 'status',
      ...anchorOptionMenu(rect, 5, VP),
    })
  })

  it('openOptionMenu 的 group / itask 列數跟著資料走', () => {
    const ui = useUiStore()
    const taskStore = useTaskStore()
    const menus = useMenus()
    const rect = { left: 10, top: 10, bottom: 30 }

    menus.openOptionMenu(triggerAt(rect.left, rect.top, rect.bottom), 't1', 'group')
    expect(ui.optionMenu!.top).toBe(anchorOptionMenu(rect, taskStore.groups.length, VP).top)

    menus.openOptionMenu(triggerAt(rect.left, rect.top, rect.bottom), 'i1', 'itask')
    expect(ui.optionMenu!.top).toBe(anchorOptionMenu(rect, taskStore.tasks.length, VP).top)
  })

  it('openTaskDatePicker 從 start 端開始填、月份跟著任務起始日', () => {
    const ui = useUiStore()
    const taskStore = useTaskStore()
    const menus = useMenus()
    const rect = { left: 300, top: 100, bottom: 120 }

    menus.openTaskDatePicker(triggerAt(rect.left, rect.top, rect.bottom), 't1')

    expect(ui.taskDatePicker).toEqual({
      id: 't1',
      target: 'start',
      month: taskStore.taskById('t1')!.start.slice(0, 7),
      ...anchorCalendar(rect, VP, 'task'),
    })
  })

  it('toggleRowMenu 開在「⋮」旁邊；同一列再點一次就關掉，換一列就換過去', () => {
    const ui = useUiStore()
    const menus = useMenus()
    const rect = { left: 330, top: 100, bottom: 124, right: 370 }

    menus.toggleRowMenu(triggerAt(rect.left, rect.top, rect.bottom), 't1')
    expect(ui.rowMenu).toEqual({ id: 't1', ...anchorRowMenu(rect, VP) })

    menus.toggleRowMenu(triggerAt(rect.left, rect.top, rect.bottom), 't2')
    expect(ui.rowMenu?.id).toBe('t2')

    menus.toggleRowMenu(triggerAt(rect.left, rect.top, rect.bottom), 't2')
    expect(ui.rowMenu).toBeNull()
  })

  it('openTaskDatePicker 對不存在的任務不開', () => {
    const ui = useUiStore()
    useMenus().openTaskDatePicker(triggerAt(0, 0, 0), '沒這個')
    expect(ui.taskDatePicker).toBeNull()
  })

  it('openIssueDatePicker 沒填過日期就用今天的月份', () => {
    const ui = useUiStore()
    const menus = useMenus()
    const rect = { left: 40, top: 50, bottom: 70 }

    menus.openIssueDatePicker(triggerAt(rect.left, rect.top, rect.bottom), 'i1', 'due', '')
    expect(ui.issueDatePicker).toEqual({
      id: 'i1',
      field: 'due',
      kind: 'issue',
      month: useClockStore().todayIso.slice(0, 7),
      ...anchorCalendar(rect, VP, 'issue'),
    })

    menus.openIssueDatePicker(
      triggerAt(rect.left, rect.top, rect.bottom),
      't1',
      'done',
      '2026-03-09',
      'task',
    )
    expect(ui.issueDatePicker).toMatchObject({
      id: 't1',
      field: 'done',
      kind: 'task',
      month: '2026-03',
    })
  })

  it('開各種浮層時記下觸發元素（給 useCloseOnScroll 判斷捲動有沒有把它帶走）', () => {
    const menus = useMenus()
    const e1 = triggerAt(10, 10, 30)
    menus.openOptionMenu(e1, 't1', 'status')
    expect(menuAnchors.option).toBe(e1.currentTarget)
    const e2 = triggerAt(10, 10, 30)
    menus.openTaskDatePicker(e2, 't1')
    expect(menuAnchors.taskDate).toBe(e2.currentTarget)
    const e3 = triggerAt(10, 10, 30)
    menus.toggleRowMenu(e3, 't1')
    expect(menuAnchors.row).toBe(e3.currentTarget)
    const e4 = triggerAt(10, 10, 30)
    menus.openIssueDatePicker(e4, 'i1', 'due', '')
    expect(menuAnchors.issueDate).toBe(e4.currentTarget)
  })

  it('clearMenuAnchors 放掉四種觸發元素（離開 Dashboard 時呼叫，不抓著已脫離的 DOM）', () => {
    const menus = useMenus()
    menus.openOptionMenu(triggerAt(10, 10, 30), 't1', 'status')
    menus.openTaskDatePicker(triggerAt(10, 10, 30), 't1')
    menus.toggleRowMenu(triggerAt(10, 10, 30), 't1')
    menus.openIssueDatePicker(triggerAt(10, 10, 30), 'i1', 'due', '')
    clearMenuAnchors()
    expect(menuAnchors).toEqual({ option: null, row: null, taskDate: null, issueDate: null })
  })
})

/**
 * 起訖日期選擇器預設對準哪一端（規則見 docs/reference/scheduling.md）：
 * 有前置、還沒開始的任務，開始日由前置決定、不能改，所以直接對準結束日；其他從開始日填起。
 */
describe('useMenus 的起訖日期選擇器對準哪一端', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('有前置、未開始的 t5：對準結束日，月份跟著結束日（10/07）', () => {
    useMenus().openTaskDatePicker(triggerAt(0, 0, 0), 't5')
    expect(useUiStore().taskDatePicker).toMatchObject({ target: 'end', month: '2026-10' })
  })

  it('未開始的根任務 t24：對準開始日', () => {
    useMenus().openTaskDatePicker(triggerAt(0, 0, 0), 't24')
    expect(useUiStore().taskDatePicker?.target).toBe('start')
  })
})

describe('useMenus 的唯讀（F2）', () => {
  it('唯讀時四種浮層都不開，也不記觸發元素', () => {
    const project = useProjectStore()
    project.setAll(project.meta, false)
    clearMenuAnchors()
    const ui = useUiStore()
    const menus = useMenus()

    menus.openOptionMenu(triggerAt(10, 10, 30), 't1', 'status')
    menus.openTaskDatePicker(triggerAt(10, 10, 30), 't1')
    menus.toggleRowMenu(triggerAt(10, 10, 30), 't1')
    menus.openIssueDatePicker(triggerAt(10, 10, 30), 'i1', 'due', '')

    expect([ui.optionMenu, ui.taskDatePicker, ui.rowMenu, ui.issueDatePicker]).toEqual([
      null,
      null,
      null,
      null,
    ])
    expect(menuAnchors).toEqual({ option: null, row: null, taskDate: null, issueDate: null })
  })
})
