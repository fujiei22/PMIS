import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api'
import type { ProjectEvent } from '@/api/types'
import { API_ERROR_TEXT, apiErrorCode } from '@/constants/dashboard'
import { newId } from '@/lib/id'
import {
  applyTaskPatch,
  cascade,
  needsCascade,
  projectRange,
  reachable,
  sameTask,
} from '@/lib/schedule'
import {
  applyServerValue,
  cloneEntity,
  createTracker,
  resetTracker,
  runOptimistic,
} from '@/stores/_optimistic'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useUiStore } from '@/stores/ui'
import type { Dependency, DropTarget, Group, ISODate, ProjectData, Task } from '@/types/models'

/**
 * 順序不是單筆實體的屬性，但 in-flight 計數需要一個鍵——
 * 用這兩個合成 id（不會跟真實 id 撞）記「整份順序正在送」。
 */
const TASK_ORDER_KEY = 'tasks:order'
const GROUP_ORDER_KEY = 'groups:order'

/**
 * 分類、任務與相依——Dashboard 的主資料。
 * 它也是 load() 的入口：一次把 ProjectData 分給 member / issue / comment store。
 *
 * 每個寫入 action 都是乐觀的（契約 B）：先改本地、再打 api，
 * 失敗時把牽動到的 id 放回 `tracker.server`（最後已知的 server 狀態）。
 */
