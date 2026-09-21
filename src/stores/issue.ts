import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { nextId } from '@/lib/id'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Issue } from '@/types/models'

/** Issue 清單與它的增刪改。Issue 一定掛在某個任務底下。 */
export const useIssueStore = defineStore('issue', () => {
  const issues = ref<Issue[]>([])

  /** id → Issue 的索引，避免每次 find 掃全表。legacy `idx('issues')` :1901 */
  const index = computed(() => new Map(issues.value.map((i) => [i.id, i])))

  function byId(id: string): Issue | undefined {
    return index.value.get(id)
  }

  /** 某個任務底下的 Issue，維持原始順序（排序由 lib/sort 另外做）。 */
  function byTask(taskId: string): Issue[] {
    return issues.value.filter((i) => i.taskId === taskId)
  }

  /** 未結案的 Issue 數；篩選、排序與卡片上的紅點都讀它。legacy `matchIssue` 內的 filter :2240 */
  function openCount(taskId: string): number {
    return issues.value.filter((i) => i.taskId === taskId && i.status !== 'closed').length
  }

  /**
   * 在任務底下開一筆 Issue。legacy `onAddIssue` :3109。
   * 建立者取任務第一位負責人，沒有負責人就掛在目前登入者身上；期限預設跟任務結束日同一天。
   */
  function addIssue(taskId: string): Issue | null {
    const task = useTaskStore().taskById(taskId)
    if (!task) return null
    const issue: Issue = {
      id: nextId('i'),
      taskId,
      created: useUiStore().todayIso,
      title: '新 Issue（點擊可改名）',
      item: 'F',
      level: 'C',
      creatorId: task.assigneeIds[0] ?? useMemberStore().currentUserId,
      ownerIds: task.assigneeIds.slice(0, 1),
      status: 'open',
      due: task.end,
      done: '',
      ptype: '',
      pcb: '',
      bios: '',
      os: '',
      desc: '',
      solution: '',
      solvedBios: '',
    }
    issues.value.push(issue)
    return issue
  }

  /** 改 Issue 欄位；進 closed 補完成日、離開 closed 清掉。legacy `setIssue` :2280 */
  function updateIssue(id: string, patch: Partial<Issue>): void {
    const i = byId(id)
    if (!i) return
    const oldStatus = i.status
    Object.assign(i, patch)
    if (patch.status && patch.status !== oldStatus) {
      if (patch.status === 'closed') {
        if (!i.done) i.done = useUiStore().todayIso
      } else if (oldStatus === 'closed') {
        i.done = ''
      }
    }
  }

  /** 刪一筆 Issue，順手清掉指向它的選取與詳細視窗。legacy `iConfirmDelete` :4076 / :3344 */
  function removeIssue(id: string): void {
    issues.value = issues.value.filter((x) => x.id !== id)
    const sel = useSelectionStore()
    if (sel.issueId === id) sel.issueId = null
    const ui = useUiStore()
    if (ui.detail && ui.detail.kind === 'issue' && ui.detail.id === id) ui.closeDetail()
    if (ui.confirm && ui.confirm.kind === 'issue' && ui.confirm.id === id) ui.confirm = null
    delete ui.expandedIssues[id]
  }

  return { issues, byId, byTask, openCount, addIssue, updateIssue, removeIssue }
})
