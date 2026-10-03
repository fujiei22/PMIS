import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api'
import type { ProjectEvent } from '@/api/types'
import { newId } from '@/lib/id'
import {
  applyTaskEdit,
  explainSchedule,
  predecessorIds,
  projectRange,
  reachable,
  sameTask,
  SCHEDULE_FIELDS,
  scheduleWithPlan,
} from '@/lib/schedule'
import {
  applyServerValue,
  clearDirty,
  clearTracker,
  cloneEntity,
  createTracker,
  insertIndexOf,
  isInflight,
  markDirty,
  resetTracker,
  runOptimistic,
} from '@/stores/_optimistic'
import { useBudgetStore } from '@/stores/budget'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useProjectStore } from '@/stores/project'
import { useWorkCalendarStore } from '@/stores/workCalendar'
import type { Dependency, DropTarget, Group, ISODate, ProjectData, Task } from '@/types/models'

/**
 * 順序不是單筆實體的屬性，但 in-flight 計數需要一個鍵——
 * 用這兩個合成 id（不會跟真實 id 撞）記「整份順序正在送」。
 */
const TASK_ORDER_KEY = 'tasks:order'
const GROUP_ORDER_KEY = 'groups:order'

/**
 * 分類、任務與相依——Dashboard 的主資料。
 * 它也是 load() 的入口：一次把 ProjectData 分給 member / issue / comment / budget / project store；
 * 換專案時的 reset() 同樣由它一次清掉這幾個。
 *
 * **存與算的分工**（規則見 docs/reference/scheduling.md）：
 * - `inputs` 是存的值——使用者設定的工期、根任務的開始日（計畫開始日存在 `baselineStart`）、狀態與實際日期，
 *   以及最後一次寫回的起訖與計畫。
 * - `tasks` 是畫面看的值——用今天與工作日曆把 `inputs` 排一次，再填上計畫起訖（`scheduleWithPlan`）。
 *   跨日、日曆晚到都會自動重排，但**不寫回**；下一次編輯時連同漂移的那幾筆一起送。
 * - 寫回送的是推算結果與計畫（`commitSchedule`），後端不重算（契約 A）。
 *
 * 每個寫入 action 都是樂觀的（契約 B）：先改本地、再打 api，
 * 失敗時把牽動到的 id 放回 `tracker.server`（最後已知的 server 狀態）。
 *
 * 唯讀（F2）：每個寫入 action（含只改本地、之後才送出的 `*Local` / `applyLocalPatch`）第一行
 * `if (!useProjectStore().canEdit) return`，唯讀時不改本地、不打 api。這是畫面藏掉入口之外的安全網；
 * 新增 action 要在 `stores/__tests__/readonly.spec.ts` 分類，沒分類會紅。
 */
