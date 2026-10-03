import { dayIndex, isoFromIndex } from '@/lib/date'
import type { Workdays } from '@/lib/workdays'
import type { Dependency, ISODate, Issue, Task } from '@/types/models'

/**
 * 排程運算：前推排程、循環偵測、延遲判定、專案時間範圍（編輯限制在 lib/editPolicy.ts）。
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
 * 排程結果：推算後的任務（順序同輸入）、每個任務的說明、有環時被略過的相依
 * （資料錯誤；沒有環時是空陣列。lib 不印 log，由 task store 警告），以及有前置的任務。
 */
export interface Scheduled {
  tasks: Task[]
  meta: Map<string, ScheduleMeta>
  skipped: { from: string; to: string }[]
  /**
   * 有前置的任務 id：只算排程真的用到的前置（兩端都存在、沒被環略過）。
   * 「有前置」的唯一定義：編輯限制（未開始時開始日由前置決定）讀這一份，跟排程說明不會互相矛盾。
   */
  hasPred: Set<string>
}

/** 工期夾在 1–DURATION_MAX；0、負數、NaN 當 1。 */
export function clampDuration(n: number): number {
  return Number.isFinite(n) ? Math.min(DURATION_MAX, Math.max(1, Math.round(n))) : 1
}

/** 已開始（進行中、暫停、完成）：開始日是實際值，不再被前置或今天推動。 */
export function isStarted(t: Pick<Task, 'status'>): boolean {
  return t.status !== 'todo'
}

/**
 * 有前置的任務 id（相依的 to）。給了 ids 就只認兩端都在裡面的相依（跟排程器一樣，懸空的相依不算）。
 * 排程中的「有前置」看 `Scheduled.hasPred`；這支給還沒排程的情境用（例：刪相依前先算誰會變成根任務）。
 */
export function predecessorIds(deps: Dependency[], ids?: ReadonlySet<string>): Set<string> {
  return new Set(
    deps.filter((dep) => !ids || (ids.has(dep.from) && ids.has(dep.to))).map((dep) => dep.to),
  )
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
  const hasPred = new Set<string>()

  for (const id of topoOrder(
    tasks.map((t) => t.id),
    preds,
  )) {
    const t = by.get(id)!
    const before = preds.get(id) ?? []
    // 有環時被拿掉的相依：排到時前置還沒排，當作不存在（見 topoOrder），記下來給 store 警告
    for (const p of before) {
      if (placed.has(p)) hasPred.add(id)
      else skipped.push({ from: p, to: id })
    }
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
    hasPred,
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
 * 有環（資料錯誤，addDep 會擋）時卡住：從 ids 裡第一個還沒排的任務，沿「還沒排、沒被拿掉的前置」往回走，
 * 走回頭時就找到一個環——只拿掉走進重複任務的那一條相依，再看有沒有任務因此可以排；還是卡住就再找下一個環。
 * 每個環只略過閉合的那一條，不在環上的相依照用。實際被略過的是哪幾條，由呼叫端看「排到時前置還沒排」得知
 * （`runSchedule` 的 skipped）。不遞迴，長鏈也不吃呼叫堆疊。
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
  /** 有環時拿掉的相依（`from>to`）。 */
  const cut = new Set<string>()
  const live = (from: string, to: string) => !cut.has(`${from}>${to}`)
  /** 少了 by 條還沒排的前置；全部排完就進佇列。 */
  const release = (id: string, by: number) => {
    const n = indeg.get(id)! - by
    indeg.set(id, n)
    if (n <= 0 && !queued.has(id)) {
      queue.push(id)
      queued.add(id)
    }
  }
  for (let i = 0; done.size < uniq.length; i++) {
    while (i === queue.length) {
      // 卡住＝佇列裡的都排完了，剩下的都在環上或環的下游（每個都還有沒排、沒被拿掉的前置）
      const path = [uniq.find((x) => !queued.has(x))!]
      for (;;) {
        const cur = path[path.length - 1]!
        const p = preds.get(cur)!.find((q) => !done.has(q) && live(q, cur))!
        const k = path.indexOf(p)
        if (k < 0) {
          path.push(p)
          continue
        }
        // 走回 path[k]：環是 path[k..]，拿掉走進 path[k] 的那一條（自己指向自己時就是那一條）
        const to = path[k]!
        const from = path[k + 1] ?? p
        cut.add(`${from}>${to}`)
        release(to, preds.get(to)!.filter((q) => q === from).length)
        break
      }
    }
    const id = queue[i]!
    done.add(id)
    for (const to of succ.get(id) ?? []) if (live(id, to)) release(to, 1)
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
  const { tasks: out, meta, skipped, hasPred } = runSchedule(tasks, deps, wd, todayIdx)
  return {
    tasks: out.map((t) => {
      const p = plan.get(t.id)!
      return p.start === t.baselineStart && p.end === t.baselineEnd
        ? t
        : { ...t, baselineStart: p.start, baselineEnd: p.end }
    }),
    meta,
    skipped,
    hasPred,
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
