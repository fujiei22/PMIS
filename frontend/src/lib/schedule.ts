import { dayIndex, isoFromIndex } from '@/lib/date'
import type { Workdays } from '@/lib/workdays'
import type { Dependency, ISODate, Issue, Task } from '@/types/models'

/**
 * 排程運算：前推排程、循環偵測、延遲判定、編輯限制、專案時間範圍。
 * 全部是純函式，不碰 store；規則見 docs/reference/scheduling.md，legacy 對照行號標在各函式上。
 */

/**
 * 從 from 沿相依往下走，走得到 to 嗎。legacy `reachable` :2349。
 * addDep(x, y) 用 reachable(y, x) 判斷「加了會不會成環」。
 */
export function reachable(from: string, to: string, deps: Dependency[]): boolean {
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === to) return true
    if (seen.has(id)) return false
    seen.add(id)
    return deps.some((d) => d.from === id && walk(d.to))
  }
  return walk(from)
}

/**
 * 兩筆任務的欄位是否完全一樣（陣列逐項比）；用來判斷能不能沿用舊物件。
 * task store 算寫回集合時也用它比對「推算結果 vs 最後已知 server 狀態」。
 */
export function sameTask(a: Task, b: Task): boolean {
  if (a === b) return true
  const keys = Object.keys(a) as (keyof Task)[]
  if (keys.length !== Object.keys(b).length) return false
  for (const k of keys) {
    const va = a[k]
    const vb = b[k]
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length || va.some((x, i) => x !== vb[i])) return false
    } else if (va !== vb) return false
  }
  return true
}

/** Issue 是否已延遲：還沒結案而且期限已經過去。legacy `isLateIssue` :2278 */
export function isLateIssue(i: Issue, todayIdx: number): boolean {
  return !!i && i.status !== 'closed' && !!i.due && dayIndex(i.due) < todayIdx
}

/**
 * 甘特圖的時間範圍。legacy `range` :1995。
 * min / max 是任務實際涵蓋的範圍，a / b 是畫布範圍（前留 3 天、後留 4 天）。
 * 沒有任何任務時退成「今天起 20 天」。
 */
export function projectRange(
  tasks: Task[],
  todayIdx: number,
): { a: number; b: number; min: number; max: number } {
  let a = Infinity
  let b = -Infinity
  for (const t of tasks) {
    a = Math.min(a, dayIndex(t.start))
    b = Math.max(b, dayIndex(t.end))
  }
  if (!Number.isFinite(a)) {
    a = todayIdx
    b = a + 20
  }
  return { a: a - 3, b: b + 4, min: a, max: b }
}

// ═══ 前推排程（規則見 docs/reference/scheduling.md）════════════════════════════
// 工期是工作天、完成到開始、以實際進度推下游、延遲與計畫進度看計畫基準。

/** 工期（工作天）的上限；跟後端 tasks.duration_days 的 CHECK、日期選擇器的上限一致（readme.spec 守）。 */
export const DURATION_MAX = 3650

/**
 * 會牽動排程的欄位：編輯帶了其中任何一個，就要整批寫回推算結果（task store 的 `updateTask`）；
 * 其他欄位（名稱、優先度、負責人…）只送單筆 patch。加新的排程欄位時一併加進來。
 */
export const SCHEDULE_FIELDS = ['start', 'duration', 'status', 'done'] as const

/** 不能編輯的原因（null＝可以）。第 3 個 branch（三層任務）會加 'rollup'（由下層彙總、唯讀）。 */
export type EditBlock = 'predecessor' | 'done' | null
/** 開始日由哪條規則決定：實際開工日／設定的開始日／前置結束後／順延到今天。 */
export type StartReason = 'actual' | 'root' | 'pred' | 'today'
/** 結束日由哪條規則決定：完成日／依工期推算／逾期暫定今天。 */
export type EndReason = 'done' | 'duration' | 'overdue'