export const useTaskStore = defineStore('task', () => {
  const groups = ref<Group[]>([])
  /** 存的任務（見檔頭〈存與算的分工〉）；畫面請讀 `tasks`。 */
  const inputs = ref<Task[]>([])
  const deps = ref<Dependency[]>([])

  /** 最後已知的 server 狀態；Map 的順序就是 server 的顯示順序（契約 B）。 */
  const taskTracker = createTracker<Task>()
  const groupTracker = createTracker<Group>()
  const depTracker = createTracker<Dependency>()

  /**
   * 有前置的任務 id（未開始時開始日由前置決定，`applyTaskEdit` 會丟掉它的 start）。
   * 編輯限制（`startBlock`／`moveBlock`）的呼叫端都讀這一份，不各自重建。
   */
  const hasPred = computed(() => predecessorIds(deps.value))

  /**
   * 推算結果的 identity 快取：id → 上一次的輸入物件與輸出物件。
   * 跨日漂移時 `scheduleWithPlan` 每次都回新物件；輸入是同一個、起訖與基準也相同時沿用上一次的輸出，
   * 改一筆任務不會讓其他漂移中的任務整列重繪（spec 目標 7）。
   */
  let scheduleCache = new Map<string, { src: Task; out: Task }>()

  /** 畫面看的任務：用今天排過、填上計畫起訖（見檔頭）。順序同 `inputs`。 */
  const tasks = computed<Task[]>(() => {
    const src = inputs.value
    const scheduled = scheduleWithPlan(
      src,
      deps.value,
      useWorkCalendarStore().workdays,
      useClockStore().todayIdx,
    )
    const next = new Map<string, { src: Task; out: Task }>()
    const out = scheduled.map((t, i) => {
      const input = src[i]!
      const hit = scheduleCache.get(t.id)
      const kept = t !== input && hit && hit.src === input && sameDates(hit.out, t) ? hit.out : t
      next.set(t.id, { src: input, out: kept })
      return kept
    })
    scheduleCache = next
    return out
  })

  /** 起訖與基準都一樣（identity 快取用；其他欄位來自同一個輸入物件，不必再比）。 */
  function sameDates(a: Task, b: Task): boolean {
    return (
      a.start === b.start &&
      a.end === b.end &&
      a.baselineStart === b.baselineStart &&
      a.baselineEnd === b.baselineEnd
    )
  }

  /** id → 物件的索引；legacy 每次 render 重建一次 Map（:1901），這裡交給 computed 快取。 */
  const taskIndex = computed(() => new Map(tasks.value.map((t) => [t.id, t])))
  /** id → 存的值（`explain` 要看原始輸入；每條甘特條都會查，不用線性搜尋）。 */
  const inputIndex = computed(() => new Map(inputs.value.map((t) => [t.id, t])))
  const groupIndex = computed(() => new Map(groups.value.map((g) => [g.id, g])))

  /** 推算後的任務（畫面看的值）。 */
  function taskById(id: string): Task | undefined {
    return taskIndex.value.get(id)
  }

  function groupById(id: string): Group | undefined {
    return groupIndex.value.get(id)
  }

  // ── 載入（spec 目標 5）────────────────────────────────────────────────────

  /**
   * 請求序號（照 portfolio store）：重進 Dashboard 改成背景重載、切頁時先載之後，
   * 快速進出會有好幾發同時在飛、回來的順序也不一定。回應比畫面上現有資料的那一發還舊才丟掉；
   * 較早的一發先回來照樣套用（後發的那一發之後失敗時，畫面上仍有這份資料）。
   * 推來的整包（`project.reloaded`）也算一發，晚回來的舊 load 不蓋掉它。
   */
  let loadSeq = 0
  /** 畫面上的資料來自第幾發；0 表示還沒套用過。 */
  let appliedSeq = 0
  /**
   * 最後一次要載的是哪個專案。回應回來時已經改載別的專案，就整個丟掉：
   * 同一個專案的較早一發照樣套用（見上），換了專案的舊回應不能把上一個專案灌進來。
   */
  let requestedId: string | null = null

  /**
   * 載入整包專案資料並分給各 store。
   *
   * 給專案 id = 走 `api.loadProject(id)`；給 `ProjectData` = 直接採用
   * （`project.reloaded` 事件走這條）。存的值原樣放進 `inputs`；畫面上的 `tasks` 用今天重排，
   * 但載入本身**不寫回**（spec 目標 5：後端資料為準，漂移等下一次編輯才一起送）。
   *
   * 失敗就 **reject**：`loadState` / `loadError` 是畫面狀態，由啟動層
   * `useProjectBoot(id).reload()` 接（契約 E）。
   */
  async function load(source: string | ProjectData): Promise<void> {
    const ticket = ++loadSeq
    if (typeof source !== 'string') {
      appliedSeq = ticket
      applyProject(source)
      return
    }
    requestedId = source
    const next = await api.loadProject(source)
    if (ticket < appliedSeq || source !== requestedId) return
    appliedSeq = ticket
    applyProject(next)
  }

  /** 把一份 ProjectData 灌進各個 store，並重置三個 tracker。 */
  function applyProject(data: ProjectData): void {
    useProjectStore().setAll(data.project, data.canEdit)
    useMemberStore().setAll(data.members, data.currentUserId)
    useIssueStore().setAll(data.issues)
    useCommentStore().setAll(data.comments)
    useBudgetStore().setAll(data.budget)
    groups.value = data.groups
    inputs.value = data.tasks
    deps.value = data.deps
    resetTracker(taskTracker, data.tasks)
    resetTracker(groupTracker, data.groups)
    resetTracker(depTracker, data.deps)
  }

  /**
   * 換專案時清空整個資料層（applyProject 的反向）：分類 / 任務 / 相依，以及 member / issue / comment /
   * budget / project store。還在飛的 load 一律作廢；上一個專案還在飛的寫入回來時也不再碰本地（`clearTracker`）。
   * 派生層（selection / filter / ui）不在這裡清，由啟動層 `useProjectBoot` 處理（資料層不認識派生層，契約 E）。
   */
  function reset(): void {
    appliedSeq = ++loadSeq
    requestedId = null
    groups.value = []
    inputs.value = []
    // 上一個專案（上一位使用者）的推算結果不留著
    scheduleCache = new Map()
    deps.value = []
    clearTracker(taskTracker)
    clearTracker(groupTracker)
    clearTracker(depTracker)
    useProjectStore().reset()
    useMemberStore().reset()
    useIssueStore().reset()
    useCommentStore().reset()
    useBudgetStore().reset()
  }

  // ── 對齊 server（失敗還原 / 事件）────────────────────────────────────────

  /** 把一筆存的任務對齊 server（undefined＝已刪除）；推算結果跟著重算。 */
  function reconcileTask(server: Task | undefined, id: string): void {
    const i = inputs.value.findIndex((t) => t.id === id)
    if (!server) {
      if (i >= 0) inputs.value.splice(i, 1)
      return
    }
    // 同值事件 / 回音是 no-op，不重建物件（契約 A：client 對同 id 同值事件 no-op）
    if (i >= 0) {
      if (!sameTask(inputs.value[i]!, server)) inputs.value[i] = { ...server }
      return
    }
    inputs.value.splice(insertIndexOf([...taskTracker.server.keys()], inputs.value, id), 0, {
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
    // review F1：補回來的位置照 server 順序，刪除失敗的還原才不會把相依洗到最後面
    if (i < 0) {
      deps.value.splice(insertIndexOf([...depTracker.server.keys()], deps.value, id), 0, {
        ...server,
      })
    }
  }

  /**
   * 刪除失敗時，把被連帶刪掉的那幾筆從各 tracker 的 `server` 放回來（review F1）。
   *
   * 不用「送出前的整份快照」：那會連刪除在飛期間別的 client 推來的變更一起蓋掉，
   * 也會讓「事件已經先把它刪掉」的實體復活（`server` 裡早就沒有它了）。
   */
  function restoreCascadeFromServer(
    taskIds: Iterable<string>,
    depIds: string[],
    issueIds: string[],
    commentIds: string[],
  ): void {
    for (const id of taskIds) reconcileTask(taskTracker.server.get(id), id)
    for (const id of depIds) reconcileDep(depTracker.server.get(id), id)
    useIssueStore().restoreFromServer(issueIds)
    useCommentStore().restoreFromServer(commentIds)
  }

  /**
   * 整份任務放回 server 狀態（含順序）；拖曳取消 / 重排失敗走這條。
   * review F2：dirty 的那幾筆（別處還在改、還沒送出）保留本地物件，只有順序照 server。
   */
  function reconcileTasksFromServer(): void {
    const local = new Map(inputs.value.map((t) => [t.id, t]))
    const next: Task[] = []
    for (const [id, server] of taskTracker.server) {
      const mine = local.get(id)
      next.push(mine && taskTracker.dirty.has(id) ? mine : { ...server })
    }
    // server 還不知道、但本地改到一半的（例如 create 在飛時又被改名）留著
    for (const t of inputs.value)
      if (!taskTracker.server.has(t.id) && taskTracker.dirty.has(t.id)) next.push(t)
    inputs.value = next
  }

  function reconcileGroupsFromServer(): void {
    const local = new Map(groups.value.map((g) => [g.id, g]))
    const next: Group[] = []
    for (const [id, server] of groupTracker.server) {
      const mine = local.get(id)
      next.push(mine && groupTracker.dirty.has(id) ? mine : { ...server })
    }
    for (const g of groups.value)
      if (!groupTracker.server.has(g.id) && groupTracker.dirty.has(g.id)) next.push(g)
    groups.value = next
  }

  /**
   * 放棄這一段拖曳的本地變更（`usePointerDrag.onCancel`）。
   *
   * review F2：只清掉**這次拖曳自己標的** dirty，再整份對齊回 server——
   * 別的欄位還在 debounce 的改名不屬於這次拖曳，不能一起被抹掉。
   */
  function discardTaskDrag(ids: Iterable<string>): void {
    clearDirty(taskTracker, ids)
    taskTracker.dirty.delete(TASK_ORDER_KEY)
    reconcileTasksFromServer()
  }

  function discardGroupDrag(): void {
    groupTracker.dirty.delete(GROUP_ORDER_KEY)
    reconcileGroupsFromServer()
  }

  // ── 寫回推算結果 ─────────────────────────────────────────────────────────

  /**
   * 要寫回的任務：推算結果跟最後已知 server 狀態不同的那幾筆。
   *
   * - `include` 裡的（這次編輯的對象）：不同就送；server 還沒有（建立中）就先不送，dirty 留著，
   *   等 create 回來由 `addTask` 補送。
   * - 其他：工作日曆 ready、不同、而且不在 dirty 才送——dirty 的是別處還沒送出的編輯（拖曳中、改名 debounce 中），
   *   由它自己的 commit 送。dirty 的下游也先不送：它們的推算位置來自那筆還沒送出的編輯（例如拖曳中途），
   *   等那筆送出時一起送。漂移（跨日重排、被這次編輯推動的下游）都走這條。
   */
  function scheduleWriteSet(include: Set<string>): Task[] {
    // 工作日曆不是 ready（載入失敗、還沒載完）時排程只扣週末，算出來的推算日期是錯的：
    // 只送這次改的任務，漂移與被推動的下游等日曆恢復後的下一次寫回再送（它們隨時能重算，不會丟）
    const calendarReady = useWorkCalendarStore().status === 'ready'
    const held = downstreamOfPending(include)
    const out: Task[] = []
    for (const t of tasks.value) {
      const server = taskTracker.server.get(t.id)
      if (!server || sameTask(t, server)) continue
      if (include.has(t.id)) out.push(t)
      else if (calendarReady && !taskTracker.dirty.has(t.id) && !held.has(t.id)) out.push(t)
    }
    return out
  }

  /** 還沒送出的編輯（dirty 而且不在這次的 include）沿相依往下走得到的任務。 */
  function downstreamOfPending(include: Set<string>): Set<string> {
    const next = new Map<string, string[]>()
    for (const d of deps.value) next.set(d.from, [...(next.get(d.from) ?? []), d.to])
    const out = new Set<string>()
    const stack = [...taskTracker.dirty].filter((id) => !include.has(id))
    while (stack.length) {
      for (const to of next.get(stack.pop()!) ?? []) {
        if (out.has(to)) continue
        out.add(to)
        stack.push(to)
      }
    }
    return out
  }

  /**
   * 把推算結果寫回：`include` 是這次編輯的任務（拖曳放開時是這一段拖曳碰過的 id）。
   *
   * 1. 算寫回集合（`scheduleWriteSet`）。
   * 2. include 中 server 已有的：這次的編輯就此送出，`clearDirty`；推算後跟 server 一樣、不必送的，
   *    存的值對齊回 server（例如根任務的開始日改到週六、推算後還是同一天）。
   * 3. 有東西要送才 `updateTasks`（整批最終狀態，後端不重算，契約 A）。
   */
  async function commitSchedule(include: Iterable<string>): Promise<void> {
    if (!useProjectStore().canEdit) return
    const ids = new Set(include)
    const payload = scheduleWriteSet(ids).map((t) => cloneEntity(t))
    const sending = new Set(payload.map((t) => t.id))
    const settled = [...ids].filter((id) => taskTracker.server.has(id))
    clearDirty(taskTracker, settled)
    for (const id of settled)
      if (!sending.has(id) && !isInflight(taskTracker, id))
        reconcileTask(taskTracker.server.get(id), id)
    if (!payload.length) return
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: [...sending],
      label: '更新任務',
      call: () => api.updateTasks(payload),
      reconcile: reconcileTask,
    })
  }

  // ── 派生 ─────────────────────────────────────────────────────────────────

  /** 甘特圖的時間範圍。legacy `range()` :1995 */
  const range = computed(() => projectRange(tasks.value, useClockStore().todayIdx))

  // ── 分類 ─────────────────────────────────────────────────────────────────

  /** 新增分類，接在最後。legacy `addGroup` :1849 */
  function addGroup(): Group | null {
    if (!useProjectStore().canEdit) return null
    const g: Group = { id: newId(), name: '新分類 ' + (groups.value.length + 1) }
    groups.value.push(g)
    void runOptimistic<Group>({
      tracker: groupTracker,
      ids: [g.id],
      label: '新增分類',
      call: () => api.createGroup(useProjectStore().meta.id, cloneEntity(g)),
      reconcile: reconcileGroup,
    })
    return g
  }

  /** 只改本地的分類名（逐鍵編輯的每一鍵走這條）。legacy `onEdit` :2799 */
  function renameGroupLocal(id: string, name: string): void {
    if (!useProjectStore().canEdit) return
    const g = groupById(id)
    if (!g) return
    g.name = name
    // review F2：debounce 還沒到期，這個值只存在本地
    markDirty(groupTracker, [id])
  }

  /**
   * 只把分類的變更送出去（本地已經改好了）；逐鍵編輯 debounce 到期時走這條。
   * 它不看本地有沒有變——`useEditDraft` 已經逐鍵 apply 過了。
   */
  async function commitGroupPatch(id: string, patch: Partial<Group>): Promise<void> {
    if (!useProjectStore().canEdit) return
    clearDirty(groupTracker, [id])
    await runOptimistic<Group>({
      tracker: groupTracker,
      ids: [id],
      label: '更新分類',
      call: () => api.updateGroup(id, cloneEntity(patch)),
      reconcile: reconcileGroup,
    })
  }

  async function renameGroup(id: string, name: string): Promise<void> {
    if (!useProjectStore().canEdit) return
    const g = groupById(id)
    if (!g || g.name === name) return
    renameGroupLocal(id, name)
    await commitGroupPatch(id, { name })
  }

  /**
   * 刪分類，連底下的任務、那些任務的 Issue / 相依 / 留言一起刪。legacy `grpDelete` :4013。
   * 指到已刪 id 的選取 / 浮層由派生層的 watch 自己清（契約 E）。
   * 分類外、因此失去所有前置的任務變成根任務，保留刪除當下推算的開始日（`pinNewRoots`）。
   */
  async function removeGroup(id: string): Promise<void> {
    if (!useProjectStore().canEdit) return
    const issues = useIssueStore()
    const comments = useCommentStore()
    if (!groupById(id)) return
    const goneTasks = new Set(inputs.value.filter((t) => t.groupId === id).map((t) => t.id))
    const goneIssues = issues.issues.filter((i) => goneTasks.has(i.taskId)).map((i) => i.id)
    const targets = new Set<string>([...goneTasks, ...goneIssues])
    const goneComments = comments.comments.filter((c) => targets.has(c.targetId)).map((c) => c.id)
    const goneDeps = deps.value
      .filter((d) => goneTasks.has(d.from) || goneTasks.has(d.to))
      .map((d) => d.id)
    const pinned = pinNewRoots(
      deps.value.filter((d) => goneTasks.has(d.from) && !goneTasks.has(d.to)).map((d) => d.to),
      (d) => !goneTasks.has(d.from) && !goneTasks.has(d.to),
    )

    groups.value = groups.value.filter((g) => g.id !== id)
    inputs.value = inputs.value.filter((t) => !goneTasks.has(t.id))
    deps.value = deps.value.filter((d) => !goneTasks.has(d.from) && !goneTasks.has(d.to))
    issues.dropLocal(goneIssues)
    comments.dropLocal(goneComments)
    // review F2：刪掉的實體不必再保護未送出的本地變更，否則失敗時還原會被跳過
    clearDirty(taskTracker, goneTasks)
    clearDirty(groupTracker, [id])

    const epoch = taskTracker.epoch
    let ok = false
    await runOptimistic<Group>({
      tracker: groupTracker,
      ids: [id],
      label: '刪除分類',
      call: async () => {
        await api.deleteGroup(id)
        ok = true
        groupTracker.server.delete(id)
        dropServerCascade(goneTasks, goneDeps, goneIssues, goneComments)
      },
      // review F1：成功時 server 已經沒有這筆 → reconcileGroup 是 no-op；
      // 失敗才會把分類與連帶刪掉的那幾筆各自從 server 放回原位
      reconcile: (server, gid) => {
        reconcileGroup(server, gid)
        if (ok) return
        restoreCascadeFromServer(goneTasks, goneDeps, goneIssues, goneComments)
      },
    })
    await settlePinned(pinned, ok, epoch)
  }

  /** 分類與相鄰的那個對調（只改本地）；已在頭尾就不動，回傳有沒有真的動。legacy `moveGroup` :1835 */
  function moveGroupLocal(id: string, dir: -1 | 1): boolean {
    if (!useProjectStore().canEdit) return false
    const i = groups.value.findIndex((g) => g.id === id)
    const j = i + dir
    const a = groups.value[i]
    const b = groups.value[j]
    if (i < 0 || !a || !b) return false
    groups.value[i] = b
    groups.value[j] = a
    // review F2：順序改了但還沒送（拖曳中）
    markDirty(groupTracker, [GROUP_ORDER_KEY])
    return true
  }

  /** 對調並送出；拖曳中的每一次對調請改用 `moveGroupLocal` + `commitGroupOrder`。 */
  async function moveGroup(id: string, dir: -1 | 1): Promise<void> {
    if (!useProjectStore().canEdit) return
    if (!moveGroupLocal(id, dir)) return
    await commitGroupOrder()
  }

  /** 把目前的分類順序送給後端（拖曳放開時送這一次）。 */
  async function commitGroupOrder(): Promise<void> {
    if (!useProjectStore().canEdit) return
    // review F2：這一段順序就此送出（或本來就沒動），不再是「還沒送出的本地變更」
    groupTracker.dirty.delete(GROUP_ORDER_KEY)
    const ids = groups.value.map((g) => g.id)
    const server = [...groupTracker.server.keys()]
    if (ids.length === server.length && ids.every((id, i) => server[i] === id)) return
    let ok = false
    await runOptimistic<Group>({
      tracker: groupTracker,
      ids: [GROUP_ORDER_KEY],
      label: '調整分類順序',
      call: async () => {
        await api.reorderGroups(useProjectStore().meta.id, ids)
        ok = true
        const prev = groupTracker.server
        const next = new Map<string, Group>()
        for (const id of ids) {
          const server = prev.get(id)
          if (server) next.set(id, server)
        }
        // review F3：`ids` 是送出當下的快照，之後才寫進 server 的（例如 create 的回應）
        // 不在裡面——把它們接在後面，不要整批丟掉
        for (const [id, server] of prev) if (!next.has(id)) next.set(id, server)
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
   * 預設值（分類、負責人、開始日、工期）由呼叫端算好傳進來——那些要讀 selection /
   * filter，是派生層的事（契約 E），資料層只負責建立與送出。
   * 起訖照排程算好再存（開始日遇非工作天順延、不早於今天）；計畫開始日＝設定的開始日，計畫起訖一起算好
   * （新任務一建立就有計畫，不會一出生就延遲）。
   * 建立還在飛時又被改了（例如馬上改工期），create 回來後補送一次。
   * 建立後的選取同樣在 `useTaskActions()`。分類不存在時回 null；回傳的是存進去的那個物件（不是 proxy）。
   */
  function addTask(opts: {
    groupId: string
    assigneeIds: string[]
    start: ISODate
    duration: number
  }): Task | null {
    if (!useProjectStore().canEdit) return null
    if (!groupById(opts.groupId)) return null
    const draft: Task = {
      id: newId(),
      groupId: opts.groupId,
      name: '新任務',
      created: useClockStore().todayIso,
      start: opts.start,
      end: opts.start,
      status: 'todo',
      done: '',
      priority: 'mid',
      assigneeIds: opts.assigneeIds.slice(),
      duration: opts.duration,
      baselineStart: opts.start,
      baselineEnd: '',
    }
    const t = scheduleWithPlan(
      [draft],
      [],
      useWorkCalendarStore().workdays,
      useClockStore().todayIdx,
    )[0]!
    inputs.value.push(t)
    const epoch = taskTracker.epoch
    void (async () => {
      await runOptimistic<Task>({
        tracker: taskTracker,
        ids: [t.id],
        label: '新增任務',
        call: () => api.createTask(cloneEntity(t)),
        reconcile: reconcileTask,
      })
      if (taskTracker.epoch !== epoch) return
      if (taskTracker.dirty.has(t.id) && taskTracker.server.has(t.id)) await commitSchedule([t.id])
    })()
    return t
  }

  /** 把編輯套到存的值（`applyTaskEdit`：狀態副作用、無效輸入丟掉、夾值）；有變才標 dirty。 */
  function editInput(id: string, patch: Partial<Task>): boolean {
    const next = applyTaskEdit(inputs.value, hasPred.value, id, patch, useClockStore().todayIso)
    if (next === inputs.value) return false
    inputs.value = next
    // review F2：這個值只在本地（拖曳的 tick、改名的 debounce），送出前不准被 reconcile 蓋掉
    markDirty(taskTracker, [id])
    return true
  }

  /**
   * 只改本地的任務欄位，回傳推算結果真的變了的那幾筆（含被推動的下游）。
   * 拖曳的每個 tick 與逐鍵改名走這條——不打 api，放開 / debounce 到期時再送
   * （`commitSchedule` / `commitTaskPatch`）。
   */
  function applyLocalPatch(id: string, patch: Partial<Task>): Task[] {
    if (!useProjectStore().canEdit) return []
    const before = taskIndex.value
    if (!editInput(id, patch)) return []
    return tasks.value.filter((t) => {
      const was = before.get(t.id)
      return !was || !sameTask(was, t)
    })
  }

  /**
   * 改任務欄位並送給後端。legacy `setTask` :2294。
   *
   * 不牽動排程的欄位（名稱、優先度、負責人…）、而且要寫回的只有它自己時，送單筆 patch
   * （JSON merge patch）；其餘整批寫回推算結果（`commitSchedule`），後端不重算（契約 A）。
   */
  async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
    if (!useProjectStore().canEdit) return
    if (!editInput(id, patch)) return
    const plain = !SCHEDULE_FIELDS.some((k) => k in patch)
    const set = scheduleWriteSet(new Set([id]))
    if (plain && set.length === 1 && set[0]!.id === id) {
      clearDirty(taskTracker, [id])
      await runOptimistic<Task>({
        tracker: taskTracker,
        ids: [id],
        label: '更新任務',
        call: () => api.updateTask(id, cloneEntity(patch)),
        reconcile: reconcileTask,
      })
      return
    }
    await commitSchedule([id])
  }

  /**
   * 只把一筆任務的變更送出去（本地已經改好了）；逐鍵編輯 debounce 到期時走這條。
   * 只給不牽動排程的欄位用（名稱 / 優先度…）——工期、開始日、狀態、完成日請走 `updateTask`。
   */
  async function commitTaskPatch(id: string, patch: Partial<Task>): Promise<void> {
    if (!useProjectStore().canEdit) return
    clearDirty(taskTracker, [id])
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: [id],
      label: '更新任務',
      call: () => api.updateTask(id, cloneEntity(patch)),
      reconcile: reconcileTask,
    })
  }

  /** 把目前的任務順序（含 groupId）送給後端（拖曳放開時送這一次）。 */
  async function commitTaskOrder(): Promise<void> {
    if (!useProjectStore().canEdit) return
    const order = inputs.value.map((t) => ({ id: t.id, groupId: t.groupId }))
    // review F2：這一段搬動就此送出，順序與被改到 groupId 的那幾筆都不再是「未送出」
    taskTracker.dirty.delete(TASK_ORDER_KEY)
    for (const o of order) {
      if (taskTracker.server.get(o.id)?.groupId !== o.groupId) taskTracker.dirty.delete(o.id)
    }
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
      call: async () => {
        await api.reorderTasks(useProjectStore().meta.id, order)
        ok = true
        const prev = taskTracker.server
        const next = new Map<string, Task>()
        for (const o of order) {
          const server = prev.get(o.id)
          if (server) next.set(o.id, { ...server, groupId: o.groupId })
        }
        // review F3：`order` 是送出當下的快照，之後才寫進 server 的（例如 create 的回應）
        // 不在裡面——把它們接在後面，不要整批丟掉
        for (const [id, server] of prev) if (!next.has(id)) next.set(id, server)
        taskTracker.server = next
      },
      reconcile: () => {
        if (!ok) reconcileTasksFromServer()
      },
    })
  }

  /**
   * 直接改完成日。legacy 的 iCal task 模式 `iCalSet` :3486。
   * 完成日就是實際結束日，所以跟一般編輯一樣會推動還沒開始的下游（夾值見 `applyTaskEdit`）。
   */
  async function setTaskDoneDirect(id: string, done: ISODate | ''): Promise<void> {
    if (!useProjectStore().canEdit) return
    await updateTask(id, { done })
  }

  /**
   * 刪任務，連它的 Issue、相依與留言一起刪。legacy `confirmDelete` :4092。
   * `ui.detail` 由 ui 自己的 watch 關掉（§不重現的原頁面 bug 1：
   * legacy 刪完視窗會卡住不關 :1761）。
   * 因此失去所有前置的後續任務變成根任務，保留刪除當下推算的開始日（`pinNewRoots`）。
   */
  async function removeTask(id: string): Promise<void> {
    if (!useProjectStore().canEdit) return
    const issues = useIssueStore()
    const comments = useCommentStore()
    if (!taskById(id)) return
    const goneIssues = issues.issues.filter((i) => i.taskId === id).map((i) => i.id)
    const targets = new Set<string>([id, ...goneIssues])
    const goneComments = comments.comments.filter((c) => targets.has(c.targetId)).map((c) => c.id)
    const goneDeps = deps.value.filter((d) => d.from === id || d.to === id).map((d) => d.id)
    const pinned = pinNewRoots(
      deps.value.filter((d) => d.from === id).map((d) => d.to),
      (d) => d.from !== id && d.to !== id,
    )

    inputs.value = inputs.value.filter((t) => t.id !== id)
    deps.value = deps.value.filter((d) => d.from !== id && d.to !== id)
    issues.dropLocal(goneIssues)
    comments.dropLocal(goneComments)
    // review F2：刪掉的那筆不必再保護未送出的本地變更
    clearDirty(taskTracker, [id])

    const epoch = taskTracker.epoch
    let ok = false
    await runOptimistic<Task>({
      tracker: taskTracker,
      ids: [id],
      label: '刪除任務',
      call: async () => {
        await api.deleteTask(id)
        ok = true
        dropServerCascade(new Set([id]), goneDeps, goneIssues, goneComments)
      },
      // review F1：失敗時只把被刪的那幾筆從 server 放回原位（事件已經刪掉的就不復活）
      reconcile: (server, tid) => {
        reconcileTask(server, tid)
        if (ok) return
        restoreCascadeFromServer([], goneDeps, goneIssues, goneComments)
      },
    })
    await settlePinned(pinned, ok, epoch)
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
   * 刪相依 / 刪任務 / 刪分類**之前**呼叫：`candidates` 中刪掉之後沒有其他前置（`keep` 留下的相依）的
   * 任務，會變成根任務——把它此刻的計畫開始日（未開始的還有推算開始日）寫進存的值並標 dirty，回傳這些 id。
   *
   * 不記的話，根任務的開始日會退回很久以前存的值（或今天），刪一條相依整段排程與計畫就跳一次。
   */
  function pinNewRoots(candidates: string[], keep: (d: Dependency) => boolean): string[] {
    const remaining = predecessorIds(deps.value.filter(keep))
    const pins = new Map<string, Pick<Task, 'start' | 'baselineStart'>>()
    for (const id of new Set(candidates)) {
      const t = taskById(id)
      const input = inputIndex.value.get(id)
      if (!t || !input || remaining.has(id)) continue
      // 已開始的開始日是實際值，不動；計畫開始日一律釘在此刻的計畫
      pins.set(id, {
        start: t.status === 'todo' ? t.start : input.start,
        baselineStart: t.baselineStart,
      })
    }
    if (!pins.size) return []
    inputs.value = inputs.value.map((t) => {
      const pin = pins.get(t.id)
      return pin && (pin.start !== t.start || pin.baselineStart !== t.baselineStart)
        ? { ...t, ...pin }
        : t
    })
    markDirty(taskTracker, pins.keys())
    return [...pins.keys()]
  }

  /**
   * 刪除結束後處理 `pinNewRoots` 記下的任務：成功（而且沒換專案）就寫回；
   * 失敗就放棄記下的開始日、對齊回 server（相依也已經放回來了）。
   */
  async function settlePinned(pinned: string[], ok: boolean, epoch: number): Promise<void> {
    if (!pinned.length || taskTracker.epoch !== epoch) return
    if (ok) {
      await commitSchedule(pinned)
      return
    }
    clearDirty(taskTracker, pinned)
    for (const id of pinned)
      if (!isInflight(taskTracker, id)) reconcileTask(taskTracker.server.get(id), id)
  }

  /**
   * 把任務搬到分類或某個任務旁邊（只改本地），回傳有沒有真的動。legacy `moveTaskTo` :1797。
   * 落在分類上：dir='up' 接在該分類最後、否則插在最前；分類是空的就接在整串最後。
   * 落在任務上：從上往下拖就插在目標後面，從下往上拖就插在前面。
   */
  function moveTaskToLocal(id: string, target: DropTarget): boolean {
    if (!useProjectStore().canEdit) return false
    if (!target || target.id === id) return false
    const list = inputs.value.slice()
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
        inputs.value = list
        return false
      }
      moving.groupId = at.groupId
      list.splice(j >= i ? j + 1 : j, 0, moving)
    }
    inputs.value = list
    // review F2：順序（與換了分類的那一筆）改了但還沒送
    markDirty(taskTracker, [TASK_ORDER_KEY])
    if (taskTracker.server.get(id)?.groupId !== moving.groupId) markDirty(taskTracker, [id])
    return true
  }

  /** 搬動並送出；拖曳中的每一次搬動請改用 `moveTaskToLocal` + `commitTaskOrder`。 */
  async function moveTaskTo(id: string, target: DropTarget): Promise<void> {
    if (!useProjectStore().canEdit) return
    if (!moveTaskToLocal(id, target)) return
    await commitTaskOrder()
  }

  // ── 相依 ─────────────────────────────────────────────────────────────────

  /**
   * 建立相依，回傳有沒有成功。legacy `addDep` :2360。
   * 已經有同一條、或反向已經走得到（會成環）就拒絕。加上相依後畫面立刻照新相依重排；
   * 被推動的任務等 `createDep` 成功才寫回（後端不重算，契約 A）。
   *
   * review F5：相依與寫回是一筆交易——createDep 失敗時相依被收回，畫面自動照原本的相依排回去，
   * 也不送任何 `updateTasks`（否則後端會存下「沒有相依卻被推過」的日期）。
   */
  function addDep(from: string, to: string): boolean {
    if (!useProjectStore().canEdit) return false
    if (!from || !to || from === to) return false
    // review F4：兩端都得是真的任務——摘要條的 `sum-<gid>` 不是
    if (!taskById(from) || !taskById(to)) return false
    if (deps.value.some((d) => d.from === from && d.to === to)) return false
    if (reachable(to, from, deps.value)) return false
    const dep: Dependency = { id: newId(), from, to }
    deps.value = deps.value.concat([dep])

    const epoch = taskTracker.epoch
    void (async () => {
      let ok = false
      await runOptimistic<Dependency>({
        tracker: depTracker,
        ids: [dep.id],
        label: '建立相依',
        call: async () => {
          const saved = await api.createDep(cloneEntity(dep))
          ok = true
          return saved
        },
        reconcile: reconcileDep,
      })
      // 等相依的這段時間換了專案：被推動的那幾筆屬於上一個專案，不送；沒建起來就什麼都不送
      if (taskTracker.epoch !== epoch || !ok) return
      await commitSchedule([])
    })()
    return true
  }

  /** 刪相依；後續任務因此變成根任務時，保留刪除當下推算的開始日（`pinNewRoots`）。 */
  async function removeDep(id: string): Promise<void> {
    if (!useProjectStore().canEdit) return
    const dep = deps.value.find((d) => d.id === id)
    if (!dep) return
    const pinned = pinNewRoots([dep.to], (d) => d.id !== id)
    deps.value = deps.value.filter((d) => d.id !== id)
    const epoch = taskTracker.epoch
    let ok = false
    await runOptimistic<Dependency>({
      tracker: depTracker,
      ids: [id],
      label: '刪除相依',
      call: async () => {
        await api.deleteDep(id)
        ok = true
        depTracker.server.delete(id)
      },
      // review F1：成功時 server 已無此筆 → no-op；失敗才照 server 順序插回來
      reconcile: reconcileDep,
    })
    await settlePinned(pinned, ok, epoch)
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

  /** 起訖是哪條規則決定的（甘特提示、屬性面板用）；任務不存在回 null。 */
  function explain(id: string): ReturnType<typeof explainSchedule> {
    const input = inputIndex.value.get(id)
    if (!input) return null
    return explainSchedule(
      input,
      taskIndex.value,
      deps.value,
      useWorkCalendarStore().workdays,
      useClockStore().todayIdx,
    )
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
    inputs,
    tasks,
    deps,
    hasPred,
    taskById,
    groupById,
    load,
    reset,
    applyEvent,
    range,
    addGroup,
    renameGroup,
    renameGroupLocal,
    commitGroupPatch,
    removeGroup,
    moveGroup,
    moveGroupLocal,
    commitGroupOrder,
    reconcileGroupsFromServer,
    addTask,
    updateTask,
    commitTaskPatch,
    applyLocalPatch,
    commitSchedule,
    commitTaskOrder,
    reconcileTasksFromServer,
    discardTaskDrag,
    discardGroupDrag,
    setTaskDoneDirect,
    removeTask,
    moveTaskTo,
    moveTaskToLocal,
    addDep,
    removeDep,
    predecessors,
    successors,
    explain,
  }
})
