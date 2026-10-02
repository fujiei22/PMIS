import { inject, nextTick, onBeforeUnmount, provide, ref, type InjectionKey, type Ref } from 'vue'
import { onPageSettled } from '@/router/pageSwap'

/**
 * 首屏外的面板延後掛載（動畫稽核 K1）。
 *
 * 從總覽切進 Dashboard 時，App.vue 的 out-in 等總覽淡出完才一次掛上整頁（約 2,975 個元素），
 * 中間是一段空白，掛載之後的長幀還會吃掉淡入。看板與 Issue 面板在 1920×1080 的首屏之外、佔整頁約一半，
 * 從總覽切進來又不還原捲動時先不掛：首屏（頂欄、摘要、甘特）先畫出來淡入，淡入跑完、瀏覽器空閒時再一個一個掛上。
 *
 * 什麼時候立刻掛（不等空閒）：
 * - 使用者先動手（滾輪、按下、按鍵、觸控）：要捲下去看或點東西，內容要在；按下時就掛，點擊（選取任務的聚焦捲動）發生在掛上之後。
 * - 頂欄的面板捷徑：呼叫 `ensure()`，等 DOM 更新完再量位置。
 * - 首屏看得到的（高螢幕、甘特收合）：DashboardView 掛載當下量，同一個 task 裡就掛，第一幀就完整。
 * 什麼時候完全不延後：直接開頁 / 重新整理（沒有切頁淡入要保護）、上一頁 / 下一頁要還原到非 0 的捲動位置
 * （spec 7b：新頁掛上當下就要是最終高度）——由 DashboardView 判斷後傳 `defer`。
 */
export interface DeferredPanels {
  /** 看板面板可以掛了。 */
  kanban: Ref<boolean>
  /** Issue 面板可以掛了（排在看板後面）。 */
  issues: Ref<boolean>
  /** 立刻掛上全部延後的面板；DOM 更新完才 resolve（要量面板位置的呼叫端 await 它）。 */
  ensure: () => Promise<void>
}

const KEY: InjectionKey<DeferredPanels> = Symbol('deferredPanels')

/** 沒有 provide 時（單元測試直接掛 TopBar 這類元件）：全部視為已掛。 */
const NONE: DeferredPanels = { kanban: ref(true), issues: ref(true), ensure: () => Promise.resolve() }

/** 進場過渡沒通知時（被打斷、沒有觸發）的保險：掛上後最晚這麼久開始排。 */
const SETTLE_FALLBACK_MS = 1500
/** 等根元素全亮最多等多久（淡入本身 0.18 秒，機器很忙才會超過）。 */
const OPAQUE_WAIT_MS = 1000
/** requestIdleCallback 的期限：一直不空閒也不要等太久。 */
const IDLE_TIMEOUT_MS = 300

/**
 * 使用者動手的事件；任何一個發生就立刻掛（捕獲階段）。不聽 scroll：切頁時 router 會在新頁掛上當下捲回頂端，
 * 那個 scroll 不是使用者動手，聽了會在淡入期間就把面板掛上。鍵盤捲動有 keydown、觸控板與滾輪有 wheel、觸控有 touchstart。
 */
const USER_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

/**
 * 等 el 真的全亮（切頁淡入的 transition 跑完）才跑 cb；el 是 null 或已經不在 DOM 時直接跑，最多等 OPAQUE_WAIT_MS。
 * after-enter 可能靠 Vue 的保險計時器提早觸發（見 router/pageSwap.ts 的 onPageSettled），這時淡入還在跑，
 * 馬上掛面板的長任務會把剩下的淡入吃掉。回傳取消函式。
 */
function whenOpaque(el: Element | null, cb: () => void): () => void {
  let raf = 0
  const t0 = performance.now()
  const tick = (): void => {
    const done = !el || !el.isConnected || parseFloat(getComputedStyle(el).opacity) >= 1
    if (done || performance.now() - t0 > OPAQUE_WAIT_MS) cb()
    else raf = requestAnimationFrame(tick)
  }
  tick()
  return () => cancelAnimationFrame(raf)
}

/** 瀏覽器空閒時跑 cb；沒有 requestIdleCallback（Safari）退回 setTimeout。回傳取消函式。 */
function whenIdle(cb: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(cb, 0)
  return () => clearTimeout(id)
}

/**
 * DashboardView 呼叫：建立延後面板的狀態並 provide 給子元件（頂欄的捷徑用 `ensure()`）。
 * @param defer true＝看板與 Issue 先不掛，等進場過渡跑完＋空閒（或使用者先動手）才掛。
 */
export function provideDeferredPanels(defer: boolean): DeferredPanels {
  const kanban = ref(!defer)
  const issues = ref(!defer)
  const cancels: (() => void)[] = []

  function cleanup(): void {
    for (const c of cancels.splice(0)) c()
  }

  function ensure(): Promise<void> {
    cleanup()
    kanban.value = true
    issues.value = true
    return nextTick()
  }

  if (defer) {
    let scheduled = false
    /**
     * 淡入真的跑完之後，一個面板一個空閒時段：看板先（約 1,171 個元素），Issue 下一個空閒再掛，長任務分兩段。
     * el：新頁的根元素（after-enter 給的；保險計時器觸發時沒有）。
     */
    const schedule = (el: Element | null): void => {
      if (scheduled) return
      scheduled = true
      cancels.push(
        whenOpaque(el, () =>
          cancels.push(
            whenIdle(() => {
              kanban.value = true
              cancels.push(
                whenIdle(() => {
                  issues.value = true
                  cleanup()
                }),
              )
            }),
          ),
        ),
      )
    }
    cancels.push(onPageSettled(schedule))
    const fallback = setTimeout(() => schedule(null), SETTLE_FALLBACK_MS)
    cancels.push(() => clearTimeout(fallback))
    const onUser = (): void => void ensure()
    for (const t of USER_EVENTS) window.addEventListener(t, onUser, { capture: true, passive: true })
    cancels.push(() => {
      for (const t of USER_EVENTS) window.removeEventListener(t, onUser, { capture: true })
    })
    onBeforeUnmount(cleanup)
  }

  const api: DeferredPanels = { kanban, issues, ensure }
  provide(KEY, api)
  return api
}

/** 子元件取用（沒有 provide 時全部視為已掛）。 */
export function useDeferredPanels(): DeferredPanels {
  return inject(KEY, NONE)
}