export const useTaskStore = defineStore('task', () => {
  const groups = ref<Group[]>([])
  const tasks = ref<Task[]>([])
  const deps = ref<Dependency[]>([])

  /** 最後已知的 server 狀態；Map 的順序就是 server 的顯示順序（契約 B）。 */
  const taskTracker = createTracker<Task>()
  const groupTracker = createTracker<Group>()
  const depTracker = createTracker<Dependency>()

  /** id → 物件的索引；legacy 每次 render 重建一次 Map（:1901），這裡交給 computed 快取。 */
  const taskIndex = computed(() => new Map(tasks.value.map((t) => [t.id, t])))
  const groupIndex = computed(() => new Map(groups.value.map((g) => [g.id, g])))

  function taskById(id: string): Task | undefined {
    return taskIndex.value.get(id)
  }

  function groupById(id: string): Group | undefined {
    return groupIndex.value.get(id)
  }

  // ── 載入（spec 目標 5）────────────────────────────────────────────────────

  /**
   * 載入整包專案資料並分給各 store。
   *
   * 不帶參數 = 走 `api.loadProject()` 並更新 `ui.loadState`；
   * 帶 `data` = 直接採用（`project.reloaded` 事件走這條）。
   * **不跑 cascade**：後端資料為準（spec 目標 5、已定案決策）。
   */
  async function load(data?: ProjectData): Promise<void> {
    const ui = useUiStore()
    if (data) {
      applyProject(data)
      ui.loadState = 'ready'
      ui.loadError = null
      return
    }
    ui.loadState = 'loading'
    ui.loadError = null
    try {
      applyProject(await api.loadProject())
      ui.loadState = 'ready'
    } catch (error) {
      console.error('[api]', '載入專案', error)
      ui.loadError = API_ERROR_TEXT[apiErrorCode(error)]
      ui.loadState = 'error'
    }
  }

  /** 把一份 ProjectData 灌進各個 store，並重置三個 tracker。 */
  function applyProject(data: ProjectData): void {
    useMemberStore().setAll(data.members, data.currentUserId)
    useIssueStore().setAll(data.issues)
    useCommentStore().setAll(data.comments)
    groups.value = data.groups
    tasks.value = data.tasks
    deps.value = data.deps
    resetTracker(taskTracker, data.tasks)
    resetTracker(groupTracker, data.groups)
    resetTracker(depTracker, data.deps)
  }

  // ── 對齊 server（失敗還原 / 事件）────────────────────────────────────────

  /** server 順序中，這個 id 應該插回本地陣列的哪個位置。 */
  function insertIndexOf(order: string[], list: { id: string }[], id: string): number {
    const at = order.indexOf(id)
    for (let k = at - 1; k >= 0; k--) {
      const j = list.findIndex((x) => x.id === order[k])
      if (j >= 0) return j + 1
    }
    return 0
  }

  function reconcileTask(server: Task | undefined, id: string): void {
    const i = tasks.value.findIndex((t) => t.id === id)
    if (!server) {
      if (i >= 0) tasks.value.splice(i, 1)
      return
    }
    // 同值事件 / 回音是 no-op，不重建物件（契約 A：client 對同 id 同值事件 no-op）
    if (i >= 0) {
      if (!sameTask(tasks.value[i]!, server)) tasks.value[i] = { ...server }
      return
    }
    tasks.value.splice(insertIndexOf([...taskTracker.server.keys()], tasks.value, id), 0, {
      ...server,
    })
  }

  function reconcileGroup(server: Group | undefined, id: string): void {
    const i = groups.value.findIndex((g) => g.id === id)
    if (!server) {
      if (i >= 0) groups.value.splice(i, 1)
      return
    }
    if (i >= 0) {
      if (groups.value[i]!.name !== server.name) groups.value[i] = { ...server }
      return
    }
    groups.value.splice(insertIndexOf([...groupTracker.server.keys()], groups.value, id), 0, {
      ...server,
    })
  }

  function reconcileDep(server: Dependency | undefined, id: string): void {
    const i = deps.value.findIndex((d) => d.id === id)
    if (!server) {
      if (i >= 0) deps.value.splice(i, 1)
      return
    }
    if (i < 0) deps.value.push({ ...server })
  }

  /** 整份任務放回 server 狀態（含順序）；拖曳取消 / 重排失敗走這條。 */
  function reconcileTasksFromServer(): void {
    tasks.value = [...taskTracker.server.values()].map((t) => ({ ...t }))
  }

  function reconcileGroupsFromServer(): void {
    groups.value = [...groupTracker.server.values()].map((g) => ({ ...g }))
  }

  /** 本地跟最後已知 server 狀態有差的任務（拖曳放開時要送的就是這些）。 */
  function collectDirtyTasks(): Task[] {
    return tasks.value.filter((t) => {
      const server = taskTracker.server.get(t.id)
      return !server || !sameTask(t, server)
    })
  }

  // ── 派生 ─────────────────────────────────────────────────────────────────

  /** 甘特圖的時間範圍。legacy `range()` :1995 */
  const range = computed(() => projectRange(tasks.value, useClockStore().todayIdx))

  // ── 分類 ─────────────────────────────────────────────────────────────────

  /** 新增分類，接在最後。legacy `addGroup` :1849 */
  function addGroup(): Group {
    const g: Group = { id: newId(), name: '新分類 ' + (groups.value.length + 1) }
    groups.value.push(g)
    void runOptimistic<Group>({
      tracker: groupTracker,
      ids: [g.id],
      label: '新增分類',
      apply: () => {},
      call: () => api.createGroup(cloneEntity(g)),
      reconcile: reconcileGroup,
    })
    return g
  }

  /** 只改本地的分類名（逐鍵編輯的每一鍵走這條）。legacy `onEdit` :2799 */
  function renameGroupLocal(id: string, name: string): void {
    const g = groupById(id)
    if (g) g.name = name
  }

  /**
   * 只把分類的變更送出去（本地已經改好了）；逐鍵編輯 debounce 到期時走這條。
   * 它不看本地有沒有變——`useEditDraft` 已經逐鍵 apply 過了。
   */
  async function commitGroupPatch(id: string, patch: Partial<Group>): Promise<void> {
    await runOptimistic<Group>({
      tracker: groupTracker,
      ids: [id],
      label: '更新分類',
      apply: () => {},
      call: () => api.updateGroup(id, cloneEntity(patch)),
      reconcile: reconcileGroup,
    })
  }

  async function renameGroup(id: string, name: string): Promise<void> {
    const g = groupById(id)
    if (!g || g.name === name) return
    renameGroupLocal(id, name)
    await commitGroupPatch(id, { name })
  }

  /**
   * 刪分類，連底下的任務、那些任務的 Issue / 相依 / 留言一起刪。legacy `grpDelete` :4013。
   * 刪完把指到已刪 id 的選取清掉，免得畫面停在不存在的東西上（R3 才搬去派生層）。
   */
  async function removeGroup(id: string): Promise<void> {
    const issues = useIssueStore()
    const comments = useCommentStore()
    if (!groupById(id)) return
    // 失敗要還原的不只分類本身（review C1）：連動刪掉的四份陣列都留一份快照
    const snapshot = {
      groups: groups.value,
      tasks: tasks.value,
      deps: deps.value,
      issues: issues.issues,
      comments: comments.comments,
    }
    const goneTasks = new Set(tasks.value.filter((t) => t.groupId === id).map((t) => t.id))
    const goneIssues = issues.issues.filter((i) => goneTasks.has(i.taskId)).map((i) => i.id)
    const targets = new Set<string>([...goneTasks, ...goneIssues])
    const goneComments = comments.comments.filter((c) => targets.has(c.targetId)).map((c) => c.id)
    const goneDeps = deps.value
      .filter((d) => goneTasks.has(d.from) || goneTasks.has(d.to))
      .map((d) => d.id)

    groups.value = groups.value.filter((g) => g.id !== id)
    tasks.value = tasks.value.filter((t) => !goneTasks.has(t.id))
    deps.value = deps.value.filter((d) => !goneTasks.has(d.from) && !goneTasks.has(d.to))
    issues.dropLocal(goneIssues)
    comments.dropLocal(goneComments)

    const sel = useSelectionStore()
    if (sel.taskId && goneTasks.has(sel.taskId)) sel.taskId = null
    if (sel.groupId === id) sel.groupId = null
    if (sel.issueId && !issues.byId(sel.issueId)) sel.issueId = null
    const ui = useUiStore()
    if (ui.detail && (goneTasks.has(ui.detail.id) || ui.detail.id === id)) ui.closeDetail()

    let ok = false
    await runOptimistic<Group>({
      tracker: groupTracker,
      ids: [id],
      label: '刪除分類',
      apply: () => {},
      call: async () => {
        await api.deleteGroup(id)
        ok = true
        groupTracker.server.delete(id)
        dropServerCascade(goneTasks, goneDeps, goneIssues, goneComments)
      },
      reconcile: () => {
        if (ok) return
        groups.value = snapshot.groups
        tasks.value = snapshot.tasks
        deps.value = snapshot.deps
        issues.restoreLocal(snapshot.issues)
        comments.restoreLocal(snapshot.comments)
      },
    })
  }

  /** 收合 / 展開一個分類；狀態在 ui（review C5）。legacy `onCaret` :2800 */
  function toggleGroup(id: string): void {
    useUiStore().toggleGroup(id)
  }

  /** 全部收合 / 全部展開。legacy `toggleAllGroups` :4110 */
  function setAllCollapsed(v: boolean): void {
    useUiStore().setAllCollapsed(v)
  }

  /** 分類與相鄰的那個對調（只改本地）；已在頭尾就不動，回傳有沒有真的動。legacy `moveGroup` :1835 */
  function moveGroupLocal(id: string, dir: -1 | 1): boolean {
    const i = groups.value.findIndex((g) => g.id === id)
    const j = i + dir
    const a = groups.value[i]
    const b = groups.value[j]
    if (i < 0 || !a || !b) return false
    groups.value[i] = b
    groups.value[j] = a
    return true
  }

  /** 對調並送出；拖曳中的每一次對調請改用 `moveGroupLocal` + `commitGroupOrder`。 */
  async function moveGroup(id: string, dir: -1 | 1): Promise<void> {
    if (!moveGroupLocal(id, dir)) return
    await commitGroupOrder()
  }

  /** 把目前的分類順序送給後端（拖曳放開時送這一次）。 */
  async function commitGroupOrder(): Promise<void> {
    const ids = groups.value.map((g) => g.id)
    const server = [...groupTracker.server.keys()]
    if (ids.length === server.length && ids.every((id, i) => server[i] === id)) return
    let ok = false
    await runOptimistic<Group>({
      tracker: groupTracker,
      ids: [GROUP_ORDER_KEY],
      label: '調整分類順序',
      apply: () => {},
      call: async () => {
        await api.reorderGroups(ids)
        ok = true
        const prev = groupTracker.server
        const next = new Map<string, Group>()
        for (const id of ids) {
          const server = prev.get(id)
          if (server) next.set(id, server)
        }
        groupTracker.server = next
      },
      reconcile: () => {
        if (!ok) reconcileGroupsFromServer()
      },
    })
  }

  // ── 任務 ─────────────────────────────────────────────────────────────────

  /**
   * 新增任務。legacy `addTask` :4128。
   *
   * 預設值（分類、負責人、起訖）由呼叫端算好傳進來——那些要讀 selection /
   * filter，是派生層的事（契約 E），資料層只負責建立與送出。
   * 建立後的選取同樣在 `useTaskActions()`。分類不存在時回 null。
   */
  function addTask(opts: {
    groupId: string
    assigneeIds: string[]
    start: ISODate
    end: ISODate
  }): Task | null {
    if (!groupById(opts.groupId)) return null
    const t: Task = {
      id: newId(),
      groupId: opts.groupId,
      name: '新任務',
      created: useClockStore().todayIso,
      start: opts.start,
      end: opts.end,
      status: 'todo',
      done: '',
      priority: 'mid',
      assigneeIds: opts.assigneeIds.slice(),
    }
    tasks.value.push(t)
    void runOptimistic<Task>({
      tracker: taskTracker,
      ids: [t.id],
      label: '新增任務',
      apply: () => {},
      call: () => api.createTask(cloneEntity(t)),
      reconcile: reconcileTask,
    })
    return t
  }

  /**
   * 只改本地的任務欄位（必要時連動下游），回傳真的變動的那幾筆。
   * 拖曳的每個 tick 走這條——不打 api，放開時再用 `collectDirtyTasks` + `commitTasks` 送一次。
   */
  function applyLocalPatch(id: string, patch: Partial<Task>): Task[] {
    const { tasks: next, changed } = applyTaskPatch(
      tasks.value,
      deps.value,
      id,
      patch,
      useClockStore().todayIso,
    )
    tasks.value = next
    return changed
  }

  /** 改任務欄位並連動下游，然後送給後端。legacy `setTask` :2294 */
  async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
    const changed = applyLocalPatch(id, patch)
    if (!changed.length) return
    // 沒有 cascade 的單筆變更送 patch（JSON merge patch）；
    // 有連動就送整批最終狀態，後端不重算（契約 A）。
    const single = !needsCascade(patch) && changed.length === 1
    const payload = changed.map((t) => cloneEntity(t))
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: payload.map((t) => t.id),
      label: '更新任務',
      apply: () => {},
      call: () => (single ? api.updateTask(id, cloneEntity(patch)) : api.updateTasks(payload)),
      reconcile: reconcileTask,
    })
  }

  /**
   * 只把一筆任務的變更送出去（本地已經改好了）；逐鍵編輯 debounce 到期時走這條。
   * 只給不牽動排程的欄位用（名稱 / 優先度…）——會 cascade 的欄位請走 `updateTask`。
   */
  async function commitTaskPatch(id: string, patch: Partial<Task>): Promise<void> {
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: [id],
      label: '更新任務',
      apply: () => {},
      call: () => api.updateTask(id, cloneEntity(patch)),
      reconcile: reconcileTask,
    })
  }

  /** 把一批已經改好的任務送出去（拖曳放開時用）。 */
  async function commitTasks(changed: Task[]): Promise<void> {
    if (!changed.length) return
    const payload = changed.map((t) => cloneEntity(t))
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: payload.map((t) => t.id),
      label: '更新任務',
      apply: () => {},
      call: () => api.updateTasks(payload),
      reconcile: reconcileTask,
    })
  }

  /** 把目前的任務順序（含 groupId）送給後端（拖曳放開時送這一次）。 */
  async function commitTaskOrder(): Promise<void> {
    const order = tasks.value.map((t) => ({ id: t.id, groupId: t.groupId }))
    // 拖回原位（或根本沒動）就不用送
    const server = [...taskTracker.server.entries()]
    const same =
      order.length === server.length &&
      order.every((o, i) => server[i]![0] === o.id && server[i]![1].groupId === o.groupId)
    if (same) return
    let ok = false
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: [TASK_ORDER_KEY],
      label: '調整任務順序',
      apply: () => {},
      call: async () => {
        await api.reorderTasks(order)
        ok = true
        const prev = taskTracker.server
        const next = new Map<string, Task>()
        for (const o of order) {
          const server = prev.get(o.id)
          if (server) next.set(o.id, { ...server, groupId: o.groupId })
        }
        taskTracker.server = next
      },
      reconcile: () => {
        if (!ok) reconcileTasksFromServer()
      },
    })
  }

  /**
   * 只改完成日、不跑 cascade。legacy 的 iCal task 模式 `iCalSet` :3486。
   * 這條路徑是日期選擇器直接寫完成日，不該牽動任何排程。
   */
  async function setTaskDoneDirect(id: string, done: ISODate | ''): Promise<void> {
    const t = taskById(id)
    if (!t || t.done === done) return
    t.done = done
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: [id],
      label: '更新任務',
      apply: () => {},
      call: () => api.updateTask(id, { done }),
      reconcile: reconcileTask,
    })
  }

  /**
   * 刪任務，連它的 Issue、相依與留言一起刪。legacy `confirmDelete` :4092。
   * 也清掉 ui.detail（§不重現的原頁面 bug 1：legacy 刪完視窗會卡住不關 :1761）。
   */
  async function removeTask(id: string): Promise<void> {
    const issues = useIssueStore()
    const comments = useCommentStore()
    if (!taskById(id)) return
    const snapshot = {
      tasks: tasks.value,
      deps: deps.value,
      issues: issues.issues,
      comments: comments.comments,
    }
    const goneIssues = issues.issues.filter((i) => i.taskId === id).map((i) => i.id)
    const targets = new Set<string>([id, ...goneIssues])
    const goneComments = comments.comments.filter((c) => targets.has(c.targetId)).map((c) => c.id)
    const goneDeps = deps.value.filter((d) => d.from === id || d.to === id).map((d) => d.id)

    tasks.value = tasks.value.filter((t) => t.id !== id)
    deps.value = deps.value.filter((d) => d.from !== id && d.to !== id)
    issues.dropLocal(goneIssues)
    comments.dropLocal(goneComments)

    const sel = useSelectionStore()
    if (sel.taskId === id) sel.taskId = null
    if (sel.issueId && !issues.byId(sel.issueId)) sel.issueId = null
    const ui = useUiStore()
    if (ui.detail && (ui.detail.id === id || ui.detail.from === id)) ui.closeDetail()
    if (ui.depEditFor === id) ui.depEditFor = null
    if (ui.pickerFor === id) ui.pickerFor = null

    let ok = false
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: [id],
      label: '刪除任務',
      apply: () => {},
      call: async () => {
        await api.deleteTask(id)
        ok = true
        dropServerCascade(new Set([id]), goneDeps, goneIssues, goneComments)
      },
      reconcile: () => {
        if (ok) return
        tasks.value = snapshot.tasks
        deps.value = snapshot.deps
        issues.restoreLocal(snapshot.issues)
        comments.restoreLocal(snapshot.comments)
      },
    })
  }

  /** 連動刪除成功後，把被一起刪掉的 id 從各 tracker 的 server 拿掉。 */
  function dropServerCascade(
    taskIds: Set<string>,
    depIds: string[],
    issueIds: string[],
    commentIds: string[],
  ): void {
    for (const id of taskIds) taskTracker.server.delete(id)
    for (const id of depIds) depTracker.server.delete(id)
    useIssueStore().dropServer(issueIds)
    useCommentStore().dropServer(commentIds)
  }

  /**
   * 把任務搬到分類或某個任務旁邊（只改本地），回傳有沒有真的動。legacy `moveTaskTo` :1797。
   * 落在分類上：dir='up' 接在該分類最後、否則插在最前；分類是空的就接在整串最後。
   * 落在任務上：從上往下拖就插在目標後面，從下往上拖就插在前面。
   */
  function moveTaskToLocal(id: string, target: DropTarget): boolean {
    if (!target || target.id === id) return false
    const list = tasks.value.slice()
    const i = list.findIndex((t) => t.id === id)
    if (i < 0) return false
    const removed = list.splice(i, 1)[0]
    if (!removed) return false
    const moving = { ...removed }

    if (target.kind === 'g') {
      moving.groupId = target.id
      const idxs: number[] = []
      list.forEach((t, k) => {
        if (t.groupId === target.id) idxs.push(k)
      })
      if (!idxs.length) list.push(moving)
      else if (target.dir === 'up') list.splice(idxs[idxs.length - 1]! + 1, 0, moving)
      else list.splice(idxs[0]!, 0, moving)
    } else {
      const j = list.findIndex((t) => t.id === target.id)
      const at = list[j]
      if (j < 0 || !at) {
        list.splice(i, 0, moving)
        tasks.value = list
        return false
      }
      moving.groupId = at.groupId
      list.splice(j >= i ? j + 1 : j, 0, moving)
    }
    tasks.value = list
    return true
  }

  /** 搬動並送出；拖曳中的每一次搬動請改用 `moveTaskToLocal` + `commitTaskOrder`。 */
  async function moveTaskTo(id: string, target: DropTarget): Promise<void> {
    if (!moveTaskToLocal(id, target)) return
    await commitTaskOrder()
  }

  /** 指派成員：跟現有的取聯集，不重複。legacy `assign` :2422 */
  async function assign(taskId: string, memberIds: string[]): Promise<void> {
    if (!memberIds.length) return
    const t = taskById(taskId)
    if (!t) return
    const who = t.assigneeIds.slice()
    for (const id of memberIds) if (!who.includes(id)) who.push(id)
    await updateTask(taskId, { assigneeIds: who })
  }

  // ── 相依 ─────────────────────────────────────────────────────────────────

  /**
   * 建立相依，回傳有沒有成功。legacy `addDep` :2360。
   * 已經有同一條、或反向已經走得到（會成環）就拒絕；成功後跑一次 cascade 對齊日期，
   * 被推動的任務跟著送一批 `updateTasks`（後端不跑 cascade，契約 A）。
   */
  function addDep(from: string, to: string): boolean {
    if (!from || !to || from === to) return false
    if (deps.value.some((d) => d.from === from && d.to === to)) return false
    if (reachable(to, from, deps.value)) return false
    const dep: Dependency = { id: newId(), from, to }
    deps.value = deps.value.concat([dep])

    const before = tasks.value
    const after = cascade(before, deps.value, {})
    // cascade 一律回全新物件；沒變的換回原物件，保住 identity（spec 目標 7）
    const changed: Task[] = []
    tasks.value = after.map((t, i) => {
      const orig = before[i]!
      if (sameTask(t, orig)) return orig
      changed.push(t)
      return t
    })

    void runOptimistic<Dependency>({
      tracker: depTracker,
      ids: [dep.id],
      label: '建立相依',
      apply: () => {},
      call: () => api.createDep(cloneEntity(dep)),
      reconcile: reconcileDep,
    })
    void commitTasks(changed)
    return true
  }

  async function removeDep(id: string): Promise<void> {
    if (!deps.value.some((d) => d.id === id)) return
    const snapshot = deps.value
    deps.value = deps.value.filter((d) => d.id !== id)
    let ok = false
    await runOptimistic<Dependency>({
      tracker: depTracker,
      ids: [id],
      label: '刪除相依',
      apply: () => {},
      call: async () => {
        await api.deleteDep(id)
        ok = true
        depTracker.server.delete(id)
      },
      reconcile: () => {
        if (!ok) deps.value = snapshot
      },
    })
  }

  /** 前置任務（必須先完成的）。 */
  function predecessors(taskId: string): Task[] {
    return deps.value
      .filter((d) => d.to === taskId)
      .map((d) => taskById(d.from))
      .filter((t): t is Task => !!t)
  }

  /** 後續任務（等它完成才能開始的）。 */
  function successors(taskId: string): Task[] {
    return deps.value
      .filter((d) => d.from === taskId)
      .map((d) => taskById(d.to))
      .filter((t): t is Task => !!t)
  }

  // ── 事件（契約 B）────────────────────────────────────────────────────────

  /** 後端推來的任務 / 分類 / 相依事件；`_sync.ts` 依 type 前綴路由過來。 */
  function applyEvent(e: ProjectEvent): void {
    switch (e.type) {
      case 'task.created':
      case 'task.updated':
        applyServerValue(taskTracker, e.payload.id, e.payload, reconcileTask)
        break
      case 'task.deleted':
        applyServerValue(taskTracker, e.payload.id, undefined, reconcileTask)
        break
      case 'group.created':
      case 'group.updated':
        applyServerValue(groupTracker, e.payload.id, e.payload, reconcileGroup)
        break
      case 'group.deleted':
        applyServerValue(groupTracker, e.payload.id, undefined, reconcileGroup)
        break
      case 'dep.created':
        applyServerValue(depTracker, e.payload.id, e.payload, reconcileDep)
        break
      case 'dep.deleted':
        applyServerValue(depTracker, e.payload.id, undefined, reconcileDep)
        break
    }
  }

  return {
    groups,
    tasks,
    deps,
    taskById,
    groupById,
    load,
    applyEvent,
    range,
    addGroup,
    renameGroup,
    renameGroupLocal,
    commitGroupPatch,
    removeGroup,
    toggleGroup,
    setAllCollapsed,
    moveGroup,
    moveGroupLocal,
    commitGroupOrder,
    reconcileGroupsFromServer,
    addTask,
    updateTask,
    commitTaskPatch,
    applyLocalPatch,
    collectDirtyTasks,
    commitTasks,
    commitTaskOrder,
    reconcileTasksFromServer,
    setTaskDoneDirect,
    removeTask,
    moveTaskTo,
    moveTaskToLocal,
    assign,
    addDep,
    removeDep,
    predecessors,
    successors,
  }
})
