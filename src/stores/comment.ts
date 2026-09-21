import { defineStore } from 'pinia'
import { ref } from 'vue'
import { dayIndex } from '@/lib/date'
import { nextId } from '@/lib/id'
import { useMemberStore } from '@/stores/member'
import { useUiStore } from '@/stores/ui'
import type { Attachment, Comment } from '@/types/models'

/** 詳細視窗裡的檔案列，比 Attachment 多一個穩定的 id 與作者名。 */
export type CommentFile = Attachment & { id: string; by: string }

/** Date → 本地 'YYYY-MM-DD'。legacy :2187 同樣用 getFullYear/getMonth/getDate。 */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

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

  /**
   * 送出留言；作者是目前登入者，草稿全空就不送。legacy `sendComment` :2188。
   *
   * review M1：日期與時分要出自同一個本地時鐘（legacy :2186-2188 用
   * getFullYear/getMonth/getDate）。這裡直接從 `ui.now` 取本地欄位，不繞 `ui.todayIso`，
   * 免得日索引換算方式改動時又出現「本地時分配 UTC 日期」的組合。
   */
  function send(targetId: string, targetKind: 'task' | 'issue'): void {
    if (!draft.value.trim() && !draftFiles.value.length) return
    const ui = useUiStore()
    const now = new Date(ui.now)
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = localDay(now)
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
    // 不走 resetDraft：blob url 已經轉給這則留言，revoke 掉縮圖就壞了
    clearDraft()
  }

  /**
   * 把使用者選的 / 貼上的檔案加進草稿；圖片才建 blob url。legacy `addDraftFiles` :2206。
   * review M1：附件日期同樣取本地日（送出時 `send` 會再蓋一次同一天的值）。
   */
  function addDraftFiles(files: FileList | File[]): void {
    const ui = useUiStore()
    const picked = Array.from(files ?? []).map((f) => ({
      name: f.name || '貼上的圖片-' + Date.now() + '.png',
      size: f.size,
      at: localDay(new Date(ui.now)),
      url: (f.type || '').startsWith('image') ? URL.createObjectURL(f) : '',
    }))
    if (picked.length) draftFiles.value.push(...picked)
  }

  /**
   * 釋放附件的 blob url。
   * review m1：`addDraftFiles` 對圖片建 `URL.createObjectURL`，不 revoke 就一路佔著記憶體。
   * 已經送出的留言不走這裡——列表還要靠那個 url 顯示縮圖。
   */
  function revoke(files: Attachment[]): void {
    for (const f of files) if (f.url) URL.revokeObjectURL(f.url)
  }

  /** 移掉草稿裡第 i 個附件，順手釋放它的 blob url。 */
  function removeDraft(i: number): void {
    const [gone] = draftFiles.value.splice(i, 1)
    if (gone) revoke([gone])
  }

  /** 刪掉一則留言。legacy `onDelete` :3878 */
  function remove(commentId: string): void {
    comments.value = comments.value.filter((c) => c.id !== commentId)
  }

  /** 只清欄位，不動 blob url（送出留言時用：url 的所有權交給那則留言了）。 */
  function clearDraft(): void {
    draft.value = ''
    draftFiles.value = []
  }

  /**
   * 清草稿；開詳情時呼叫，避免上一個任務打到一半的字跟過去。
   * review m1：沒送出的附件連同它的 blob url 一起丟掉。
   */
  function resetDraft(): void {
    revoke(draftFiles.value)
    clearDraft()
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
