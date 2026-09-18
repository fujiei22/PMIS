import { dayIndex, isoFromIndex } from '@/lib/date'
import type { Dependency, ISODate, Issue, Task } from '@/types/models'

/**
 * 排程運算：相依連動（cascade）、循環偵測、延遲判定、專案時間範圍。
 * 全部是純函式，不碰 store；legacy 對照行號標在各函式上。
 */

/**
 * 依相依把下游任務往後推，回傳新陣列（不改入參，legacy 是就地改）。legacy `cascade` :2320。
 *
 * shifts 記「這一輪誰已經被移動了幾天」：
 * 上游有位移且自己還沒被算過 → 跟著平移同樣天數（維持原本的間隔）；
 * 算完再夾一次下限，start 不得早於任何前置的 start。
 * 迴圈上限 80 是 legacy 的防呆——相依鏈再長也會收斂，循環相依則由 addDep 事前擋掉。
 */
export function cascade(
  tasks: Task[],
  deps: Dependency[],
  shifts?: Record<string, number>,
): Task[] {
  const list = tasks.map((t) => ({ ...t }))
  const by: Record<string, Task> = {}
  for (const t of list) by[t.id] = t
  const sh: Record<string, number> = { ...(shifts ?? {}) }

  for (let i = 0; i < 80; i++) {
    let changed = false
    for (const t of list) {
      const inc = deps.filter((d) => d.to === t.id && by[d.from])
      if (!inc.length) continue
      const cur = dayIndex(t.start)

      // 上游這輪最大的位移量；沒有任何上游動過就是 null
      let mx: number | null = null
      for (const d of inc) {
        const v = sh[d.from]
        if (v === undefined) continue
        mx = mx === null ? v : Math.max(mx, v)
      }

      let target = cur
      if (mx !== null && sh[t.id] === undefined) target = cur + mx
      const floor = Math.max(...inc.map((d) => dayIndex(by[d.from].start)))
      if (target < floor) target = floor

      if (target !== cur) {
        const dur = dayIndex(t.end) - cur
        t.start = isoFromIndex(target)
        t.end = isoFromIndex(target + dur)
        sh[t.id] = (sh[t.id] ?? 0) + (target - cur)
        changed = true
      } else if (sh[t.id] === undefined && mx !== null) {
        // 自己沒動，但要記成「已算過」，下一輪才不會被上游重複推
        sh[t.id] = 0
      }
    }
    if (!changed) break
  }
  return list
}

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
 * 套用任務欄位變更並跑 cascade，回傳新的任務陣列。legacy `setTask` :2294。
 *
 * 三件事依序發生：
 * 1. 狀態進 done 補完成日（原本有值就不覆蓋）、離開 done 清掉；
 * 2. start 不得早於任何前置的 start，超過就整段平移（保住工期）；
 * 3. 以自己 end 的位移量為種子跑 cascade 連動下游。
 */
export function applyTaskPatch(
  tasks: Task[],
  deps: Dependency[],
  id: string,
  patch: Partial<Task>,
  today: ISODate,
): Task[] {
  const list = tasks.map((t) => ({ ...t }))
  const by: Record<string, Task> = {}
  for (const t of list) by[t.id] = t
  const t = by[id]
  if (!t) return tasks

  const oldEnd = dayIndex(t.end)
  const oldStatus = t.status
  Object.assign(t, patch)

  if (patch.status && patch.status !== oldStatus) {
    if (patch.status === 'done') {
      if (!t.done) t.done = today
    } else if (oldStatus === 'done') {
      t.done = ''
    }
  }

  let floor = -Infinity
  for (const d of deps) {
    if (d.to === id && by[d.from]) floor = Math.max(floor, dayIndex(by[d.from].start))
  }
  if (Number.isFinite(floor) && dayIndex(t.start) < floor) {
    const dur = dayIndex(t.end) - dayIndex(t.start)
    t.start = isoFromIndex(floor)
    t.end = isoFromIndex(floor + dur)
  }

  return cascade(list, deps, { [id]: dayIndex(t.end) - oldEnd })
}

/** 任務是否已延遲：還沒完成而且 end 已經過去。legacy `isLate` :2277 */
export function isLate(t: Task, todayIdx: number): boolean {
  return !!t && t.status !== 'done' && !!t.end && dayIndex(t.end) < todayIdx
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
