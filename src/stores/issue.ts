import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api'
import type { ProjectEvent } from '@/api/types'
import { newId } from '@/lib/id'
import {
  applyServerValue,
  cloneEntity,
  createTracker,
  resetTracker,
  runOptimistic,
} from '@/stores/_optimistic'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import type { Issue, Task } from '@/types/models'

/** Issue 清單與它的增刪改。Issue 一定掛在某個任務底下。 */
export const useIssueStore = defineStore('issue', () => {
  const issues = ref<Issue[]>([])
  /** 最後已知的 server 狀態（契約 B）。 */
  const tracker = createTracker<Issue>()

  /** id → Issue 的索引，避免每次 find 掃全表。legacy `idx('issues')` :1901 */
  const index = computed(() => new Map(issues.value.map((i) => [i.id, i])))

  function byId(id: string): Issue | undefined {
    return index.value.get(id)
  }

  /** 某個任務底下的 Issue，維持原始順序（排序由 lib/sort 另外做）。 */
  function byTask(taskId: string): Issue[] {
    return issues.value.filter((i) => i.taskId === taskId)
  }

  /**
   * taskId → 未結案的 Issue 數。
   * spec 目標 7：改成一顆 Map computed，30 張卡不再各掃一次全表。
   */
  const openCounts = computed(() => {
    const out = new Map<string, number>()
    for (const i of issues.value) {
      if (i.status === 'closed') continue
      out.set(i.taskId, (out.get(i.taskId) ?? 0) + 1)
    }
    return out
  })

  /** 未結案的 Issue 數；篩選、排序與卡片上的紅點都讀它。legacy `matchIssue` 內的 filter :2240 */
  function openCount(taskId: string): number {
    return openCounts.value.get(taskId) ?? 0
  }

  /** 載入時整份換掉並重置 tracker。 */
  function setAll(list: Issue[]): void {
    issues.value = list
    resetTracker(tracker, list)
  }

  /** 連動刪除時由 taskStore 呼叫：只動本地。 */
  function dropLocal(ids: string[]): void {
    if (!ids.length) return
    const gone = new Set(ids)
    issues.value = issues.value.filter((i) => !gone.has(i.id))
  }

  /** 連動刪除還原時由 taskStore 呼叫。 */
  function restoreLocal(list: Issue[]): void {
    issues.value = list
  }

  /** 連動刪除成功後，把 server 狀態也清掉。 */
  function dropServer(ids: string[]): void {
    for (const id of ids) tracker.server.delete(id)
  }

  function reconcile(server: Issue | undefined, id: string): void {
    const i = issues.value.findIndex((x) => x.id === id)
    if (!server) {
      if (i >= 0) issues.value.splice(i, 1)
      return
    }
    if (i >= 0) issues.value[i] = { ...server }
    else issues.value.push({ ...server })
  }

  /**
   * 在任務底下開一筆 Issue。legacy `onAddIssue` :3109。
   *
   * 任務與建立者由呼叫端給（`useTaskActions().addIssueForTask`）——
   * 「沒有負責人就掛目前登入者」要讀 member store，留在呼叫端一起算（契約 E）。
   * 期限預設跟任務結束日同一天。
   */
  function addIssue(task: Task, creatorId: string): Issue {
    const issue: Issue = {
      id: newId(),
      taskId: task.id,
      created: useClockStore().todayIso,
      title: '新 Issue（點擊可改名）',
      item: 'F',
      level: 'C',
      creatorId,
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
    void runOptimistic<Issue>({
      tracker,
      ids: [issue.id],
      label: '新增 Issue',
      apply: () => {},
      call: () => api.createIssue(cloneEntity(issue)),
      reconcile,
    })
    return issue
  }

  /** 只改本地（逐鍵編輯的每一鍵走這條）。legacy `setIssue` :2280 */
  function applyLocalPatch(id: string, patch: Partial<Issue>): Partial<Issue> | null {
    const i = byId(id)
    if (!i) return null
    const next = { ...patch }
    const oldStatus = i.status
    if (patch.status && patch.status !== oldStatus) {
      // 後端不跑這條規則（契約 A）：前端算完把 done 一起送出去
      if (patch.status === 'closed') {
        if (!i.done) next.done = useClockStore().todayIso
      } else if (oldStatus === 'closed') {
        next.done = ''
      }
    }
    Object.assign(i, next)
    return next
  }

  /**
   * 只把變更送出去（本地已經改好了）；逐鍵編輯 debounce 到期時走這條。
   * 它不看本地有沒有變——`useEditDraft` 已經逐鍵 apply 過了。
   */
  async function commitIssuePatch(id: string, patch: Partial<Issue>): Promise<void> {
    await runOptimistic<Issue>({
      tracker,
      ids: [id],
      label: '更新 Issue',
      apply: () => {},
      call: () => api.updateIssue(id, cloneEntity(patch)),
      reconcile,
    })
  }

  /** 改 Issue 欄位；進 closed 補完成日、離開 closed 清掉，然後送給後端。 */
  async function updateIssue(id: string, patch: Partial<Issue>): Promise<void> {
    const sent = applyLocalPatch(id, patch)
    if (!sent) return
    await commitIssuePatch(id, sent)
  }

  /**
   * 刪一筆 Issue（連它的留言）。legacy `iConfirmDelete` :4076。
   * 指到它的選取 / 詳細視窗 / 確認框由派生層的 watch 自己清（契約 E）。
   */
  async function removeIssue(id: string): Promise<void> {
    if (!byId(id)) return
    const comments = useCommentStore()
    const snapshot = { issues: issues.value, comments: comments.comments }
    const goneComments = comments.comments.filter((c) => c.targetId === id).map((c) => c.id)

    issues.value = issues.value.filter((x) => x.id !== id)
    comments.dropLocal(goneComments)

    let ok = false
    await runOptimistic<Issue>({
      tracker,
      ids: [id],
      label: '刪除 Issue',
      apply: () => {},
      call: async () => {
        await api.deleteIssue(id)
        ok = true
        tracker.server.delete(id)
        comments.dropServer(goneComments)
      },
      reconcile: () => {
        if (ok) return
        issues.value = snapshot.issues
        comments.restoreLocal(snapshot.comments)
      },
    })
  }

  /** 後端推來的 Issue 事件；`_sync.ts` 路由過來。 */
  function applyEvent(e: ProjectEvent): void {
    switch (e.type) {
      case 'issue.created':
      case 'issue.updated':
        applyServerValue(tracker, e.payload.id, e.payload, reconcile)
        break
      case 'issue.deleted':
        applyServerValue(tracker, e.payload.id, undefined, reconcile)
        break
    }
  }

  return {
    issues,
    byId,
    byTask,
    openCounts,
    openCount,
    setAll,
    dropLocal,
    restoreLocal,
    dropServer,
    addIssue,
    applyLocalPatch,
    updateIssue,
    commitIssuePatch,
    removeIssue,
    applyEvent,
  }
})
