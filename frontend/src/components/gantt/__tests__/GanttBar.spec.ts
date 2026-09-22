import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi as maybeMockApi } from '@/api'
import GanttBar from '@/components/gantt/GanttBar.vue'
import { ROW_HEIGHT } from '@/constants/dashboard'
import { dayIndex } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/**
 * 契約 G：`GanttBar` 是 fragment root（`.bar` 與兩個 `.dot-zone` 為兄弟）、
 * props 是 task / summary 的 discriminated union、樣式拆成多顆小 computed。
 *
 * 重點是「一條的 hover 不會讓別條重畫」——所以效能那條測試用
 * `onVnodeUpdated` 數每條自己的 update 次數（review C6、Eng Major 5）。
 */

let pinia: Pinia

/** 讓所有任務都還沒到期，delayed 由需要的那條測試自己調時鐘。 */
const BEFORE_ALL = Date.parse('2026-09-10T03:00:00Z')

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  mockApi.reset(structuredClone(sampleProject))
  useTaskStore().load(structuredClone(sampleProject))
  useClockStore().now = BEFORE_ALL
})

/** 掛一條任務條；回傳 wrapper。 */
function mountTask(id: string, rowIndex = 1) {
  const task = useTaskStore().taskById(id)!
  return mount(GanttBar, {
    props: { kind: 'task' as const, task, rowIndex },
    global: { plugins: [pinia] },
  })
}

describe('GanttBar 的視覺狀態（契約 G、legacy :496-513）', () => {
  it('任務條：fragment root，`.bar` 與兩個 `.dot-zone` 是兄弟', () => {
    const w = mountTask('t3')
    const bar = w.find('.bar')
    const zones = w.findAll('.dot-zone')
    expect(bar.exists()).toBe(true)
    expect(zones).toHaveLength(2)
    // 沒有包一層 wrapper：三個元素同一個父節點（e2e/helpers/compare.ts 的 offsetParent 幾何比對靠這個）
    expect(zones[0]!.element.parentElement).toBe(bar.element.parentElement)
    expect(zones[1]!.element.parentElement).toBe(bar.element.parentElement)
    expect(zones.map((z) => z.attributes('data-linkfor'))).toEqual(['t3', 't3'])
  })

  it('任務條：data-taskid / data-status / 位置與寬度', () => {
    const ui = useUiStore()
    const t = useTaskStore().taskById('t3')!
    const w = mountTask('t3', 4)
    const bar = w.find('.bar')
    expect(bar.attributes('data-taskid')).toBe('t3')
    expect(bar.attributes('data-status')).toBe('doing')
    expect(bar.attributes('style')).toContain(
      `left: ${(dayIndex(t.start) - useTaskStore().range.a) * ui.dayWidth}px`,
    )
    expect(bar.attributes('style')).toContain(`top: ${4 * ROW_HEIGHT + 6}px`)
    expect(bar.attributes('style')).toContain(`width: ${9 * ui.dayWidth}px`)
    expect(bar.text()).toContain('前端框架建置')
  })

  it('摘要條：data-taskid 是 sum-<gid>、有 summary class、沒有圓點', () => {
    const group = useTaskStore().groupById('g1')!
    const ui = useUiStore()
    const w = mount(GanttBar, {
      props: { kind: 'summary' as const, group, rowIndex: 0, a: 10, b: 14 },
      global: { plugins: [pinia] },
    })
    const bar = w.find('.bar')
    expect(bar.attributes('data-taskid')).toBe('sum-g1')
    expect(bar.classes()).toContain('summary')
    expect(bar.attributes('data-status')).toBeUndefined()
    expect(bar.attributes('title')).toBe('前端開發（收合）')
    expect(bar.attributes('style')).toContain(`width: ${5 * ui.dayWidth}px`)
    expect(bar.attributes('style')).toContain(`top: ${0 * ROW_HEIGHT + 12}px`)
    expect(w.findAll('.dot-zone')).toHaveLength(0)
  })

  it('選取：selected class（ring）＋把手可以吃事件', () => {
    useSelectionStore().selectTask('t3')
    const w = mountTask('t3')
    expect(w.find('.bar').classes()).toContain('selected')
    expect(w.findAll('.handle.live')).toHaveLength(2)
  })

  it('前置任務：rel-up', () => {
    useSelectionStore().selectTask('t4')
    const w = mountTask('t3')
    expect(w.find('.bar').classes()).toContain('rel-up')
    expect(w.find('.bar').classes()).not.toContain('dimmed')
  })

  it('後續任務：rel-down', () => {
    useSelectionStore().selectTask('t4')
    const w = mountTask('t5')
    expect(w.find('.bar').classes()).toContain('rel-down')
  })

  it('不相關的條：dimmed', () => {
    useSelectionStore().selectTask('t4')
    const w = mountTask('t6')
    const cls = w.find('.bar').classes()
    expect(cls).toContain('dimmed')
    expect(cls).not.toContain('selected')
  })

  it('逾期：data-status 蓋成 delayed', () => {
    // t3 的 end 是 2026-09-16，status 還是 doing
    useClockStore().now = Date.parse('2026-09-20T03:00:00Z')
    const w = mountTask('t3')
    expect(w.find('.bar').attributes('data-status')).toBe('delayed')
  })

  it('選取中 hover 才亮圓點（hovered = selected && hoverTaskId）', async () => {
    const ui = useUiStore()
    useSelectionStore().selectTask('t3')
    const w = mountTask('t3')
    expect(w.findAll('.dot-zone.shown')).toHaveLength(0)

    ui.hoverTaskId = 't3'
    await nextTick()
    expect(w.findAll('.dot-zone.shown')).toHaveLength(2)
  })
})

describe('GanttBar 的重繪範圍（契約 G、review C6）', () => {
  it('t6 的 hover 不會讓 t3 重畫', async () => {
    const ui = useUiStore()
    const selection = useSelectionStore()
    const taskStore = useTaskStore()
    const counts: Record<string, number> = { t3: 0, t6: 0 }

    const Host = defineComponent({
      setup() {
        return () => [
          h(GanttBar, {
            kind: 'task',
            task: taskStore.taskById('t3')!,
            rowIndex: 3,
            onVnodeUpdated: () => {
              counts.t3 = (counts.t3 ?? 0) + 1
            },
          }),
          h(GanttBar, {
            kind: 'task',
            task: taskStore.taskById('t6')!,
            rowIndex: 6,
            onVnodeUpdated: () => {
              counts.t6 = (counts.t6 ?? 0) + 1
            },
          }),
        ]
      },
    })

    mount(Host, { global: { plugins: [pinia] } })
    // 先把選取造成的重畫吃掉，再開始數
    selection.selectTask('t6')
    await nextTick()
    counts.t3 = 0
    counts.t6 = 0

    ui.hoverTaskId = 't6'
    await nextTick()

    expect(counts.t6).toBeGreaterThan(0)
    expect(counts.t3).toBe(0)
  })
})