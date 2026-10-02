import { onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

/** 從 computed style 的 `grid-template-columns`（已解析成 px 清單）數欄數；讀不到時當 1 欄。 */
export function countGridColumns(template: string): number {
  const n = template
    .trim()
    .split(/\s+/)
    .filter((x) => x && x !== 'none').length
  return Math.max(1, n)
}

/**
 * 量 grid 容器目前實際排成幾欄（`repeat(auto-fill, …)` 的欄數隨寬度變），寬度變動時重算。
 * 總覽卡片泳道用它算「這張卡在第幾列」，速覽抽屜才插得到該列正下方。
 *
 * @param container grid 容器；會重建的元素（TransitionGroup 根）傳 getter
 */
export function useGridColumns(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
): Ref<number> {
  const cols = ref(1)
  let ro: ResizeObserver | undefined

  function measure(el: HTMLElement): void {
    cols.value = countGridColumns(getComputedStyle(el).gridTemplateColumns)
  }

  watch(
    () => toValue(container),
    (el) => {
      ro?.disconnect()
      ro = undefined
      if (!el) return
      measure(el)
      if (typeof ResizeObserver === 'undefined') return
      ro = new ResizeObserver(() => measure(el))
      ro.observe(el)
    },
    { immediate: true, flush: 'post' },
  )

  onBeforeUnmount(() => ro?.disconnect())

  return cols
}
