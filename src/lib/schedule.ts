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
      let floor = -Infinity
      for (const d of inc) {
        const src = by[d.from]
        if (src) floor = Math.max(floor, dayIndex(src.start))
      }
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

/** 會牽動排程的三個欄位；其餘欄位（名稱、優先度、負責人、分類…）就地 patch 就好。 */
const CASCADE_FIELDS = ['start', 'end', 'status'] as const

/**
 * 這個 patch 需不需要跑相依連動。spec 目標 7。
 *
 * 判斷看的是「patch 有沒有帶這個欄位」而不是「值有沒有變」：
 * patch 是 JSON merge patch（契約 A），呼叫端只會送真的要改的欄位。
 * 送了但值一樣的情況 `applyTaskPatch` 會在最後的 diff 收掉，不會產生假變動。
 */
export function needsCascade(patch: Partial<Task>): boolean {
  return CASCADE_FIELDS.some((k) => k in patch)
}

/**
 * 兩筆任務的欄位是否完全一樣（陣列逐項比）；用來判斷能不能沿用舊物件。
 * R2 的 `taskStore.collectDirtyTasks` 也用它比對「本地 vs 最後已知 server 狀態」。
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

/**
 * 套用任務欄位變更（必要時連動下游），回傳新陣列與真的變動了的那幾筆。legacy `setTask` :2294。
 *
 * 三件事依序發生：
 * 1. 狀態進 done 補完成日（原本有值就不覆蓋）、離開 done 清掉；
 * 2. start 不得早於任何前置的 start，超過就整段平移（保住工期）；
 * 3. 以自己 end 的位移量為種子跑 cascade 連動下游。
 * 2 與 3 只有 `needsCascade(patch)` 為真時才做——改個名字不該重算整張排程（spec 目標 7）。
 *
 * **identity**：沒有變動的任務回原本那個物件（`out[i] === tasks[i]`），
 * 元件的 computed 才能靠參照比對跳過重算；完全沒變動時連陣列都回原本那個。
 *
 * `changed` 是給乐觀更新用的：R2 的 `updateTasks(changed)` 只送真的變了的那幾筆。
 */
export function applyTaskPatch(
  tasks: Task[],
  deps: Dependency[],
  id: string,
  patch: Partial<Task>,
  today: ISODate,
): { tasks: Task[]; changed: Task[] } {
  const target = tasks.find((x) => x.id === id)
  if (!target) return { tasks, changed: [] }

  const next: Task = { ...target, ...patch }
  if (patch.status && patch.status !== target.status) {
    if (patch.status === 'done') {
      if (!next.done) next.done = today
    } else if (target.status === 'done') {
      next.done = ''
    }
  }

  if (!needsCascade(patch)) {
    if (sameTask(next, target)) return { tasks, changed: [] }
    return { tasks: tasks.map((x) => (x.id === id ? next : x)), changed: [next] }
  }

  // 自己的 start 不得早於任何前置的 start；超過就整段平移，保住工期
  let floor = -Infinity
  for (const d of deps) {
    if (d.to !== id) continue
    const src = tasks.find((x) => x.id === d.from)
    if (src) floor = Math.max(floor, dayIndex(src.start))
  }
  if (Number.isFinite(floor) && dayIndex(next.start) < floor) {
    const dur = dayIndex(next.end) - dayIndex(next.start)
    next.start = isoFromIndex(floor)
    next.end = isoFromIndex(floor + dur)
  }

  const seeded = tasks.map((x) => (x.id === id ? next : x))
  const after = cascade(seeded, deps, { [id]: dayIndex(next.end) - dayIndex(target.end) })

  // cascade 一律回全新物件；沒變的那幾筆換回原物件，並收集真的變動的
  const changed: Task[] = []
  const out = after.map((t, i) => {
    const orig = tasks[i]!
    if (sameTask(t, orig)) return orig
    changed.push(t)
    return t
  })
  return changed.length ? { tasks: out, changed } : { tasks, changed }
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
