/** 鍵盤事件的共用判斷。 */

/**
 * 這個按鍵是不是輸入法（注音、倉頡…）選字中的按鍵。
 * 選字時按 Enter 是「確定這個字」，不是送出 / 結束編輯；這時 v-model 也還沒收到組好的字。
 * Safari 按 Enter 確定選字那一下 isComposing 已經是 false，只剩 keyCode 229 認得出來，所以兩個都要看。
 */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}
