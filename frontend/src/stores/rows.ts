import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useFilterStore } from '@/stores/filter'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 甘特左欄的一列：分類（g）或任務（t）。 */
export interface VisibleRow {
  kind: 'g' | 't'
  id: string
}

/**
 * 甘特左欄實際會畫出來的列（派生層，契約 E）。
 *
 * 它同時要看三件事：資料層的分類 / 任務順序、`ui.collapsedGroups`、
 * `filter.passTask`。放在 taskStore 的話資料層就得反向認識 ui 與 filter，
 * 所以 R3 把它搬到這顆只讀不寫的派生 store（review C4）。
 */
export const useRowsStore = defineStore('rows', () => {
  /**
   * 每個分類一列，未收合時接上通過篩選的任務。
   * legacy `visible()` :2260
   */
  const visibleRows = computed<VisibleRow[]>(() => {
    const taskStore = useTaskStore()
    const filter = useFilterStore()
    const collapsed = useUiStore().collapsedGroups
    const out: VisibleRow[] = []
    for (const g of taskStore.groups) {
      out.push({ kind: 'g', id: g.id })
      if (collapsed.has(g.id)) continue
      for (const t of taskStore.tasks) {
        if (t.groupId === g.id && filter.passTask(t)) out.push({ kind: 't', id: t.id })
      }
    }
    return out
  })

  /** 任務 id → 它在 visibleRows 的索引，甘特條算 top 用。legacy `rowOf` :2711 */
  const rowIndexOf = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    visibleRows.value.forEach((v, i) => {
      if (v.kind === 't') out[v.id] = i
    })
    return out
  })

  return { visibleRows, rowIndexOf }
})
