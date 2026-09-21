import { ApiError } from '@/api/types'
import { reachable } from '@/lib/schedule'
import type {
  Comment,
  Dependency,
  Group,
  Issue,
  ProjectData,
  Task,
} from '@/types/models'

/**
 * mock api 的記憶體資料庫：只負責「存」與「連動刪」，不負責延遲、失敗與事件。
 *
 * 職責切開的理由：這一層寫的是後端該有的資料規則（外鍵、連動、409 / 404），
 * `index.ts` 那層寫的是傳輸行為（延遲、失敗、事件廣播）。接真後端時前者由 server 實作、
 * 後者由 fetch + SSE 取代，兩邊不會互相污染。
 *
 * 進出一律 `structuredClone`：呼叫端拿到的是自己的拷貝，改了不會回頭污染這裡，
 * 這也是真後端的行為（HTTP response 本來就是另一份資料）。
 */
export interface MockStore {
  snapshot(): ProjectData
  reset(data: ProjectData): void

  createTask(task: Task): Task
  updateTask(id: string, patch: Partial<Task>): Task
  updateTasks(tasks: Task[]): Task[]
  /** 回傳被連動刪掉的東西，呼叫端拿去發事件。 */
  deleteTask(id: string): CascadeResult
  reorderTasks(order: { id: string; groupId: string }[]): Task[]

  createGroup(g: Group): Group
  updateGroup(id: string, patch: Partial<Group>): Group
  deleteGroup(id: string): CascadeResult & { tasks: string[] }
  reorderGroups(ids: string[]): void

  createDep(d: Dependency): Dependency
  deleteDep(id: string): void

  createIssue(i: Issue): Issue
  updateIssue(id: string, patch: Partial<Issue>): Issue
  deleteIssue(id: string): { comments: string[] }

  createComment(c: Comment, files: File[]): Comment
  deleteComment(id: string): void
  attachment(attachmentId: string): Blob
}

/** 連動刪除的結果：被一起刪掉的 id。 */
export interface CascadeResult {
  issues: string[]
  deps: string[]
  comments: string[]
}

const notFound = (what: string, id: string): ApiError =>
  new ApiError('not_found', `${what} ${id} 不存在`, 404)
const conflict = (what: string, id: string): ApiError =>
  new ApiError('conflict', `${what} ${id} 已經存在`, 409)
const invalid = (msg: string): ApiError => new ApiError('validation', msg, 422)

