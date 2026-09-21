import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { dayFraction } from '@/lib/date'
import { useClockStore } from '@/stores/clock'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 縮放滑桿放手後多久恢復甘特條的位移補間。legacy `_zoomT`（:3586） */
const ZOOM_SETTLE_MS = 160
/** 掛載後多久自動捲到今天；legacy 是 `setTimeout(() => this.jumpToday(), 60)`（:1926）。 */
const INITIAL_JUMP_MS = 60

export interface GanttScroll {
  /** chart 目前的水平捲動位置；Issue 徽章要靠它夾在可視範圍內。legacy `S.scrollX`（:2933） */
  scrollX: Ref<number>
  /** chart 可視寬度。legacy `S.viewW` */
  viewW: Ref<number>
  /** chart 捲動時呼叫：同步尺規並更新 scrollX。 */
  onScroll: () => void
  /** 捲到某個水平位置；animated 時用 ease-out quart 補間（legacy :2641-2665）。 */
  scrollTo: (x: number, animated?: boolean) => void
  /** 捲到今天，並讓今天大致落在畫面中央。legacy `jumpToday`（:2641） */
  jumpToday: (animated?: boolean) => void
  /** 縮放滑桿的 input handler：改 dayWidth 並在 160ms 內關掉條的補間。legacy `onDayW`（:3582） */
  onZoom: (value: number | string) => void
}

/**
 * 甘特圖的水平捲動：尺規與 chart 同步、量可視範圍、今天按鈕、縮放滑桿。
 *
 * @param scroller chart 外層可水平捲動的容器
 * @param ruler 上方日期尺規的 overflow:hidden 容器
 */
export function useGanttScroll(
  scroller: Ref<HTMLElement | null>,
  ruler: Ref<HTMLElement | null>,
): GanttScroll {
  const clock = useClockStore()
  const ui = useUiStore()
  const taskStore = useTaskStore()

  const scrollX = ref(0)
  const viewW = ref(0)

  let raf: number | undefined
  let zoomTimer: ReturnType<typeof setTimeout> | undefined
  let initialTimer: ReturnType<typeof setTimeout> | undefined
  let ro: ResizeObserver | undefined

  function syncRuler(): void {
    const sc = scroller.value
    if (!sc) return
    scrollX.value = sc.scrollLeft
    if (ruler.value) ruler.value.scrollLeft = sc.scrollLeft
  }

  function measure(): void {
    const sc = scroller.value
    if (!sc) return
    viewW.value = sc.clientWidth
    scrollX.value = sc.scrollLeft
  }

  function scrollTo(x: number, animated = false): void {
    const sc = scroller.value
    if (!sc) return
    const max = Math.max(0, sc.scrollWidth - sc.clientWidth)
    const to = Math.max(0, Math.min(max, x))
    if (raf !== undefined) cancelAnimationFrame(raf)
    const from = sc.scrollLeft
    if (!animated || Math.abs(to - from) < 1.5) {
      sc.scrollLeft = to
      syncRuler()
      return
    }
    // 距離越遠動畫越長，夾在 460-1150ms（legacy :2653）
    const dur = Math.max(460, Math.min(1150, 340 + Math.abs(to - from) * 0.4))
    const t0 = performance.now()
    const step = (now: number): void => {
      const p = Math.min(1, (now - t0) / dur)
      sc.scrollLeft = from + (to - from) * (1 - Math.pow(1 - p, 4))
      syncRuler()
      raf = p < 1 ? requestAnimationFrame(step) : undefined
    }
    raf = requestAnimationFrame(step)
  }

  function jumpToday(animated = false): void {
    const sc = scroller.value
    if (!sc) return
    const { a } = taskStore.range
    const offset = clock.todayIdx - a + dayFraction(new Date(clock.now))
    scrollTo(offset * ui.dayWidth - sc.clientWidth / 2, animated)
  }

  function onZoom(value: number | string): void {
    const v = typeof value === 'number' ? value : parseFloat(value)
    if (Number.isNaN(v)) return
    ui.zooming = true
    clearTimeout(zoomTimer)
    zoomTimer = setTimeout(() => {
      ui.zooming = false
    }, ZOOM_SETTLE_MS)
    ui.setDayWidth(v)
  }

  onMounted(() => {
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure())
      if (scroller.value) ro.observe(scroller.value)
    }
    window.addEventListener('resize', measure)
  })

  // 資料是 onMounted 之後非同步載進來的，等第一批任務到齊才捲到今天（legacy 的資料是同步的，:1926）
  let jumped = false
  const stopInitialJump = watch(
    () => taskStore.tasks.length,
    (n) => {
      if (jumped || !n) return
      jumped = true
      initialTimer = setTimeout(() => {
        jumpToday(false)
        stopInitialJump()
      }, INITIAL_JUMP_MS)
    },
    { immediate: true },
  )

  // 面板重新展開時 scroller 會換一顆 DOM，要重新量與重新監看
  watch(scroller, (el) => {
    if (!el) return
    ro?.disconnect()
    ro?.observe(el)
    measure()
  })

  onBeforeUnmount(() => {
    if (raf !== undefined) cancelAnimationFrame(raf)
    clearTimeout(zoomTimer)
    clearTimeout(initialTimer)
    ro?.disconnect()
    window.removeEventListener('resize', measure)
  })

  return { scrollX, viewW, onScroll: syncRuler, scrollTo, jumpToday, onZoom }
}
