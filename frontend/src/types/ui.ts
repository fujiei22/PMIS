/**
 * 畫面層共用的型別（不屬於資料模型）。
 * 放在 types/ 而不是某個 store，Dashboard 與總覽兩邊的派生層都能引用，彼此不必互相依賴。
 */

/** api 載入的四個狀態（契約 C）。 */
export type LoadState = 'idle' | 'loading' | 'ready' | 'error'
