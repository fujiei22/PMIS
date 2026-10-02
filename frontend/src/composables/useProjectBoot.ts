import { API_ERROR_TEXT, apiErrorCode } from '@/constants/api'
import { setErrorSink } from '@/stores/_optimistic'
import { useProjectSync } from '@/stores/_sync'
import { useFilterStore } from '@/stores/filter'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

export interface ProjectBoot {
  /** 開始收這個專案的後端事件（`DashboardView` onMounted）。 */
  start: () => void
  /** 停止收事件（onBeforeUnmount）。 */
  stop: () => void
  /**
   * 載入這個專案的整包資料並維護 `ui.loadState` / `ui.loadError`；失敗不 throw。
   * 切頁時 router 已經先開始載同一個專案（`preloadProject`）的話，沿用那一發、不再打。
   */
  reload: () => Promise<void>
}

/**
 * 請求序號放在模組層（照 `usePortfolioBoot`）：每次進 Dashboard 都會重新呼叫 `useProjectBoot()`，
 * 放在函式裡的話，上一次掛載還在飛的請求看不到這一次的序號。
 * 失敗只有最後一發、而且畫面上還沒有資料時才切成錯誤，較舊的一發晚失敗不影響畫面。
 */
let reloadSeq = 0

/**
 * 切頁時 router 先開始的那一發（`preloadProject`）與它載的專案，等頁面掛載時的 `reload()` 取走。
 * 取走就清掉，所以同一次進頁只會打一次：之後的 `reload()`（按重試）才會再打。
 */
let preloaded: { id: string; promise: Promise<void> } | null = null

/**
 * store 裡（或正在載）的是哪個專案。背景重載只在**同一個專案**時才走：換了專案一律先清空資料層與
 * 畫面狀態、走「載入中」，畫面不會先秀上一個專案的資料，篩選與選取也不會沿用，
 * 也不會讓人在 B 的頁面上改到 A 的任務（安全審查 M2）。
 */
let loadedId: string | null = null

/**
 * 等頁面第一幀畫出來之後。rAF 在下一次繪製前執行，從裡面排的 setTimeout 落在那次繪製之後。
 *
 * 不用 `pageSwap.ts` 的 enter 通知：切頁 Transition 的 enter 跟頁面的 onMounted 在同一次 flush 裡、
 * 而且 enter 先跑，等到 onMounted 呼叫 reload 時它已經過了，等不到。
 * 單用 setTimeout 也不夠：瀏覽器不保證兩個 task 之間會先畫一幀。
 * 分頁在背景時 rAF 會暫停，背景重載就等到分頁回到前景——那時才需要新資料。
 */
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)))
}

/**
 * 換專案：清掉上一個專案的東西——資料層整個（`taskStore.reset()` 連 member / issue / comment / budget /
 * project 一起）、選取、篩選條件，與詳細視窗、浮層、錯誤條這類暫態（`ui.resetTransient()`）。
 * 排序、面板收合、縮放這些版面偏好留著（同離開 Dashboard 時的規則）。
 */
function clearProject(): void {
  useTaskStore().reset()
  useSelectionStore().clear()
  useFilterStore().clear()
  useUiStore().resetTransient()
}

/**
 * 載入整包資料並維護載入狀態；失敗不 throw。
 *
 * 重進 Dashboard 時畫面不能閃（G8，比照總覽的 `usePortfolioBoot`）：
 * - 還沒有資料（idle / loading / error）→ 顯示載入中，失敗顯示重試。
 * - 已經有資料（ready）→ 背景重載，全程維持 ready；資料到了就地更新（列以 id 為 key，元素不換）。
 *   背景失敗不蓋掉畫面，只記 console——舊資料仍然可用。
 * - 換了專案 → 先 `clearProject()` 再走載入中；等的時候又換到別的專案，這一發的結果（成功或失敗）都不算數。
 *
 * @param id 要載的專案（路由的 `:id`）；跟 store 裡的不是同一個就先清空、不走背景重載。
 * @param mounted 頁面已經掛上（掛載時的 reload）。背景重載要等新頁第一幀畫出來再打：
 *   mock 的資料在 microtask 就回來，會在掛載同一個 task 裡再把整頁重算一次，拉長切頁那一幀。
 *   router 先載時頁面還沒掛上，資料進 store 不會重算畫面，立刻打。
 */