/** 排程說明：開始日、結束日各由哪條規則決定（甘特提示、屬性面板用；規則見 docs/reference/scheduling.md〈開始日〉〈結束日〉）。 */
export interface ScheduleMeta {
  startBy: StartReason
  /** startBy 是 'pred'：決定開始日的前置（結束得最晚的那個；同一天取相依先建立的）。 */
  predId?: string
  endBy: EndReason
  /** endBy 是 'overdue'：原定結束日（日索引，從開始日照工期推算的那天；跟「計畫」＝基準不是同一件事）。 */
  originalEnd?: number
}

/**
 * 排程結果：推算後的任務（順序同輸入）、每個任務的說明，以及有環時被略過的相依
 * （資料錯誤；沒有環時是空陣列。lib 不印 log，由 task store 警告）。
 */
export interface Scheduled {
  tasks: Task[]
  meta: Map<string, ScheduleMeta>
  skipped: { from: string; to: string }[]
}

/** 工期夾在 1–DURATION_MAX；0、負數、NaN 當 1。 */
function clampDuration(n: number): number {
  return Number.isFinite(n) ? Math.min(DURATION_MAX, Math.max(1, Math.round(n))) : 1
}

/** 已開始（進行中、暫停、完成）：開始日是實際值，不再被前置或今天推動。 */
export function isStarted(t: Pick<Task, 'status'>): boolean {
  return t.status !== 'todo'
}

/** 有前置的任務 id（相依的 to）。 */
export function predecessorIds(deps: Dependency[]): Set<string> {
  return new Set(deps.map((dep) => dep.to))
}

/**
 * 排出每個任務的起訖（規則見 docs/reference/scheduling.md〈開始日〉〈結束日〉）。
 *
 * 回傳新陣列、順序同 tasks；起訖沒變的回原物件（元件靠參照跳過重算）。
 * 依 `topoOrder` 的順序排；相依保證無環（addDep 用 reachable 擋），萬一資料有環見 `topoOrder`。
 * 只認兩端都存在的相依。
 */
export function scheduleTasks(
  tasks: Task[],
  deps: Dependency[],
  wd: Workdays,
  todayIdx: number,
): Task[] {
  return runSchedule(tasks, deps, wd, todayIdx).tasks
}

/** `scheduleTasks` 的本體：同一趟排出起訖、說明與被略過的相依（`scheduleProject` 也用）。 */
function runSchedule(tasks: Task[], deps: Dependency[], wd: Workdays, todayIdx: number): Scheduled {
  const by = new Map(tasks.map((t) => [t.id, t]))
  const preds = predecessorMap(by, deps)
  const today = wd.onOrAfter(todayIdx)
  const placed = new Map<string, { s: number; e: number }>()
  const meta = new Map<string, ScheduleMeta>()
  const skipped: Scheduled['skipped'] = []

  for (const id of topoOrder(
    tasks.map((t) => t.id),
    preds,
  )) {
    const t = by.get(id)!
    const before = preds.get(id) ?? []
    // 有環時被強制放行的任務，還沒排到的前置當作不存在（見 topoOrder），記下來給 store 警告
    for (const p of before) if (!placed.has(p)) skipped.push({ from: p, to: id })
    const m: ScheduleMeta = { startBy: 'actual', endBy: 'duration' }

    let s: number
    if (isStarted(t) && t.start) s = dayIndex(t.start)
    else {
      // 根任務照設定的開始日（遇非工作天順延）；有前置的從最晚的前置結束後的下一個工作天開始。
      // 前置照相依的順序看、更晚才換（同一天取相依先建立的）
      let predId: string | undefined
      s = -Infinity
      for (const p of before) {
        const r = placed.get(p)
        if (!r) continue
        const next = wd.after(r.e)
        if (next > s) {
          s = next
          predId = p
        }
      }
      if (predId === undefined) s = wd.onOrAfter(t.start ? dayIndex(t.start) : todayIdx)
      // 還沒開始的不早於今天；被推到今天時不帶 predId
      if (s < today) {
        s = today
        m.startBy = 'today'
      } else if (predId === undefined) m.startBy = 'root'
      else {
        m.startBy = 'pred'
        m.predId = predId
      }
    }
    let e: number
    if (t.status === 'done' && t.done) {
      e = Math.max(dayIndex(t.done), s)
      m.endBy = 'done'
    } else {
      e = wd.addWorkdays(s, clampDuration(t.duration))
      // 進行中或暫停、照工期該結束卻還沒完成：結束日推到今天（每天往後推，後續任務跟著推）
      if ((t.status === 'doing' || t.status === 'paused') && e < todayIdx) {
        m.endBy = 'overdue'
        m.originalEnd = e
        e = today
      }
    }
    placed.set(id, { s, e })
    meta.set(id, m)
  }

  return {
    tasks: tasks.map((t) => {
      const { s, e } = placed.get(t.id)!
      const start = isoFromIndex(s)
      const end = isoFromIndex(e)
      return start === t.start && end === t.end ? t : { ...t, start, end }
    }),
    meta,
    skipped,
  }
}

