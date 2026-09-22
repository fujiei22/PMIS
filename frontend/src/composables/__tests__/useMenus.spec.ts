import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMenus } from '@/composables/useMenus'
import { anchorCalendar, anchorOptionMenu } from '@/lib/anchor'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
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

    menus.openIssueDatePicker(triggerAt(rect.left, rect.top, rect.bottom), 't1', 'done', '2026-03-09', 'task')
    expect(ui.issueDatePicker).toMatchObject({ id: 't1', field: 'done', kind: 'task', month: '2026-03' })
  })
})
