import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

/**
 * 收合動畫用的延遲卸載：`open` 轉 false 之後再撐 `delayMs` 才真的把內容拿掉。
 * 對照 legacy 的 `hold(key)` / `held(key)`（:1741-1755）——面板、負責人選擇器、
 * Issue 展開區都靠它在關閉動畫跑完前保留 DOM。
 *
 * @param open 目前是否展開
 * @param delayMs 關閉動畫長度（ms）
 * @returns 內容該不該掛載
 */
export function useDelayedUnmount(open: MaybeRefOrGetter<boolean>, delayMs = 320): Ref<boolean> {
  const mounted = ref(toValue(open))
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(
    () => toValue(open),
    (v) => {
      clearTimeout(timer)
      if (v) {
        mounted.value = true
        return
      }
      timer = setTimeout(() => {
        mounted.value = false
      }, delayMs)
    },
  )

  onScopeDispose(() => clearTimeout(timer))

  return mounted
}