/** 每個任務的前置 id；只認兩端都存在的相依。`scheduleTasks` 與 `planTasks` 共用。 */
function predecessorMap(by: Map<string, Task>, deps: Dependency[]): Map<string, string[]> {
  const preds = new Map<string, string[]>()
  for (const dep of deps) {
    if (!by.has(dep.from) || !by.has(dep.to)) continue
    const list = preds.get(dep.to) ?? []
    list.push(dep.from)
    preds.set(dep.to, list)
  }
  return preds
}

/**
 * 計算順序（Kahn 拓樸排序）：前置一定排在後續之前。起始那批照 ids 的順序，之後照就緒的先後；
 * 沒有環時順序不影響排程結果。preds 只能含 ids 裡的任務（predecessorMap 保證）。
 *
 * 有環（資料錯誤，addDep 會擋）時卡住：從 ids 裡第一個還沒排的任務，沿「還沒排的前置」往回走，
 * 第一個走回頭的任務一定在環上——只強制放行它（它還沒排到的前置當作不存在），再繼續排。
 * 每個環只略過一條相依；環的下游照常等前置。不遞迴，長鏈也不吃呼叫堆疊。
 */
export function topoOrder(ids: string[], preds: Map<string, string[]>): string[] {
  const uniq = [...new Set(ids)]
  const indeg = new Map(uniq.map((id) => [id, 0]))
  const succ = new Map<string, string[]>()
  for (const [to, list] of preds) {
    for (const from of list) {
      indeg.set(to, (indeg.get(to) ?? 0) + 1)
      const s = succ.get(from) ?? []
      s.push(to)
      succ.set(from, s)
    }
  }
  const queue = uniq.filter((id) => indeg.get(id) === 0)
  const queued = new Set(queue)
  const done = new Set<string>()
  for (let i = 0; done.size < uniq.length; i++) {
    if (i === queue.length) {
      // 卡住＝佇列裡的都排完了，剩下的都在環上或環的下游（每個都還有沒排的前置）
      let id = uniq.find((x) => !queued.has(x))!
      const seen = new Set<string>()
      while (!seen.has(id)) {
        seen.add(id)
        id = preds.get(id)!.find((p) => !done.has(p))!
      }
      queue.push(id)
      queued.add(id)
    }
    const id = queue[i]!
    done.add(id)
    for (const to of succ.get(id) ?? []) {
      const n = indeg.get(to)! - 1
      indeg.set(to, n)
      if (n <= 0 && !queued.has(to)) {
        queue.push(to)
        queued.add(to)
      }
    }
  }
  return queue
}

/**
 * 排出每個任務的計畫起訖（規則見 docs/reference/scheduling.md〈計畫與延遲〉）。
 *
 * 只看 PM 輸入的東西：根任務的計畫開始日（`baselineStart`；舊資料沒有時用 `start`，遇非工作天順延）、
 * 工期、相依（完成到開始）。今天、實際開始日、完成日、逾期都不影響——PM 一改輸入計畫就跟著變，
 * 現實造成的落後（`scheduleTasks` 的推算晚於計畫）才是延遲。依 `topoOrder` 的順序排，環的處理見 `topoOrder`。
 *
 * @param todayIdx 只給「根任務兩個開始日都是空的」壞資料當起點，其他情況用不到
 */
