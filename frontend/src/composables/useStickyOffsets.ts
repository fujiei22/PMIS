import { computed, inject, onBeforeUnmount, provide, ref, type ComputedRef, type InjectionKey } from 'vue'

/** 會被量高度的元素 key：頂部列 + 三個面板頭。 */
export type StickyKey = 'top' | 'gantt' | 'kanban' | 'issues'

/**
 * legacy 在量不到時用的預設值（:3634-3637 `S.topH || 56`、`S.hdrG || 47`）。
 * 第一幀還沒 ResizeObserver 回呼時用它，避免標題跳一下。
 */
const FALLBACK: Record<StickyKey, number> = { top: 56, gantt: 47, kanban: 47, issues: 47 }

export interface StickyOffsets {
  /** 把元素交給 ResizeObserver 追蹤；傳 null 代表卸載。 */
  observe: (key: StickyKey, el: Element | null) => void
  /** 面板頭要黏的位置 = 頂部列高。 */
  panelTop: ComputedRef<number>
  /** 面板內第二層 sticky（甘特尺規、看板欄位頭）要黏的位置 = 頂部列 + 該面板頭。 */
  innerTop: (key: Exclude<StickyKey, 'top'>) => number
}

const STICKY_KEY: InjectionKey<StickyOffsets> = Symbol('sticky-offsets')

/**
 * 量頂部列與三個面板頭的高度，算出兩層 sticky 的 top。
 * legacy 是 componentDidMount 裡的 `measure()` + ResizeObserver（:1940-1969）。
 * 在 DashboardView 呼叫一次，子元件用 `useStickyOffsetsContext()` 取用。
 */
export function useStickyOffsets(): StickyOffsets {
  const heights = ref<Record<StickyKey, number>>({ ...FALLBACK })
  const tracked = new Map<StickyKey, Element>()

  const ro =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) {
            for (const [key, el] of tracked) {
              if (el !== entry.target) continue
              const h = Math.round(entry.target.getBoundingClientRect().height)
              if (h && h !== heights.value[key]) heights.value = { ...heights.value, [key]: h }
            }
          }
        })

  function observe(key: StickyKey, el: Element | null): void {
    const prev = tracked.get(key)
    if (prev && prev !== el) ro?.unobserve(prev)
    if (!el) {
      tracked.delete(key)
      return
    }
    tracked.set(key, el)
    ro?.observe(el)
    const h = Math.round(el.getBoundingClientRect().height)
    if (h && h !== heights.value[key]) heights.value = { ...heights.value, [key]: h }
  }

  onBeforeUnmount(() => ro?.disconnect())

  const panelTop = computed(() => heights.value.top)
  const innerTop = (key: Exclude<StickyKey, 'top'>): number => heights.value.top + heights.value[key]

  const api: StickyOffsets = { observe, panelTop, innerTop }
  provide(STICKY_KEY, api)
  return api
}

/** 子元件取用 DashboardView 提供的 sticky 量測結果；不在 Dashboard 下時退回預設值。 */
export function useStickyOffsetsContext(): StickyOffsets {
  return (
    inject(STICKY_KEY, null) ?? {
      observe: () => {},
      panelTop: computed(() => FALLBACK.top),
      innerTop: (key) => FALLBACK.top + FALLBACK[key],
    }
  )
}
