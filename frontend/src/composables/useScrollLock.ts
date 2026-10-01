import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'

/** 目前要求鎖住的使用者數：多個全頁浮層共用一把鎖，全部放開才解。 */
let holders = 0
/** 鎖之前 body 自己的 inline 值，解鎖時原樣放回。 */
let saved = { overflow: '', paddingRight: '' }

function acquire(): void {
  if (holders++ > 0) return
  // 平滑捲動（頂欄捷徑、scrollIntoView smooth）在 overflow: hidden 之下仍會跑完，
  // 開啟當下先停住，背景才會停在使用者看到的位置（G13）
  window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: 'instant' })
  const body = document.body.style
  saved = { overflow: body.overflow, paddingRight: body.paddingRight }
  // 根捲軸消失會讓版面變寬、背景整片右移（Windows 實體捲軸 15px）：補一條同寬的空白（G1）
  const w = window.innerWidth - document.documentElement.clientWidth
  body.overflow = 'hidden'
  if (w > 0) body.paddingRight = `${w}px`
}

function release(): void {
  if (holders === 0 || --holders > 0) return
  const body = document.body.style
  body.overflow = saved.overflow
  body.paddingRight = saved.paddingRight
}

/**
 * locked 為 true 期間鎖住頁面捲動；元件卸載（例：詳情開著時離開 Dashboard）一併放開。
 *
 * 解鎖時不捲回鎖之前的位置：鎖定期間根捲動位置不會動；而平滑捲動被停下的位置要到下一個合成器幀
 * 才讀得到，當下記的值可能落後 27–269px，捲回去反而會跳（plan review Eng C6）。
 * 補寬只補 body：呼叫端要讓鎖撐到自己的離場動畫結束，fixed 置中的浮層才不會在淡出途中隨捲軸冒回來而橫移。
 */
export function useScrollLock(locked: MaybeRefOrGetter<boolean>): void {
  let held = false
  const set = (v: boolean): void => {
    if (v === held) return
    held = v
    if (v) acquire()
    else release()
  }
  watch(() => toValue(locked), set, { immediate: true })
  onScopeDispose(() => set(false))
}