export function planTasks(
  tasks: Task[],
  deps: Dependency[],
  wd: Workdays,
  todayIdx: number,
): Map<string, { start: ISODate; end: ISODate }> {
  const by = new Map(tasks.map((t) => [t.id, t]))
  const preds = predecessorMap(by, deps)
  const placed = new Map<string, { s: number; e: number }>()

  for (const id of topoOrder(
    tasks.map((t) => t.id),
    preds,
  )) {
    const t = by.get(id)!
    // 有環時被強制放行的任務，還沒排到的前置當作不存在（見 topoOrder）
    const before = (preds.get(id) ?? []).flatMap((p) => placed.get(p) ?? [])
    const planned = t.baselineStart || t.start
    const s = before.length
      ? Math.max(...before.map((p) => wd.after(p.e)))
      : wd.onOrAfter(planned ? dayIndex(planned) : todayIdx)
    placed.set(id, { s, e: wd.addWorkdays(s, clampDuration(t.duration)) })
  }

  const out = new Map<string, { start: ISODate; end: ISODate }>()
  for (const t of tasks) {
    const { s, e } = placed.get(t.id)!
    out.set(t.id, { start: isoFromIndex(s), end: isoFromIndex(e) })
  }
  return out
}

/**
 * 推算起訖、計畫、說明一次排完（task store 用）：`tasks` 是 `scheduleTasks` 排出畫面上的起訖、
 * 再把 `planTasks` 的計畫起訖填進基準欄位（`baselineStart`／`baselineEnd`）；延遲＝推算結束日晚於計畫結束日（`isLate`）。
 * `meta` 是每個任務的 `ScheduleMeta`（甘特提示、屬性面板讀它，不再照規則另推一次）；`skipped` 見 `Scheduled`。
 * tasks 回新陣列、順序同輸入；起訖與計畫都沒變的回原物件。
 */
export function scheduleProject(
  tasks: Task[],
  deps: Dependency[],
  wd: Workdays,
  todayIdx: number,
): Scheduled {
  const plan = planTasks(tasks, deps, wd, todayIdx)
  const { tasks: out, meta, skipped } = runSchedule(tasks, deps, wd, todayIdx)
  return {
    tasks: out.map((t) => {
      const p = plan.get(t.id)!
      return p.start === t.baselineStart && p.end === t.baselineEnd
        ? t
        : { ...t, baselineStart: p.start, baselineEnd: p.end }
    }),
    meta,
    skipped,
  }
}

/**
 * 推算起訖加上計畫（同 `scheduleProject` 的 tasks）；只要任務、不要說明時用（總覽摘要、新增任務的草稿）。
 * 回傳新陣列、順序同 tasks；起訖與計畫都沒變的回原物件。
 */
export function scheduleWithPlan(
  tasks: Task[],
  deps: Dependency[],
  wd: Workdays,
  todayIdx: number,
): Task[] {
  return scheduleProject(tasks, deps, wd, todayIdx).tasks
}

/**
 * 說明某個任務的起訖是哪條規則決定的（甘特提示、屬性面板用）。
 *
 * @param input 那個任務的原始輸入（根任務要看設定的開始日，推算後的值看不出來是不是被推到今天）
 * @param scheduled 推算後的任務（id → 任務）
 * @returns 不在 scheduled 裡回 null
 */
export function explainSchedule(
  input: Task,
  scheduled: Map<string, Task>,
  deps: Dependency[],
  wd: Workdays,
  todayIdx: number,
): { startBy: StartReason; predId?: string; endBy: EndReason } | null {
  const t = scheduled.get(input.id)
  if (!t) return null
  const today = wd.onOrAfter(todayIdx)

  let startBy: StartReason
  let predId: string | undefined
  if (isStarted(input) && input.start) startBy = 'actual'
  else {
    let candidate = -Infinity
    for (const dep of deps) {
      if (dep.to !== input.id) continue
      const p = scheduled.get(dep.from)
      if (!p) continue
      const next = wd.after(dayIndex(p.end))
      if (next > candidate) {
        candidate = next
        predId = p.id
      }
    }
    if (predId === undefined)
      candidate = wd.onOrAfter(input.start ? dayIndex(input.start) : todayIdx)
    if (candidate < today) {
      startBy = 'today'
      predId = undefined
    } else startBy = predId === undefined ? 'root' : 'pred'
  }

  let endBy: EndReason = 'duration'
  if (t.status === 'done' && t.done) endBy = 'done'
  else if (isOverdue(t, wd, todayIdx)) endBy = 'overdue'
  return predId === undefined ? { startBy, endBy } : { startBy, predId, endBy }
}

