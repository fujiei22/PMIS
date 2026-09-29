/**
 * 切頁過渡與捲動還原的協調。
 *
 * App.vue 的切頁過渡是 out-in：舊頁先淡出、新頁才掛上。vue-router 的 `scrollBehavior`
 * 在導頁一完成就呼叫，那時畫面上還是正在離開的舊頁，套用的捲動位置會被舊頁的高度夾掉，
 * 回到總覽時就不在原位（spec 7b）。所以捲動要等新頁掛上（Transition 的 enter）才套用。
 */

/** 等待中的那一次切頁；新頁掛上時呼叫它。 */
let pending: (() => void) | null = null

/**
 * 等到新頁掛上再 resolve。過渡被中斷或沒有觸發時，逾時也會 resolve，捲動不會卡住。
 * @param timeoutMs 保險逾時；正常情況新頁掛上（約 0.2 秒）就會 resolve，這個值只防過渡沒觸發。
 *   不能太短：機器忙時舊頁淡出會超過預期，太早逾時會把捲動套在舊頁上。
 */
export function waitForPageSwap(timeoutMs = 2000): Promise<void> {
  pending?.()
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs)
    function done(): void {
      clearTimeout(timer)
      if (pending === done) pending = null
      resolve()
    }
    pending = done
  })
}

/** App.vue 的切頁 Transition 在新頁掛上時（enter）呼叫。 */
export function notifyPageEntered(): void {
  pending?.()
}
