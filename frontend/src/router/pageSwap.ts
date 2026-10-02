/**
 * 切頁過渡與捲動還原的協調。
 *
 * App.vue 的切頁過渡是 out-in：舊頁先淡出、新頁才掛上。vue-router 的 `scrollBehavior`
 * 在導頁一完成就呼叫，那時畫面上還是正在離開的舊頁，套用的捲動位置會被舊頁的高度夾掉，
 * 回到總覽時就不在原位（spec 7b）。所以捲動要等新頁掛上（Transition 的 enter）才套用。
 *
 * 新頁的 setup 也從這裡知道「自己是不是切頁進來的、會不會被還原到非 0 的捲動位置」：
 * Dashboard 從別頁切進來、又不還原捲動時，首屏外的面板延後到進場過渡跑完才掛（動畫稽核 K1，
 * 見 composables/useDeferredPanels.ts）；要還原捲動時新頁在 enter 當下就得是最終高度，不能延後。
 */

/** 等待中的那一次切頁；新頁掛上時呼叫它。 */
let pending: (() => void) | null = null
/** 等待中的那一次切頁會把捲動還原到非 0 的位置（上一頁 / 下一頁回到捲過的頁面）。 */
let restoring = false
/** 新頁進場過渡跑完時要通知的對象（參數是新頁的根元素）。 */
const settledListeners = new Set<(el: Element | null) => void>()

/**
 * 等到新頁掛上再 resolve。過渡被中斷或沒有觸發時，逾時也會 resolve，捲動不會卡住。
 * @param timeoutMs 保險逾時；正常情況新頁掛上（約 0.2 秒）就會 resolve，這個值只防過渡沒觸發。
 *   不能太短：機器忙時舊頁淡出會超過預期，太早逾時會把捲動套在舊頁上。
 * @param restore 這次會還原到非 0 的捲動位置（scrollBehavior 拿到的 savedPosition）。
 */
export function waitForPageSwap(timeoutMs = 2000, restore = false): Promise<void> {
  // 上一次還沒等到就又切頁：先放掉上一次（它的 restoring 跟著清掉），再記這一次的
  pending?.()
  restoring = restore
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs)
    function done(): void {
      clearTimeout(timer)
      if (pending === done) {
        pending = null
        restoring = false
      }
      resolve()
    }
    pending = done
  })
}

/** 現在有一次切頁在等新頁掛上；新頁的 setup 裡呼叫，回 true 就是「從別頁切進來」（不是直接開頁、重新整理）。 */
export function isPageSwapping(): boolean {
  return pending !== null
}

/** 這次切頁會把捲動還原到非 0 的位置：新頁掛上當下就要是最終高度。新頁的 setup 裡呼叫才有意義。 */
export function swapRestoresScroll(): boolean {
  return pending !== null && restoring
}

/** App.vue 的切頁 Transition 在新頁掛上時（enter）呼叫。 */
export function notifyPageEntered(): void {
  pending?.()
}

/** App.vue 的切頁 Transition 在新頁進場過渡跑完時（after-enter）呼叫，el 是新頁的根元素。 */
export function notifyPageSettled(el?: Element): void {
  for (const cb of [...settledListeners]) cb(el ?? null)
}

/**
 * 新頁進場過渡跑完時叫 cb（只叫下一次），參數是新頁的根元素；回傳取消函式。
 * 用途：把會產生長任務的工作（掛首屏外的面板）排在淡入之後，淡入才不會被吃掉。
 * 注意 Vue 的 after-enter 有保險計時器（過渡時長 +1ms，從加 class 那刻起算）：機器忙時 CSS 過渡晚一兩幀才起步，
 * 計時器先到、after-enter 提早觸發，淡入其實還在跑——要確定淡入跑完的呼叫端自己再看根元素的透明度。
 */
export function onPageSettled(cb: (el: Element | null) => void): () => void {
  const once = (el: Element | null): void => {
    settledListeners.delete(once)
    cb(el)
  }
  settledListeners.add(once)
  return () => settledListeners.delete(once)
}