async function load(id: string, mounted: boolean): Promise<void> {
  const ui = useUiStore()
  const taskStore = useTaskStore()
  // 懸空 id 清理 watch 要在資料進來前掛好（契約 E）；router 先載時頁面還沒呼叫 useProjectBoot
  useSelectionStore()
  const ticket = ++reloadSeq
  const sameProject = id === loadedId
  loadedId = id

  if (ui.loadState === 'ready' && sameProject) {
    if (mounted) await afterNextPaint()
    try {
      await taskStore.load(id)
    } catch (error) {
      console.error('[api]', '載入專案（背景）', error)
    }
    return
  }

  if (!sameProject) clearProject()
  ui.loadState = 'loading'
  ui.loadError = null
  try {
    await taskStore.load(id)
    // 等的時候換到別的專案了：task store 已經把這份資料丟掉，畫面狀態歸新專案那一發管
    if (id !== loadedId) return
    // 不等還在飛的後一發：它之後若失敗，這份資料照樣可用
    ui.loadState = 'ready'
    ui.loadError = null
  } catch (error) {
    console.error('[api]', '載入專案', error)
    // 換了專案、已經有更新的一發在處理，或較早的一發已經把資料帶回來，這一發的失敗就不影響畫面
    if (id !== loadedId || ticket !== reloadSeq || ui.loadState === 'ready') return
    ui.loadError = API_ERROR_TEXT[apiErrorCode(error)]
    ui.loadState = 'error'
  }
}

/**
 * 切頁進 Dashboard 時由 router 守衛呼叫（G16 / C13）：導航一開始就打，不等新頁掛上、也不阻塞導航。
 * out-in 過渡裡舊頁淡出的這段時間資料就在路上，新頁掛上時多半已經到了。
 * 狀態照 `reload()` 的規則走（還沒資料切 loading、已有資料背景重載）；頁面還沒掛上，看不到。
 * 每次導航都覆寫：上一次導航被打斷而沒被取走的那一發，不會留給下一次進頁。
 */
export function preloadProject(id: string): void {
  preloaded = { id, promise: load(id, false) }
}

/**
 * 啟動層：把資料層接上畫面（契約 E）。
 *
 * 資料 store 不認識派生層，所以這四件事都在這裡做：
 * 1. 注入 error sink——`runOptimistic` 失敗時把錯誤送進 `ui.errors`。
 * 2. `loadState` / `loadError`——`taskStore.load(id)` 只負責回 Promise。
 * 3. 先把 selection / ui 建起來，它們的懸空 id 清理 `watch` 要在資料進來前掛好。
 * 4. 換專案時清掉上一個專案的資料與畫面狀態（`clearProject`）。
 *
 * @param projectId 這一頁的專案（路由的 `:id`）。`App.vue` 的頁面 key 是 `route.path`，
 *   換專案時 Dashboard 會重新掛載，所以一次掛載只對應一個專案。
 *
 * `DashboardView` 是唯一的呼叫端（事件訂閱也只有這一處，review M6）。
 */
export function useProjectBoot(projectId: string): ProjectBoot {
  const ui = useUiStore()
  // 建立即掛上清理 watch（契約 E）
  useSelectionStore()
  setErrorSink((e) => ui.pushError(e))

  const sync = useProjectSync()

  function reload(): Promise<void> {
    // 掛載時沿用 router 先開始的那一發（進行中或已完成都一樣），不再多打
    const p = preloaded
    preloaded = null
    if (p && p.id === projectId) return p.promise
    // 沒有先載（直接呼叫、按重試）就自己載這一頁的專案
    return load(projectId, true)
  }

  return { start: () => sync.start(projectId), stop: sync.stop, reload }
}
