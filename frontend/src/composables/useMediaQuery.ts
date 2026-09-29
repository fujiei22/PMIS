import { readonly, ref, type Ref } from 'vue'

/**
 * 同一個 media query 全站只掛一個監聽，所有元件共用同一個 ref（甘特每一列、每一條都會用到，不能各掛各的）。
 * 監聽不解除：query 只有少數幾個，頁面存活期間一直有人用。
 */
const cache = new Map<string, Ref<boolean>>()

/**
 * 回傳 media query 目前是否成立，視窗或裝置狀態改變時跟著變。
 * 沒有 `matchMedia` 的環境（jsdom）一律是 false。
 */
export function useMediaQuery(query: string): Readonly<Ref<boolean>> {
  let r = cache.get(query)
  if (!r) {
    const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null
    const state = ref(mql?.matches ?? false)
    mql?.addEventListener('change', (e) => {
      state.value = e.matches
    })
    cache.set(query, state)
    r = state
  }
  return readonly(r)
}

/**
 * 主要輸入是手指的裝置（平板、手機）：沒有 hover、指標是粗的。
 * 有觸控螢幕但接了滑鼠的筆電仍有 hover，照桌機行為走。
 */
export const TOUCH_UI_QUERY = '(hover: none) and (pointer: coarse)'

/** 甘特左欄與列內容改窄版的寬度門檻（平板直向）。和 CSS 的 `@media (max-width: 899px)` 同值。 */
export const NARROW_QUERY = '(max-width: 899px)'