export function createMockStore(initial: ProjectData): MockStore {
  let data: ProjectData = structuredClone(initial)
  /** 真的被上傳過的附件內容；沒有的（mocks 那幾筆）下載時造 demo Blob。 */
  let blobs = new Map<string, Blob>()

  function find<T extends { id: string }>(list: T[], id: string, what: string): T {
    const hit = list.find((x) => x.id === id)
    if (!hit) throw notFound(what, id)
    return hit
  }

  function requireNew(list: { id: string }[], id: string, what: string): void {
    if (list.some((x) => x.id === id)) throw conflict(what, id)
  }

  /** 刪掉一批任務，連它們的 issue / dep / comment 一起。 */
  function cascadeTasks(taskIds: Set<string>): CascadeResult {
    const issues = data.issues.filter((i) => taskIds.has(i.taskId)).map((i) => i.id)
    const deps = data.deps.filter((d) => taskIds.has(d.from) || taskIds.has(d.to)).map((d) => d.id)
    const targets = new Set<string>([...taskIds, ...issues])
    const comments = data.comments.filter((c) => targets.has(c.targetId)).map((c) => c.id)

    const goneIssues = new Set(issues)
    const goneDeps = new Set(deps)
    const goneComments = new Set(comments)
    data.tasks = data.tasks.filter((t) => !taskIds.has(t.id))
    data.issues = data.issues.filter((i) => !goneIssues.has(i.id))
    data.deps = data.deps.filter((d) => !goneDeps.has(d.id))
    data.comments = data.comments.filter((c) => !goneComments.has(c.id))
    return { issues, deps, comments }
  }

  return {
    snapshot: () => structuredClone(data),

    reset(next: ProjectData): void {
      data = structuredClone(next)
      blobs = new Map()
    },

    // ── 任務 ──────────────────────────────────────────────────────────────
    createTask(task: Task): Task {
      requireNew(data.tasks, task.id, '任務')
      if (!data.groups.some((g) => g.id === task.groupId)) throw notFound('分類', task.groupId)
      const copy = structuredClone(task)
      data.tasks.push(copy)
      return structuredClone(copy)
    },

    updateTask(id: string, patch: Partial<Task>): Task {
      const t = find(data.tasks, id, '任務')
      Object.assign(t, structuredClone(patch), { id })
      return structuredClone(t)
    },

    updateTasks(tasks: Task[]): Task[] {
      // 先全部確認存在再寫，避免中途失敗留下半套
      for (const t of tasks) find(data.tasks, t.id, '任務')
      return tasks.map((t) => {
        const cur = find(data.tasks, t.id, '任務')
        Object.assign(cur, structuredClone(t))
        return structuredClone(cur)
      })
    },

    deleteTask(id: string): CascadeResult {
      find(data.tasks, id, '任務')
      return cascadeTasks(new Set([id]))
    },

    reorderTasks(order: { id: string; groupId: string }[]): Task[] {
      const by = new Map(data.tasks.map((t) => [t.id, t]))
      if (order.length !== data.tasks.length) {
        throw invalid('reorderTasks 必須帶整份任務順序')
      }
      const moved: Task[] = []
      const next: Task[] = []
      for (const o of order) {
        const t = by.get(o.id)
        if (!t) throw notFound('任務', o.id)
        if (t.groupId !== o.groupId) {
          if (!data.groups.some((g) => g.id === o.groupId)) throw notFound('分類', o.groupId)
          t.groupId = o.groupId
          moved.push(t)
        }
        next.push(t)
      }
      data.tasks = next
      return moved.map((t) => structuredClone(t))
    },

    // ── 分類 ──────────────────────────────────────────────────────────────
    createGroup(g: Group): Group {
      requireNew(data.groups, g.id, '分類')
      const copy = structuredClone(g)
      data.groups.push(copy)
      return structuredClone(copy)
    },

    updateGroup(id: string, patch: Partial<Group>): Group {
      const g = find(data.groups, id, '分類')
      Object.assign(g, structuredClone(patch), { id })
      return structuredClone(g)
    },

    deleteGroup(id: string): CascadeResult & { tasks: string[] } {
      find(data.groups, id, '分類')
      const tasks = data.tasks.filter((t) => t.groupId === id).map((t) => t.id)
      const cascaded = cascadeTasks(new Set(tasks))
      data.groups = data.groups.filter((g) => g.id !== id)
      return { ...cascaded, tasks }
    },

    reorderGroups(ids: string[]): void {
      if (ids.length !== data.groups.length) throw invalid('reorderGroups 必須帶整份分類順序')
      const by = new Map(data.groups.map((g) => [g.id, g]))
      data.groups = ids.map((id) => {
        const g = by.get(id)
        if (!g) throw notFound('分類', id)
        return g
      })
    },

    // ── 相依 ──────────────────────────────────────────────────────────────
    createDep(d: Dependency): Dependency {
      requireNew(data.deps, d.id, '相依')
      if (!d.from || !d.to || d.from === d.to) throw invalid('相依的兩端不能相同')
      find(data.tasks, d.from, '任務')
      find(data.tasks, d.to, '任務')
      if (data.deps.some((x) => x.from === d.from && x.to === d.to)) {
        throw conflict('相依', `${d.from}→${d.to}`)
      }
      if (reachable(d.to, d.from, data.deps)) throw invalid('這條相依會造成循環')
      const copy = structuredClone(d)
      data.deps.push(copy)
      return structuredClone(copy)
    },

    deleteDep(id: string): void {
      find(data.deps, id, '相依')
      data.deps = data.deps.filter((d) => d.id !== id)
    },

    // ── Issue ─────────────────────────────────────────────────────────────
    createIssue(i: Issue): Issue {
      requireNew(data.issues, i.id, 'Issue')
      find(data.tasks, i.taskId, '任務')
      const copy = structuredClone(i)
      data.issues.push(copy)
      return structuredClone(copy)
    },

    updateIssue(id: string, patch: Partial<Issue>): Issue {
      const i = find(data.issues, id, 'Issue')
      Object.assign(i, structuredClone(patch), { id })
      return structuredClone(i)
    },

    deleteIssue(id: string): { comments: string[] } {
      find(data.issues, id, 'Issue')
      const comments = data.comments.filter((c) => c.targetId === id).map((c) => c.id)
      const gone = new Set(comments)
      data.issues = data.issues.filter((i) => i.id !== id)
      data.comments = data.comments.filter((c) => !gone.has(c.id))
      return { comments }
    },

    // ── 留言與附件 ────────────────────────────────────────────────────────
    createComment(c: Comment, files: File[]): Comment {
      requireNew(data.comments, c.id, '留言')
      const copy = structuredClone(c)
      // 真後端會把 files 存起來並在 response 裡換成 server url；
      // mock 留著 client 的 blob url（換掉的話 demo 的縮圖就沒得看了），
      // 只把內容記進 blobs 供 downloadAttachment 取回。
      copy.files.forEach((f, i) => {
        const file = files[i]
        if (file) blobs.set(f.id, file)
      })
      data.comments.push(copy)
      return structuredClone(copy)
    },

    deleteComment(id: string): void {
      const c = find(data.comments, id, '留言')
      for (const f of c.files) blobs.delete(f.id)
      data.comments = data.comments.filter((x) => x.id !== id)
    },

    attachment(attachmentId: string): Blob {
      const stored = blobs.get(attachmentId)
      if (stored) return stored
      for (const c of data.comments) {
        const f = c.files.find((x) => x.id === attachmentId)
        // mocks 的附件沒有真的內容，造一份說明用的文字 blob（原本寫在 FilesTab 裡）
        if (f) return new Blob([`(demo) ${f.name} — ${f.size} bytes`], { type: 'text/plain' })
      }
      throw notFound('附件', attachmentId)
    },
  }
}
