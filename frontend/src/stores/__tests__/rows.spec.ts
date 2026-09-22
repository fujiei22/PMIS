import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useFilterStore } from '@/stores/filter'
import { useRowsStore } from '@/stores/rows'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const NOW = Date.parse('2026-09-18T10:00:00Z')

/**
 * `rows` 是派生層（契約 E）：甘特左欄真正會畫出來的列。
 * 它讀資料層的 groups / tasks，加上 ui 的收合與 filter 的篩選——
 * 資料層不必知道這兩件事，所以 visibleRows 從 taskStore 搬到這裡。
 */
describe('rowsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useClockStore().now = NOW
    useTaskStore().load(structuredClone(sampleProject))
  })

  it('每個分類一列、未收合時接上底下的任務', () => {
    const rows = useRowsStore()
    const tasks = useTaskStore()
    expect(rows.visibleRows).toHaveLength(tasks.groups.length + tasks.tasks.length)
    expect(rows.visibleRows[0]).toEqual({ kind: 'g', id: 'g1' })
    expect(rows.visibleRows[1]).toEqual({ kind: 't', id: 't1' })
  })

  it('收合的分類只留分類自己那一列（讀 ui.collapsedGroups）', () => {
    const rows = useRowsStore()
    const tasks = useTaskStore()
    const ui = useUiStore()
    const g1 = tasks.tasks.filter((t) => t.groupId === 'g1').length
    expect(g1).toBeGreaterThan(0)

    ui.toggleGroup('g1')
    expect(rows.visibleRows).toHaveLength(tasks.groups.length + tasks.tasks.length - g1)
    expect(rows.visibleRows.some((v) => v.kind === 'g' && v.id === 'g1')).toBe(true)

    ui.collapsedGroups = new Set(tasks.groups.map((g) => g.id))
    expect(rows.visibleRows).toHaveLength(tasks.groups.length)
  })

  it('不通過 filter.passTask 的任務不出現', () => {
    const rows = useRowsStore()
    const tasks = useTaskStore()
    const filter = useFilterStore()
    filter.statuses = ['done']
    const kept = tasks.tasks.filter((t) => filter.passTask(t)).length
    expect(kept).toBeLessThan(tasks.tasks.length)
    expect(rows.visibleRows).toHaveLength(tasks.groups.length + kept)

    // 關掉「只顯示篩選結果」就是淡化而不是隱藏，列數回到全部
    filter.onlyFiltered = false
    expect(rows.visibleRows).toHaveLength(tasks.groups.length + tasks.tasks.length)
  })

  it('rowIndexOf 只收任務列，值等於它在 visibleRows 的索引', () => {
    const rows = useRowsStore()
    const tasks = useTaskStore()
    expect(rows.rowIndexOf.t1).toBe(1)
    expect(Object.keys(rows.rowIndexOf)).toHaveLength(tasks.tasks.length)
    for (const [id, i] of Object.entries(rows.rowIndexOf)) {
      expect(rows.visibleRows[i]).toEqual({ kind: 't', id })
    }
    // 收合後那個分類底下的任務就沒有索引了
    useUiStore().toggleGroup('g1')
    expect(rows.rowIndexOf.t1).toBeUndefined()
  })

  it('資料層不再提供 visibleRows / rowIndexOf', () => {
    const tasks = useTaskStore() as unknown as Record<string, unknown>
    expect(tasks.visibleRows).toBeUndefined()
    expect(tasks.rowIndexOf).toBeUndefined()
  })
})
