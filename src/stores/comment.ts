import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import type { ProjectEvent } from '@/api/types'
import { dayIndex } from '@/lib/date'
import { newId } from '@/lib/id'
import {
  applyServerValue,
  cloneEntity,
  createTracker,
  insertIndexOf,
  resetTracker,
  runOptimistic,
} from '@/stores/_optimistic'
import { useClockStore } from '@/stores/clock'
import { useMemberStore } from '@/stores/member'
import type { Attachment, Comment } from '@/types/models'

/** 詳細視窗裡的檔案列，比 Attachment 多一個作者名。 */
export type CommentFile = Attachment & { by: string }

/**
 * 草稿附件：除了顯示用的 Attachment，還抓著原始 `File`（review C2）——
 * `api.createComment(comment, files)` 是 multipart，真的要送出去的是檔案本身。
 */
export type CommentDraftFile = Attachment & { file: File }

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
  /** 最後已知的 server 狀態（契約 B）。 */
  const tracker = createTracker<Comment>()

  /** 正在打的留言與夾帶的附件。legacy `draft` / `draftFiles` :1600 */
  const draft = ref('')
  const draftFiles = ref<CommentDraftFile[]>([])

  /** 留言篩選：日期區間與成員。legacy `cD1` / `cD2` / `cMem` :1596 */
  const dateFrom = ref('')
  const dateTo = ref('')
  const memberIds = ref<string[]>([])

  /** 頁籤與檔案檢視模式。legacy `cTab` / `fileView` / `fileSel` :1595 */
  const tab = ref<'comments' | 'files'>('comments')
  const fileView = ref<'icon' | 'list'>('icon')
  const fileSel = ref<string[]>([])

  /** 載入時整份換掉並重置 tracker。 */
  function setAll(list: Comment[]): void {
    comments.value = list
    resetTracker(tracker, list)
  }

  /** 連動刪除時由 task / issue store 呼叫：只動本地。 */
  function dropLocal(ids: string[]): void {
    if (!ids.length) return
    const gone = new Set(ids)
    comments.value = comments.value.filter((c) => !gone.has(c.id))
  }

  /** 連動刪除成功後，把 server 狀態也清掉。 */
  function dropServer(ids: string[]): void {
    for (const id of ids) tracker.server.delete(id)
  }

  function reconcile(server: Comment | undefined, id: string): void {
    const i = comments.value.findIndex((c) => c.id === id)
    if (!server) {
      if (i >= 0) comments.value.splice(i, 1)
      return
    }
    if (i >= 0) {
      comments.value[i] = { ...server }
      return
    }
    // review F1：補回來的位置照 server 順序
    comments.value.splice(insertIndexOf([...tracker.server.keys()], comments.value, id), 0, {
      ...server,
    })
  }

  /**
   * 連動刪除失敗時由 task / issue store 呼叫：把這幾筆從 `tracker.server` 放回原位
   * （review F1）。server 已經沒有的（事件先刪掉了）就不復活。
   */
  function restoreFromServer(ids: string[]): void {
    for (const id of ids) reconcile(tracker.server.get(id), id)
  }

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

  /** 把留言裡的附件攤平成檔案列，時間倒序；id 直接用附件自己的。legacy `cFiles` :3379 */
  function filesForTarget(id: string): CommentFile[] {
    const members = useMemberStore()
    const out: CommentFile[] = []
    for (const c of forTarget(id)) {
      const m = members.byId(c.memberId)
      for (const f of c.files) out.push({ ...f, by: m ? m.name : '成員' })
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
   * getFullYear/getMonth/getDate）。這裡直接從 `clock.now` 取本地欄位，不繞 `todayIso`，
   * 免得日索引換算方式改動時又出現「本地時分配 UTC 日期」的組合。
   *
   * 附件走 multipart（契約 A）：Attachment 進 comment、原始 File 走 `files` 參數；
   * response 若把 blob url 換成 server url，舊的 blob url 要 revoke（review M13）——
   * 只有成功才 revoke（review F6），失敗時那些 url 還要給放回去的草稿用。
   *
   * review F6：送不出去時把草稿（文字 + 附件）原樣放回來；使用者已經開始打新的字
   * 就不覆蓋，寧可掉這一份也不要吃掉他正在打的。
   */
  async function send(targetId: string, targetKind: 'task' | 'issue'): Promise<void> {
    if (!draft.value.trim() && !draftFiles.value.length) return
    const now = new Date(useClockStore().now)
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = localDay(now)
    const at = day + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes())
    // 附件 id 綁這則留言（契約 A：`<commentId>:<index>`），送出後就不會再變
    const id = newId()
    const files = draftFiles.value.map((f) => f.file)
    const comment: Comment = {
      id,
      targetId,
      targetKind,
      memberId: useMemberStore().currentUserId,
      at,
      text: draft.value.trim(),
      files: draftFiles.value.map((f, i) => ({
        id: `${id}:${i}`,
        name: f.name,
        size: f.size,
        at: day,
        url: f.url ?? '',
      })),
    }
    comments.value.push(comment)
    // 送出失敗要放回去的草稿；不走 resetDraft，blob url 已經轉給這則留言
    const sentDraft = draft.value
    const sentFiles = draftFiles.value.slice()
    clearDraft()

    let ok = false
    await runOptimistic<Comment>({
      tracker,
      ids: [id],
      label: '送出留言',
      call: async () => {
        const saved = await api.createComment(cloneEntity(comment), files)
        ok = true
        // server 換了 url → 本地那份 blob url 沒人要了，放掉（review M13）
        comment.files.forEach((local, i) => {
          const next = saved.files[i]
          if (!next || next.url === local.url) return
          if (local.url?.startsWith('blob:')) URL.revokeObjectURL(local.url)
        })
        return saved
      },
      reconcile: (server, cid) => {
        reconcile(server, cid)
        if (ok) return
        // review F6：草稿放回去；使用者已經重打的話就不動他（blob 一律不 revoke）
        if (!draft.value && !draftFiles.value.length) {
          draft.value = sentDraft
          draftFiles.value = sentFiles
        }
      },
    })
  }

  /**
   * 把使用者選的 / 貼上的檔案加進草稿；圖片才建 blob url。legacy `addDraftFiles` :2206。
   * review M1：附件日期同樣取本地日（送出時 `send` 會再蓋一次同一天的值）。
   */
  function addDraftFiles(files: FileList | File[]): void {
    const now = useClockStore().now
    // 草稿階段先給暫時 id（v-for 的 key 與移除用），送出時 `send` 會換成 `<commentId>:<index>`
    const picked: CommentDraftFile[] = Array.from(files ?? []).map((f) => ({
      id: newId(),
      name: f.name || '貼上的圖片-' + Date.now() + '.png',
      size: f.size,
      at: localDay(new Date(now)),
      url: (f.type || '').startsWith('image') ? URL.createObjectURL(f) : '',
      file: f,
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
  async function remove(commentId: string): Promise<void> {
    const gone = comments.value.find((c) => c.id === commentId)
    if (!gone) return
    comments.value = comments.value.filter((c) => c.id !== commentId)
    await runOptimistic<Comment>({
      tracker,
      ids: [commentId],
      label: '刪除留言',
      call: async () => {
        await api.deleteComment(commentId)
        tracker.server.delete(commentId)
      },
      // review F1：成功時 server 已無此筆 → no-op；失敗才照 server 順序插回來
      reconcile,
    })
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

  /** 後端推來的留言事件；`_sync.ts` 路由過來。 */
  function applyEvent(e: ProjectEvent): void {
    switch (e.type) {
      case 'comment.created':
        applyServerValue(tracker, e.payload.id, e.payload, reconcile)
        break
      case 'comment.deleted':
        applyServerValue(tracker, e.payload.id, undefined, reconcile)
        break
    }
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
    setAll,
    dropLocal,
    restoreFromServer,
    dropServer,
    forTarget,
    filesForTarget,
    commenterIds,
    send,
    addDraftFiles,
    removeDraft,
    remove,
    resetDraft,
    applyEvent,
  }
})