/**
 * 套用使用者的編輯到原始輸入（規則見 docs/reference/scheduling.md〈狀態改變時寫入的值〉
 * 〈不會生效的輸入不寫進資料〉）。沒有變動回原陣列；變動的那筆是新物件，其他保留原物件。
 *
 * - 狀態改變：未開始 → 已開始時開始日記成今天（patch 同時帶 start 就用 patch 的）；
 *   進完成補完成日（已有值不覆蓋）；離開完成清完成日。
 * - 有前置、未開始的任務：start 不生效，丟掉。
 * - 沒有前置、未開始的任務：start 同時寫進 `baselineStart`（計畫開始日，見〈計畫與延遲〉）。
 * - 夾值：工期 1–3650（NaN 丟掉）；進行中／暫停的開始日不晚於今天；完成的開始日不晚於完成日；
 *   完成日不早於開始日。
 * - 已完成：工期不生效（結束日就是完成日）、完成日不能清掉。
 */
export function applyTaskEdit(
  tasks: Task[],
  hasPred: Set<string>,
  id: string,
  patch: Partial<Task>,
  todayIso: ISODate,
): Task[] {
  const target = tasks.find((x) => x.id === id)
  if (!target) return tasks
  const clean: Partial<Task> = { ...patch }
  if ('duration' in clean) {
    if (!Number.isFinite(clean.duration)) delete clean.duration
    else clean.duration = clampDuration(clean.duration!)
  }
  const next: Task = { ...target, ...clean }

  if (clean.status && clean.status !== target.status) {
    if (!isStarted(target) && isStarted(next) && !('start' in clean)) next.start = todayIso
    if (next.status === 'done') {
      if (!next.done) next.done = todayIso
    } else next.done = ''
  }
  // 有前置、未開始：開始日由前置決定，存了也不會生效
  if ('start' in clean && next.status === 'todo' && hasPred.has(id)) next.start = target.start
  // 未開始根任務的開始日就是計畫開始日：PM 改了就是新計畫（已開始的開始日是實際值，改它不動計畫）
  else if ('start' in clean && next.status === 'todo') next.baselineStart = next.start
  // 已開始的開始日上限：進行中／暫停不晚於今天；完成不晚於完成日
  if ((next.status === 'doing' || next.status === 'paused') && next.start > todayIso)
    next.start = todayIso
  // 已完成：結束日就是完成日，改工期不會生效；完成日也不能清掉（缺的舊資料補上今天）
  if (next.status === 'done') {
    next.duration = target.duration
    if (!next.done) next.done = target.status === 'done' && target.done ? target.done : todayIso
  }
  // 完成的起訖：改的是完成日就把完成日夾到開始日以後；其他情況把開始日夾到完成日以前
  if (next.status === 'done' && next.done) {
    if ('done' in clean && next.done < next.start) next.done = next.start
    else if (next.start > next.done) next.start = next.done
  }

  if (sameTask(next, target)) return tasks
  return tasks.map((x) => (x.id === id ? next : x))
}

/** 開始日能不能改（日期選擇器）：有前置、未開始的不能。 */
export function startBlock(t: Task, hasPred: Set<string>): EditBlock {
  return t.status === 'todo' && hasPred.has(t.id) ? 'predecessor' : null
}

/** 能不能整條拖、拉左把手：完成的不能；其他同開始日。 */
export function moveBlock(t: Task, hasPred: Set<string>): EditBlock {
  return t.status === 'done' ? 'done' : startBlock(t, hasPred)
}

/** 能不能改工期（右把手、±1、工期欄、選結束日）：完成的不能（結束日就是完成日）。 */
export function durationBlock(t: Task): EditBlock {
  return t.status === 'done' ? 'done' : null
}

