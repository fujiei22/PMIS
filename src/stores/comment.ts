import { defineStore } from 'pinia'
import { ref } from 'vue'
import { dayIndex } from '@/lib/date'
import { nextId } from '@/lib/id'
import { useMemberStore } from '@/stores/member'
import { useUiStore } from '@/stores/ui'
import type { Attachment, Comment } from '@/types/models'

/** 詳細視窗裡的檔案列，比 Attachment 多一個穩定的 id 與作者名。 */
export type CommentFile = Attachment & { id: string; by: string }

/**
 * 留言與附件。
 * 篩選條件（日期 / 成員）、頁籤、檢視模式沿用 legacy：跨次開啟保留；
 * 草稿與檔案多選則每次開啟詳情就清（openDetail 呼叫 resetDraft）。
 */
export const useCommentStore = defineStore('comment', () => {
  const comments = ref<Comment[]>([])

  /** 正在打的留言與夾帶的附件。legacy `draft` / `draftFiles` :1600 */
  const draft = ref('')
  const draftFiles = ref<Attachment[]>([])

  /** 留言篩選：日期區間與成員。legacy `cD1` / `cD2` / `cMem` :1596 */
  const dateFrom = ref('')
  const dateTo = ref('')
  const memberIds = ref<string[]>([])

  /** 頁籤與檔案檢視模式。legacy `cTab` / `fileView` / `fileSel` :1595 */
  const tab = ref<'comments' | 'files'>('comments')
  const fileView = ref<'icon' | 'list'>('icon')
  const fileSel = ref<string[]>([])

  /** 留言時間是否落在篩選區間內；兩端都空就不篩。legacy `cDateOk` :2161 */
  function dateOk(at: string): boolean {
    if (!dateFrom.value && !dateTo.value) return true
    const d = dayIndex(at.slice(0, 10))
    const a = dateFrom.value ? dayIndex(dateFrom.value) : -Infinity
    const b = dateTo.value ? dayIndex(dateTo.value) : Infinity
    return d >= Math.min(a, b) && d <= Math.max(a, b)
  }

  /** 某個任務 / Issue 的留言，套篩選後依時間倒序。legacy `taskComments` :2215 */
  function forTarget(id: string): Comment[] {
    return comments.value
      .filter(
        (c) =>
          c.targetId === id &&
          dateOk(c.at) &&
          (!memberIds.value.length || memberIds.value.includes(c.memberId)),
      )
      .sort((a, b) => (a.at < b.at ? 1 : -1))
  }

  /** 把留言裡的附件攤平成檔案列；id 用 留言id:索引，時間倒序。legacy `cFiles` :3379 */
  function filesForTarget(id: string): CommentFile[] {
    const members = useMemberStore()
    const out: CommentFile[] = []
    for (const c of forTarget(id)) {
      const m = members.byId(c.memberId)
      c.files.forEach((f, i) => {
        out.push({ ...f, id: c.id + ':' + i, by: m ? m.name : '成員' })
      })
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : -1))
  }

  /** 在這個目標留過言的成員 id（不套篩選，供篩選選單用）。legacy `commenterIds` :3353 */
  function commenterIds(id: string): string[] {
    const out: string[] = []
    for (const c of comments.value) {
      if (c.targetId === id && !out.includes(c.memberId)) out.push(c.memberId)
    }
    return out
  }

  /** 送出留言；作者是目前登入者，草稿全空就不送。legacy `sendComment` :2188 */
  function send(targetId: string, targetKind: 'task' | 'issue'): void {
    if (!draft.value.trim() && !draftFiles.value.length) return
    const ui = useUiStore()
    const now = new Date(ui.now)
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = ui.todayIso
    const at = day + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes())
    comments.value.push({
      id: nextId('c'),
      targetId,
      targetKind,
      memberId: useMemberStore().currentUserId,
      at,
      text: draft.value.trim(),
      files: draftFiles.value.map((f) => ({ name: f.name, size: f.size, at: day, url: f.url ?? '' })),
    })
    resetDraft()
  }

  /** 把使用者選的 / 貼上的檔案加進草稿；圖片才建 blob url。legacy `addDraftFiles` :2206 */
  function addDraftFiles(files: FileList | File[]): void {
    const ui = useUiStore()
    const picked = Array.from(files ?? []).map((f) => ({
      name: f.name || '貼上的圖片-' + Date.now() + '.png',
      size: f.size,
      at: ui.todayIso,
      url: (f.type || '').startsWith('image') ? URL.createObjectURL(f) : '',
    }))
    if (picked.length) draftFiles.value.push(...picked)
  }

  /** 移掉草稿裡第 i 個附件。 */
  function removeDraft(i: number): void {
    draftFiles.value.splice(i, 1)
  }

  /** 刪掉一則留言。legacy `onDelete` :3878 */
  function remove(commentId: string): void {
    comments.value = comments.value.filter((c) => c.id !== commentId)
  }

  /** 清草稿；開詳情時呼叫，避免上一個任務打到一半的字跟過去。 */
  function resetDraft(): void {
    draft.value = ''
    draftFiles.value = []
  }

  return {
    comments,
    draft,
    draftFiles,
    dateFrom,
    dateTo,
    memberIds,
    tab,
    fileView,
    fileSel,
    forTarget,
    filesForTarget,
    commenterIds,
    send,
    addDraftFiles,
    removeDraft,
    remove,
    resetDraft,
  }
})
