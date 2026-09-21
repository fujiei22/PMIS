import { inject, provide, type ComponentPublicInstance, type InjectionKey } from 'vue'

/**
 * DOM 登錄表（契約 F）：需要量測或命中判定的元素由元件自己登錄進來，
 * 不再用 DOM 選擇器靠 `data-*` 反查。
 *
 * 為什麼：`data-taskid` 這類屬性原本只是測試 / CSS 的鉤子，卻變成執行期依賴——
 * 改個屬性名就會靜默壞掉，元件也不能重複使用（spec §目標 9、review M10）。
 * 登錄表只存元素，**不存任何狀態**；讀的人（`usePointerDrag`、面板跳轉、
 * 捲動對位）自己決定要拿來做什麼。
 */
export interface DomRegistry {
  /** 甘特左欄的任務列（`data-rowtask`）。 */
  rows: Map<string, HTMLElement>
  /** 甘特左欄的分類列（`data-rowgroup`）。 */
  groups: Map<string, HTMLElement>
  /** 甘特條本體（`data-taskid`；摘要條的 key 是 `sum-<gid>`）。 */
  bars: Map<string, HTMLElement>
  /** 條左右兩側的連線圓點熱區（`data-linkfor`）。 */
  linkDots: Map<string, { L: HTMLElement; R: HTMLElement }>
  /** 看板卡片（`data-card`）。 */
  cards: Map<string, HTMLElement>
  /** 看板欄位的內容區（`data-col`），key 是任務狀態。 */
  cols: Map<string, HTMLElement>
  /** Issue 卡（`data-issuerow`）。 */
  issueRows: Map<string, HTMLElement>
  /** 三個面板的外殼（`data-panel`），頂部列的捷徑要捲到它。 */
  panels: Map<'gantt' | 'kanban' | 'issues', HTMLElement>
}

/**
 * Vue 的函式式 `ref` 會收到元素或元件實例（`VNodeRef` 的參數型別）。
 * 契約 F 寫的是 `(el: Element | null)`，這裡放寬成 Vue 實際會傳的聯集，
 * 不然 template 上的 `:ref` 型別對不起來；實作只認 `HTMLElement`。
 */
export type ElRef = Element | ComponentPublicInstance | null

const KEY: InjectionKey<DomRegistry> = Symbol('dom-registry')

function createRegistry(): DomRegistry {
  return {
    rows: new Map(),
    groups: new Map(),
    bars: new Map(),
    linkDots: new Map(),
    cards: new Map(),
    cols: new Map(),
    issueRows: new Map(),
    panels: new Map(),
  }
}

/** 在最上層（DashboardView）建立並提供登錄表。 */
export function provideDomRegistry(): DomRegistry {
  const registry = createRegistry()
  provide(KEY, registry)
  return registry
}

/**
 * 取用登錄表。沒有 provider 時回一份獨立的空表——
 * 單獨掛一顆元件做單元測試時不必先搭一層 provider（review M10）。
 */
export function useDomRegistry(): DomRegistry {
  return inject(KEY, createRegistry, true)
}

/** 每張表各自的 ref callback 快取，依 id memo。 */
const memo = new WeakMap<Map<string, HTMLElement>, Map<string, (el: ElRef) => void>>()

/**
 * 產生登錄用的函式式 `ref`。
 *
 * 同一張表、同一個 id 一定回同一顆函式（DX 12）：template 每次重繪都呼叫這裡，
 * 函式換身分的話 Vue 會先用舊的解除登錄再用新的登錄，白白抖一次。
 *
 * @param map 要寫進去的那張表
 * @param id 元素的識別（任務 / 分類 / 欄位 id）
 */
export function registerEl(map: Map<string, HTMLElement>, id: string): (el: ElRef) => void {
  let byId = memo.get(map)
  if (!byId) {
    byId = new Map()
    memo.set(map, byId)
  }
  const cached = byId.get(id)
  if (cached) return cached

  const fn = (el: ElRef): void => {
    if (el instanceof HTMLElement) {
      map.set(id, el)
      return
    }
    // 解除登錄要等這一輪 patch 做完再看：同一個 id 的元素被重新掛載時
    // （例如看板卡片從 done 拖回 todo），新的 set 會早於舊的 null 進來，
    // 當下就刪會把還活著的那顆刪掉。patch 完只有真的離開文件的才刪。
    queueMicrotask(() => {
      const cur = map.get(id)
      if (cur && !cur.isConnected) map.delete(id)
    })
  }
  byId.set(id, fn)
  return fn
}
