import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { anyTaskFilter as anyTaskFilterOf, matchTask as matchTaskOf, type TaskFilter } from '@/lib/filter'
import {
  bumpSort,
  DEFAULT_ISSUE_SORT,
  DEFAULT_TASK_SORT,
  type SortKey,
} from '@/lib/sort'
import { useClockStore } from '@/stores/clock'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import type { ISODate, IssueLevel, IssueStatus, Priority, Task, TaskStatus } from '@/types/models'

/**
 * 頂部篩選列、Issue 面板篩選、兩個看板的排序。
 * 篩選條件本身是純資料，比對邏輯在 lib/filter.ts。
 */
export const useFilterStore = defineStore('filter', () => {
  // ── TaskFilter 各欄（legacy sel / fStatus / fPrio / fGroup / fIssue / fMode / fD1 / fD2）──
  const memberIds = ref<string[]>([])
  const statuses = ref<(TaskStatus | 'delayed')[]>([])
  const priorities = ref<Priority[]>([])
  const groupIds = ref<string[]>([])
  const issueMode = ref<'all' | 'has' | 'none'>('all')
  const dateMode = ref<'off' | 'gt' | 'lt' | 'between'>('off')
  const d1 = ref<ISODate | ''>('')
  const d2 = ref<ISODate | ''>('')

  /** 只顯示篩選結果（關掉就改成淡化不符者）。legacy `fOnly` :1565 */
  const onlyFiltered = ref(true)
  /** Issue 面板專屬篩選。legacy `fICls` / `fISt` :1571 */
  const issueLevels = ref<IssueLevel[]>([])
  const issueStatuses = ref<(IssueStatus | 'delayed')[]>([])

  const taskSort = ref<SortKey[]>([...DEFAULT_TASK_SORT])
  const issueSort = ref<SortKey[]>([...DEFAULT_ISSUE_SORT])
  /** Issue 面板的分組依據。legacy `iGroup` :1568 */
  const issueGroupBy = ref<'status' | 'level' | 'item'>('status')

  /** 篩選日曆正在填哪一端、顯示哪個月。legacy `calTarget` / `calMonth` :1586 */
  const calendarTarget = ref<'d1' | 'd2'>('d1')
  const calendarMonth = ref<string | null>(null)

  /** 打包成 lib/filter 吃的形狀。 */
  const filter = computed<TaskFilter>(() => ({
    memberIds: memberIds.value,
    statuses: statuses.value,
    priorities: priorities.value,
    groupIds: groupIds.value,
    issueMode: issueMode.value,
    dateMode: dateMode.value,
    d1: d1.value,
    d2: d2.value,
  }))

  /**
   * 所有任務跑一次 matchTask 的結果。
   * legacy 是每次 renderVals 清快取再逐筆算（:2033 的 _mtC），這裡改成一個 computed，
   * 任一條件或任務變動才重算。
   */
  const matchedIds = computed<Set<string>>(() => {
    const tasks = useTaskStore()
    const issues = useIssueStore()
    const clock = useClockStore()
    const ctx = { openIssueCount: issues.openCount, todayIdx: clock.todayIdx }
    const out = new Set<string>()
    for (const t of tasks.tasks) if (matchTaskOf(t, filter.value, ctx)) out.add(t.id)
    return out
  })

  /**
   * 甘特與看板面板頭上的「共 N 個任務」／「已篩選 N/M 個任務」。legacy `taskCountLabel` :3532。
   * review m4：兩個面板各抄一份、各自再跑一次 `matchTask`；這裡直接吃 `matchedIds.size`。
   */
  const taskCountLabel = computed(() => {
    const total = useTaskStore().tasks.length
    const matched = matchedIds.value.size
    return matched === total ? `共 ${total} 個任務` : `已篩選 ${matched}/${total} 個任務`
  })

  /** 任務符不符合篩選（Issue 面板與計數用，不受「只顯示篩選結果」影響）。legacy :3113 / :3527 */
  function matchTask(t: Task): boolean {
    return matchedIds.value.has(t.id)
  }

  /** 任務要不要出現在甘特 / 看板上。legacy `passTask` :2022 */
  function passTask(t: Task): boolean {
    return onlyFiltered.value ? matchTask(t) : true
  }

  const anyTaskFilter = computed(() => anyTaskFilterOf(filter.value))
  /** 含 Issue 專屬篩選；「清除篩選」按鈕的啟用狀態看它。 */
  const anyFilter = computed(
    () => anyTaskFilter.value || issueLevels.value.length > 0 || issueStatuses.value.length > 0,
  )

  /**
   * 全部篩選回初始值；排序與「只顯示篩選結果」不動。legacy `clearFilter` :3794。
   * 只動篩選條件——關掉日曆是畫面的事，由呼叫端做（契約 E）。
   */
  function clear(): void {
    memberIds.value = []
    statuses.value = []
    priorities.value = []
    groupIds.value = []
    issueMode.value = 'all'
    dateMode.value = 'off'
    d1.value = ''
    d2.value = ''
    issueLevels.value = []
    issueStatuses.value = []
    calendarMonth.value = null
  }

  /** 點一次任務排序鍵：沒有就加、有就翻方向。legacy `bumpSort('kSort')` :2104 */
  function bumpTaskSort(k: string): void {
    taskSort.value = bumpSort(taskSort.value, k)
  }

  /** 移掉一個任務排序鍵。legacy `dropSort` :2114 */
  function dropTaskSort(k: string): void {
    taskSort.value = taskSort.value.filter((x) => x.k !== k)
  }

  /** 回到預設排序（時程 asc）；複製一份，別讓常數被後續 bump 改到。 */
  function resetTaskSort(): void {
    taskSort.value = DEFAULT_TASK_SORT.map((s) => ({ ...s }))
  }

  function bumpIssueSort(k: string): void {
    issueSort.value = bumpSort(issueSort.value, k)
  }

  function dropIssueSort(k: string): void {
    issueSort.value = issueSort.value.filter((x) => x.k !== k)
  }

  function resetIssueSort(): void {
    issueSort.value = DEFAULT_ISSUE_SORT.map((s) => ({ ...s }))
  }

  return {
    memberIds,
    statuses,
    priorities,
    groupIds,
    issueMode,
    dateMode,
    d1,
    d2,
    onlyFiltered,
    issueLevels,
    issueStatuses,
    taskSort,
    issueSort,
    issueGroupBy,
    calendarTarget,
    calendarMonth,
    filter,
    matchedIds,
    taskCountLabel,
    matchTask,
    passTask,
    anyTaskFilter,
    anyFilter,
    clear,
    bumpTaskSort,
    dropTaskSort,
    resetTaskSort,
    bumpIssueSort,
    dropIssueSort,
    resetIssueSort,
  }
})