/** 日期選擇器與列選單的說明行原因（為什麼有東西停用）；文字在 constants 的 `EDIT_NOTE_TEXT`。 */
export type EditNote = 'predecessor' | 'done' | 'startAfterToday' | 'overdueShrink'

/**
 * 起訖日期選擇器的說明行：對準開始日或結束日時，哪條規則讓某些格子停用（null＝沒有）。
 * 畫面（DatePicker）與開浮層時的估高（useMenus）用同一個判斷。
 */
export function taskPickerNote(
  t: Task,
  target: 'start' | 'end',
  hasPred: Set<string>,
  wd: Workdays,
  todayIdx: number,
): EditNote | null {
  const block = startBlock(t, hasPred) ?? durationBlock(t)
  if (block) return block
  if (target === 'start' && (t.status === 'doing' || t.status === 'paused'))
    return 'startAfterToday'
  if (target === 'end' && isOverdue(t, wd, todayIdx)) return 'overdueShrink'
  return null
}

/** 工期 ±1（列選單）的說明行：完成的兩顆都停、逾期只停 −1（null＝沒有）。 */
export function durationNote(t: Task, wd: Workdays, todayIdx: number): EditNote | null {
  const block = durationBlock(t)
  if (block) return block
  return isOverdue(t, wd, todayIdx) ? 'overdueShrink' : null
}

/** 照工期該結束的那天（日索引）：從開始日起算第「工期」個工作天；逾期的「原定結束日」就是它。 */
export function plannedEndIdx(t: Task, wd: Workdays): number {
  return wd.addWorkdays(dayIndex(t.start), clampDuration(t.duration))
}

/** 逾期未完成：進行中或暫停，而且照工期該結束的日子早於今天。 */
export function isOverdue(t: Task, wd: Workdays, todayIdx: number): boolean {
  if (t.status !== 'doing' && t.status !== 'paused') return false
  if (!t.start) return false
  return plannedEndIdx(t, wd) < todayIdx
}

/**
 * 有效工期（顯示與 ±1 用；t 是推算後的任務）：
 * 完成＝實際起訖的工作天；進行中／暫停＝max(輸入工期, 起訖的工作天)；未開始＝輸入工期。
 */
export function durationOf(t: Task, wd: Workdays): number {
  if (t.status === 'todo' || !t.start || !t.end) return clampDuration(t.duration)
  const span = wd.countWorkdays(dayIndex(t.start), dayIndex(t.end))
  if (t.status === 'done') return Math.max(1, span)
  return Math.max(clampDuration(t.duration), span)
}

/**
 * 已延遲：未完成，而且推算結束日晚於計畫結束日（基準欄位）；沒有計畫不算。legacy `isLate` :2277（legacy 看的是 end < 今天）。
 * t 必須是推算後的任務（store 的 tasks，`scheduleWithPlan` 排過）：存的 end 是上次寫回的快照，可能已經過時。
 */
export function isLate(t: Task): boolean {
  return (
    t.status !== 'done' && !!t.baselineEnd && !!t.end && dayIndex(t.end) > dayIndex(t.baselineEnd)
  )
}

/**
 * 晚了幾個工作天：基準結束日的隔天到推算結束日之間的工作天數；沒延遲回 0。
 * 例：基準結束 09-16、推算結束 09-18（都是工作天）→ 2。
 */
export function lateDays(t: Task, wd: Workdays): number {
  if (!isLate(t)) return 0
  return wd.countWorkdays(dayIndex(t.baselineEnd) + 1, dayIndex(t.end))
}

/**
 * 照計畫此刻該完成了嗎：基準結束日**早於今天**（今天到期的任務今天還沒到期，隔天才算；legacy 用 `<=`，
 * 這裡刻意不同）。Dashboard 的理論進度與總覽的 taskPlanned 都用這一個判準；沒有基準不算。
 */
export function isPlannedDone(t: Task, todayIdx: number): boolean {
  return !!t.baselineEnd && dayIndex(t.baselineEnd) < todayIdx
}
