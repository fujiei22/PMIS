import { useUiStore } from '@/stores/ui'

/**
 * 乐觀更新的共用機制（契約 B）。
 *
 * 規則（review C1）：
 * - 每個實體記一份 **最後已知的 server 狀態** `server`，還原時放回它，
 *   而不是「送出前的本地快照」——多筆變更交錯時後者會還原成中途的值。
 * - 每個 id 記 in-flight 計數：還有請求在飛就不對齊本地，
 *   免得先回來的那筆把後送出的本地變更蓋掉。
 * - 失敗只先標記 `failed`；等該 id 的最後一筆請求結束才一次還原。
 * - `runOptimistic` **永不 throw**：呼叫端（store action）不必 try/catch。
 *
 * `server` 是 Map，插入順序就是 server 的顯示順序——
 * 整份順序的還原（拖曳重排取消 / 失敗）靠它重建（`taskStore.reconcileTasksFromServer`）。
 */
export interface Tracker<T extends { id: string }> {
  /** id → 最後已知的 server 狀態；順序 = server 的顯示順序。 */
  server: Map<string, T>
  /** id → 還有幾個請求在飛。 */
  inflight: Map<string, number>
  /** 這一輪已經失敗、等 in-flight 歸零再還原的 id。 */
  failed: Set<string>
}

export function createTracker<T extends { id: string }>(): Tracker<T> {
  return { server: new Map(), inflight: new Map(), failed: new Set() }
}

/**
 * 實體的深拷貝。
 *
 * 不用 `structuredClone`：store 裡的實體是 Vue 的 reactive proxy，
 * `structuredClone` 碰到 proxy 會丟 DataCloneError。實體本身就是 wire 上的 JSON
 * （契約 A：字串 / 數字 / 字串陣列），走 JSON 一趟同時也把 proxy 拆掉。
 */
export function cloneEntity<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 用一份 server 清單重建 tracker（load / project.reloaded）。 */
export function resetTracker<T extends { id: string }>(tracker: Tracker<T>, list: T[]): void {
  tracker.server.clear()
  tracker.inflight.clear()
  tracker.failed.clear()
  for (const item of list) tracker.server.set(item.id, cloneEntity(item))
}

function bump<T extends { id: string }>(tracker: Tracker<T>, id: string, by: 1 | -1): void {
  const next = (tracker.inflight.get(id) ?? 0) + by
  if (next > 0) tracker.inflight.set(id, next)
  else tracker.inflight.delete(id)
}

/** 這個 id 還有請求在飛嗎。 */
export function isInflight<T extends { id: string }>(tracker: Tracker<T>, id: string): boolean {
  return (tracker.inflight.get(id) ?? 0) > 0
}

/**
 * 事件（或任何 server 主動推來的值）進來時的處理。
 * 先寫 `server`；該 id 還有請求在飛就只寫不動本地，歸零時才對齊（契約 B）。
 * `value` 是 undefined 代表那筆已經被刪掉。
 */
export function applyServerValue<T extends { id: string }>(
  tracker: Tracker<T>,
  id: string,
  value: T | undefined,
  reconcile: (server: T | undefined, id: string) => void,
): void {
  if (value === undefined) tracker.server.delete(id)
  else tracker.server.set(id, cloneEntity(value))
  if (isInflight(tracker, id)) return
  reconcile(tracker.server.get(id), id)
}

export interface OptimisticOp<T extends { id: string }> {
  tracker: Tracker<T>
  /** 這次操作牽動的實體 id（in-flight 與還原都以它為單位）。 */
  ids: string[]
  /** 錯誤條上的主文，例如「更新任務」。 */
  label: string
  /** 立即改本地；呼叫端已經改完的話可以是 no-op。 */
  apply: () => void
  /** 打 api；response 若帶實體就寫回 `server`。 */
  call: () => Promise<T | T[] | void>
  /** 把本地對齊 server（undefined = 已刪除）。 */
  reconcile: (server: T | undefined, id: string) => void
}

/**
 * 跑一次乐觀更新：先改本地，再打 api，失敗就把牽動到的 id 放回 server 狀態。
 * 回傳的 promise 永遠 resolve（錯誤已經進 `ui.errors` 與 console）。
 */
export async function runOptimistic<T extends { id: string }>(op: OptimisticOp<T>): Promise<void> {
  const { tracker, ids, label, apply, call, reconcile } = op
  apply()
  for (const id of ids) bump(tracker, id, 1)

  try {
    const res = await call()
    for (const item of Array.isArray(res) ? res : res ? [res] : []) {
      tracker.server.set(item.id, cloneEntity(item))
    }
  } catch (error) {
    for (const id of ids) tracker.failed.add(id)
    useUiStore().pushError({ label, error })
  } finally {
    for (const id of ids) {
      bump(tracker, id, -1)
      if (isInflight(tracker, id)) continue
      // 最後一筆結束了才對齊：成功就是套上 server 的最終狀態，失敗就是還原
      reconcile(tracker.server.get(id), id)
      tracker.failed.delete(id)
    }
  }
}
