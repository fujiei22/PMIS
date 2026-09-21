import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isoFromIndex } from '@/lib/date'
import { newId } from '@/lib/id'
import { applyTaskPatch, cascade, projectRange, reachable } from '@/lib/schedule'
import { useCommentStore } from '@/stores/comment'
import { useFilterStore } from '@/stores/filter'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useUiStore } from '@/stores/ui'
import type { Dependency, DropTarget, Group, ISODate, ProjectData, Task } from '@/types/models'

/**
 * 分類、任務與相依——Dashboard 的主資料。
 * 它也是 load() 的入口：一次把 ProjectData 分給 member / issue / comment store。
 */
export const useTaskStore = defineStore('task', () => {
  const groups = ref<Group[]>([])
  const tasks = ref<Task[]>([])
  const deps = ref<Dependency[]>([])

  /** id → 物件的索引；legacy 每次 render 重建一次 Map（:1901），這裡交給 computed 快取。 */
  const taskIndex = computed(() => new Map(tasks.value.map((t) => [t.id, t])))
  const groupIndex = computed(() => new Map(groups.value.map((g) => [g.id, g])))

  function taskById(id: string): Task | undefined {
    return taskIndex.value.get(id)
  }

  function groupById(id: string): Group | undefined {
    return groupIndex.value.get(id)
  }

  /**
   * 把一份 ProjectData 灌進各個 store。
   * 任務先跑一次 cascade，把 mocks 裡不符合相依的起訖日對齊（legacy componentDidMount :1918）。
   */
  function load(data: ProjectData): void {
    const members = useMemberStore()
    members.members = data.members
    members.currentUserId = data.currentUserId
    useIssueStore().issues = data.issues
    useCommentStore().comments = data.comments
    groups.value = data.groups
    deps.value = data.deps
    tasks.value = cascade(data.tasks, data.deps)
  }

  /** 甘特圖的時間範圍。legacy `range()` :1995 */
  const range = computed(() => projectRange(tasks.value, useUiStore().todayIdx))

  /**
   * 甘特左欄實際會畫出來的列：每個分類一列，未收合時接上通過篩選的任務。
   * legacy `visible()` :2260
   */
  const visibleRows = computed<{ kind: 'g' | 't'; id: string }[]>(() => {
    const filter = useFilterStore()
    const collapsed = useUiStore().collapsedGroups
    const out: { kind: 'g' | 't'; id: string }[] = []
    for (const g of groups.value) {
      out.push({ kind: 'g', id: g.id })
      if (collapsed.has(g.id)) continue
      for (const t of tasks.value) {
        if (t.groupId === g.id && filter.passTask(t)) out.push({ kind: 't', id: t.id })
      }
    }
    return out
  })

  /** 任務 id → 它在 visibleRows 的索引，甘特條算 top 用。legacy `rowOf` :2711 */
  const rowIndexOf = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    visibleRows.value.forEach((v, i) => {
      if (v.kind === 't') out[v.id] = i
    })
    return out
  })

  /** 新增分類，接在最後。legacy `addGroup` :1849 */
  function addGroup(): Group {
    const g: Group = { id: newId(), name: '新分類 ' + (groups.value.length + 1) }
    groups.value.push(g)
    return g
  }

  function renameGroup(id: string, name: string): void {
    const g = groupById(id)
    if (g) g.name = name
  }

  /**
   * 刪分類，連底下的任務、那些任務的 Issue 與相依一起刪。legacy `grpDelete` :4013。
   * 刪完把指到已刪 id 的選取清掉，免得畫面停在不存在的東西上。
   */
  function removeGroup(id: string): void {
    const gone = new Set(tasks.value.filter((t) => t.groupId === id).map((t) => t.id))
    groups.value = groups.value.filter((g) => g.id !== id)
    tasks.value = tasks.value.filter((t) => t.groupId !== id)
    const issues = useIssueStore()
    issues.issues = issues.issues.filter((i) => !gone.has(i.taskId))
    deps.value = deps.value.filter((d) => !gone.has(d.from) && !gone.has(d.to))
    const sel = useSelectionStore()
    if (sel.taskId && gone.has(sel.taskId)) sel.taskId = null
    if (sel.groupId === id) sel.groupId = null
    if (sel.issueId && !issues.byId(sel.issueId)) sel.issueId = null
    const ui = useUiStore()
    if (ui.detail && (gone.has(ui.detail.id) || ui.detail.id === id)) ui.closeDetail()
  }

  /** 收合 / 展開一個分類；狀態在 ui（review C5）。legacy `onCaret` :2800 */
  function toggleGroup(id: string): void {
    useUiStore().toggleGroup(id)
  }

  /** 全部收合 / 全部展開。legacy `toggleAllGroups` :4110 */
  function setAllCollapsed(v: boolean): void {
    useUiStore().setAllCollapsed(v)
  }

  /** 分類與相鄰的那個對調；已在頭尾就不動。legacy `moveGroup` :1835 */
  function moveGroup(id: string, dir: -1 | 1): void {
    const i = groups.value.findIndex((g) => g.id === id)
    const j = i + dir
    const a = groups.value[i]
    const b = groups.value[j]
    if (i < 0 || !a || !b) return
    groups.value[i] = b
    groups.value[j] = a
  }

  /**
   * 新增任務。legacy `addTask` :4128。
   * 一個分類都沒有時 legacy 改成新增分類（回 null）；
   * 分類取選取的分類 → 選取任務所在的分類 → 第一個分類，日期今天起五天，負責人沿用成員篩選。
   */
  function addTask(): Task | null {
    if (!groups.value.length) {
      addGroup()
      return null
    }
    const sel = useSelectionStore()
    const base = useUiStore().todayIdx
    const t: Task = {
      id: newId(),
      groupId:
        sel.groupId ?? (sel.taskId ? taskById(sel.taskId)?.groupId : null) ?? groups.value[0]!.id,
      name: '新任務',
      created: isoFromIndex(base),
      start: isoFromIndex(base),
      end: isoFromIndex(base + 4),
      status: 'todo',
      done: '',
      priority: 'mid',
      assigneeIds: useFilterStore().memberIds.slice(),
    }
    tasks.value.push(t)
    sel.selectTask(t.id)
    return t
  }

  /** 改任務欄位並連動下游。legacy `setTask` :2294 */
  function updateTask(id: string, patch: Partial<Task>): void {
    // changed 是「真的變動的那幾筆」，R2 會拿它送 api.updateTasks；R1 只要新陣列
    const { tasks: next } = applyTaskPatch(
      tasks.value,
      deps.value,
      id,
      patch,
      useUiStore().todayIso,
    )
    tasks.value = next
  }

  /**
   * 只改完成日、不跑 cascade。legacy 的 iCal task 模式 `iCalSet` :3486。
   * 這條路徑是日期選擇器直接寫完成日，不該牽動任何排程。
   */
  function setTaskDoneDirect(id: string, done: ISODate | ''): void {
    const t = taskById(id)
    if (t) t.done = done
  }

  /**
   * 刪任務，連它的 Issue 與相依一起刪。legacy `confirmDelete` :4092。
   * 也清掉 ui.detail（§不重現的原頁面 bug 1：legacy 刪完視窗會卡住不關 :1761）。
   */
  function removeTask(id: string): void {
    tasks.value = tasks.value.filter((t) => t.id !== id)
    const issues = useIssueStore()
    issues.issues = issues.issues.filter((i) => i.taskId !== id)
    deps.value = deps.value.filter((d) => d.from !== id && d.to !== id)
    const sel = useSelectionStore()
    if (sel.taskId === id) sel.taskId = null
    if (sel.issueId && !issues.byId(sel.issueId)) sel.issueId = null
    const ui = useUiStore()
    if (ui.detail && (ui.detail.id === id || ui.detail.from === id)) ui.closeDetail()
    if (ui.depEditFor === id) ui.depEditFor = null
    if (ui.pickerFor === id) ui.pickerFor = null
  }

  /**
   * 把任務搬到分類或某個任務旁邊。legacy `moveTaskTo` :1797。
   * 落在分類上：dir='up' 接在該分類最後、否則插在最前；分類是空的就接在整串最後。
   * 落在任務上：從上往下拖就插在目標後面，從下往上拖就插在前面。
   */
  function moveTaskTo(id: string, target: DropTarget): void {
    if (!target || target.id === id) return
    const list = tasks.value.slice()
    const i = list.findIndex((t) => t.id === id)
    if (i < 0) return
    const removed = list.splice(i, 1)[0]
    if (!removed) return
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
        return
      }
      moving.groupId = at.groupId
      list.splice(j >= i ? j + 1 : j, 0, moving)
    }
    tasks.value = list
  }

  /** 指派成員：跟現有的取聯集，不重複。legacy `assign` :2422 */
  function assign(taskId: string, memberIds: string[]): void {
    if (!memberIds.length) return
    const t = taskById(taskId)
    if (!t) return
    const who = t.assigneeIds.slice()
    for (const id of memberIds) if (!who.includes(id)) who.push(id)
    updateTask(taskId, { assigneeIds: who })
  }

  /**
   * 建立相依，回傳有沒有成功。legacy `addDep` :2360。
   * 已經有同一條、或反向已經走得到（會成環）就拒絕；成功後跑一次 cascade 對齊日期。
   */
  function addDep(from: string, to: string): boolean {
    if (!from || !to || from === to) return false
    if (deps.value.some((d) => d.from === from && d.to === to)) return false
    if (reachable(to, from, deps.value)) return false
    deps.value = deps.value.concat([{ id: newId(), from, to }])
    tasks.value = cascade(tasks.value, deps.value, {})
    return true
  }

  function removeDep(id: string): void {
    deps.value = deps.value.filter((d) => d.id !== id)
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

  return {
    groups,
    tasks,
    deps,
    taskById,
    groupById,
    load,
    range,
    visibleRows,
    rowIndexOf,
    addGroup,
    renameGroup,
    removeGroup,
    toggleGroup,
    setAllCollapsed,
    moveGroup,
    addTask,
    updateTask,
    setTaskDoneDirect,
    removeTask,
    moveTaskTo,
    assign,
    addDep,
    removeDep,
    predecessors,
    successors,
  }
})
