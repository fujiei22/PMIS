import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useFilterStore } from '@/stores/filter'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 懸空旗標的位元：1=任務、2=Issue、4=分類。 */
const GONE_TASK = 1
const GONE_ISSUE = 2
const GONE_GROUP = 4

/**
 * 三面板共用的選取狀態。
 * 選取本身只是三個 id；各面板的高亮 / 淡化樣式由 related 與 softHighlight 推出來。
 */
export const useSelectionStore = defineStore('selection', () => {
  const taskId = ref<string | null>(null)
  const issueId = ref<string | null>(null)
  const groupId = ref<string | null>(null)

  /**
   * 各面板 watch 它來捲動到選取的項目。legacy `focus()` :2399。
   * seq 每次遞增，重複選同一個任務也會再觸發一次；src='card' 代表是從看板卡片點的，看板不再捲自己。
   */
  const focusRequest = ref<{ taskId: string; src: 'card' | null; seq: number } | null>(null)
  let seq = 0

  /** 選取任務的前置（up）與後續（down）任務。legacy `related()` :2389 */
  const related = computed<Record<string, 'up' | 'down'>>(() => {
    const out: Record<string, 'up' | 'down'> = {}
    const sel = taskId.value
    if (!sel) return out
    for (const d of useTaskStore().deps) {
      if (d.from === sel) out[d.to] = 'down'
      if (d.to === sel) out[d.from] = 'up'
    }
    return out
  })

  /** 關掉「只顯示篩選結果」又確實有篩選——此時不符者是淡化而不是隱藏。legacy `softFilter` :2703 */
  const softFilterActive = computed(() => {
    const f = useFilterStore()
    return !f.onlyFiltered && f.anyTaskFilter
  })

  /** 次級高亮：選取分類底下的任務，加上 soft 篩選命中的任務。legacy `gSel` :2701-2704 */
  const softHighlight = computed<Record<string, true>>(() => {
    const out: Record<string, true> = {}
    if (groupId.value) {
      for (const t of useTaskStore().tasks) if (t.groupId === groupId.value) out[t.id] = true
    }
    if (softFilterActive.value) {
      for (const id of useFilterStore().matchedIds) out[id] = true
    }
    return out
  })

  /** 有沒有任何形式的選取；有的話其餘項目要淡化。legacy `hasSel` :2705 */
  const hasSelection = computed(() => !!taskId.value || !!groupId.value || softFilterActive.value)

  /** 選一個任務並請各面板捲過去。legacy `selectTask` :2370 */
  function selectTask(id: string, src?: 'card'): void {
    taskId.value = id
    issueId.value = null
    groupId.value = null
    focusRequest.value = { taskId: id, src: src ?? null, seq: ++seq }
  }

  /** 已選就取消、否則選取。legacy `toggleTask` :2374 */
  function toggleTask(id: string, src?: 'card'): void {
    if (taskId.value === id) clear()
    else selectTask(id, src)
  }

  /**
   * 選一筆 Issue，連帶選到它的任務。legacy `onSelect` :3214。
   * 已選這筆、或它的任務已經被選著，都視為取消。
   */
  function selectIssue(id: string): void {
    const issue = useIssueStore().byId(id)
    if (!issue) return
    if (issueId.value === id || (taskId.value && taskId.value === issue.taskId)) {
      clear()
      return
    }
    issueId.value = id
    taskId.value = issue.taskId
    groupId.value = null
    focusRequest.value = { taskId: issue.taskId, src: null, seq: ++seq }
  }

  /** 切換分類選取，同時清掉任務 / Issue 選取與編輯中狀態。legacy `onFocus` :2788 */
  function toggleGroup(id: string): void {
    const ui = useUiStore()
    if (groupId.value === id) {
      groupId.value = null
    } else {
      groupId.value = id
      taskId.value = null
      issueId.value = null
    }
    ui.editing = null
  }

  /** 清掉所有選取。legacy `clearFocus` :2379 */
  function clear(): void {
    taskId.value = null
    issueId.value = null
    groupId.value = null
    const ui = useUiStore()
    ui.editing = null
    ui.pickerFor = null
  }

  /**
   * 懸空 id 清理（契約 E）。
   *
   * 資料層刪掉實體後不會回頭通知派生層——不管刪除是本地發起、樂觀還原，
   * 還是別的 client 推來的事件，都由這條 watch 統一收尾。
   * `flush: 'sync'` 是必要的：畫面不能有任何一個 tick 停在不存在的 id 上
   * （review M7）。getter 回一個位元遮罩，只有「懸空與否」變了才進 callback。
   */
  watch(
    () => {
      const tasks = useTaskStore()
      const issues = useIssueStore()
      return (
        (taskId.value && !tasks.taskById(taskId.value) ? GONE_TASK : 0) |
        (issueId.value && !issues.byId(issueId.value) ? GONE_ISSUE : 0) |
        (groupId.value && !tasks.groupById(groupId.value) ? GONE_GROUP : 0)
      )
    },
    (gone) => {
      if (gone & GONE_TASK) taskId.value = null
      if (gone & GONE_ISSUE) issueId.value = null
      if (gone & GONE_GROUP) groupId.value = null
    },
    { flush: 'sync' },
  )

  return {
    taskId,
    issueId,
    groupId,
    related,
    softHighlight,
    softFilterActive,
    hasSelection,
    selectTask,
    toggleTask,
    selectIssue,
    toggleGroup,
    clear,
    focusRequest,
  }
})
