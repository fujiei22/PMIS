/**
 * 樂觀更新的共用機制（契約 B）。
 *
 * 規則（review C1）：
 * - 每個實體記一份 **最後已知的 server 狀態** `server`，還原時放回它，
 *   而不是「送出前的本地快照」——多筆變更交錯時後者會還原成中途的值。
 * - 每個 id 記 in-flight 計數：還有請求在飛就不對齊本地，
 *   免得先回來的那筆把後送出的本地變更蓋掉。等該 id 的最後一筆請求結束才一次對齊
 *   （成功是套上 server 最終狀態，失敗就是還原）。
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
  /**
   * 本地已經改了、但還沒送出去的 id（review F2）。
   *
   * in-flight 計數只擋得住「送出中」的那一段；拖曳的每個 tick 與逐鍵改名的
   * debounce 期間根本還沒有請求，別的請求回應 / 別人推來的事件一 reconcile
   * 就會把這些還沒送出的本地值洗掉。標成 dirty 的 id 只更新 `server`，不動本地；
   * 對應的 commit 送出時清掉。
   */
  dirty: Set<string>
}

export function createTracker<T extends { id: string }>(): Tracker<T> {
  return { server: new Map(), inflight: new Map(), dirty: new Set() }
}

/** 失敗提示的出口（實作是 `ui.pushError`）。 */
export type ErrorSink = (e: { label: string; error: unknown }) => void

/**
 * 沒註冊 sink 時的退路：至少留下 console，不讓錯誤消失。
 * `ui.pushError` 自己也會 console.error，所以這裡只在沒人接手時才印。
 */
function fallbackSink(e: { label: string; error: unknown }): void {
  console.error('[api]', e.label, e.error)
}

let errorSink: ErrorSink = fallbackSink

/**
 * 註冊「api 失敗要送去哪」。
 *
 * 資料層不認識 ui（契約 E），所以錯誤不是 import 進來的，是注入的：
 * 啟動時 `useProjectBoot()` 把 `ui.pushError` 掛上來。傳 null 還原成只印 console
 * （測試收尾用）。
 */
export function setErrorSink(fn: ErrorSink | null): void {
  errorSink = fn ?? fallbackSink
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

/**
 * 用一份 server 清單重建 tracker（load / project.reloaded）。
 *
 * review F12：只換 `server`。`inflight` 與 `dirty` 是**這個 client 自己**的狀態
 * ——重載改變的是「server 現在長怎樣」，不是「我這邊還有幾筆在飛、有什麼還沒送出」。
 * 清掉它們會讓重載當下在飛的請求回來時錯誤地 reconcile，也會抹掉還在打字的草稿。
 */
export function resetTracker<T extends { id: string }>(tracker: Tracker<T>, list: T[]): void {
  tracker.server.clear()
  for (const item of list) tracker.server.set(item.id, cloneEntity(item))
}

/**
 * server 的顯示順序中，這個 id 應該插回本地陣列的哪個位置。
 *
 * 往前找第一個「server 順序在它前面、而且本地還在」的實體，插在它後面；
 * 都找不到就是第一筆。刪除失敗的還原（review F1）與事件補進新實體都走這條。
 */
export function insertIndexOf(order: string[], list: { id: string }[], id: string): number {
  const at = order.indexOf(id)
  for (let k = at - 1; k >= 0; k--) {
    const j = list.findIndex((x) => x.id === order[k])
    if (j >= 0) return j + 1
  }
  return 0
}

/** 標記「本地改了還沒送出」（review F2）。 */
export function markDirty<T extends { id: string }>(
  tracker: Tracker<T>,
  ids: Iterable<string>,
): void {
  for (const id of ids) tracker.dirty.add(id)
}

/** 這些 id 的本地變更已經送出（或放棄了），不再需要保護。 */
export function clearDirty<T extends { id: string }>(
  tracker: Tracker<T>,
  ids: Iterable<string>,
): void {
  for (const id of ids) tracker.dirty.delete(id)
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
 * 現在不可以把本地對齊到 server：還有請求在飛（等最後一筆），
 * 或本地有還沒送出的變更（review F2）。
 */
function holdsLocal<T extends { id: string }>(tracker: Tracker<T>, id: string): boolean {
  return isInflight(tracker, id) || tracker.dirty.has(id)
}

/**
 * 事件（或任何 server 主動推來的值）進來時的處理。
 * 先寫 `server`；該 id 還有請求在飛、或本地有沒送出的變更，就只寫不動本地（契約 B、review F2）。
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
  if (holdsLocal(tracker, id)) return
  reconcile(tracker.server.get(id), id)
}

export interface OptimisticOp<T extends { id: string }> {
  tracker: Tracker<T>
  /** 這次操作牽動的實體 id（in-flight 與還原都以它為單位）。 */
  ids: string[]
  /** 錯誤條上的主文，例如「更新任務」。 */
  label: string
  /** 打 api；response 若帶實體就寫回 `server`。 */
  call: () => Promise<T | T[] | void>
  /** 把本地對齊 server（undefined = 已刪除）。 */
  reconcile: (server: T | undefined, id: string) => void
}

/**
 * 跑一次樂觀更新：打 api，失敗就把牽動到的 id 放回 server 狀態。
 *
 * review F9：本地的變更一律由呼叫端在呼叫前自己做完（每個 store action 本來就是
 * 這樣寫的），所以沒有 `apply` 這個鉤子——留著只會讓人以為有第二條路。
 * 回傳的 promise 永遠 resolve（錯誤已經送進 error sink 與 console）。
 */
export async function runOptimistic<T extends { id: string }>(op: OptimisticOp<T>): Promise<void> {
  const { tracker, ids, label, call, reconcile } = op
  for (const id of ids) bump(tracker, id, 1)

  try {
    const res = await call()
    for (const item of Array.isArray(res) ? res : res ? [res] : []) {
      tracker.server.set(item.id, cloneEntity(item))
    }
  } catch (error) {
    errorSink({ label, error })
  } finally {
    for (const id of ids) {
      bump(tracker, id, -1)
      // 最後一筆結束了才對齊：成功就是套上 server 的最終狀態，失敗就是還原。
      // review F2：本地又改了還沒送出（拖曳中 / 改名 debounce 中）就只留 server，不動本地。
      if (holdsLocal(tracker, id)) continue
      reconcile(tracker.server.get(id), id)
    }
  }
}
