import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { dayFraction } from '@/lib/date'
import { easeOutQuart, scrollTweenMs } from '@/lib/scrollTween'
import { useClockStore } from '@/stores/clock'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 縮放滑桿放手後多久恢復甘特條的位移補間。legacy `_zoomT`（:3586） */
const ZOOM_SETTLE_MS = 160

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
  /**
   * 畫布座標換了基準（專案起點外移 / 內縮，所有東西右移 dx px）：捲動位置跟著補 dx，畫面停在原地。
   * 面板收合、scroller 不在時只補記住的位置，重新展開才捲回對的地方。
   */
  shift: (dx: number) => void
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

  /** 正在跑的捲動補間；被新的捲動或使用者動手取消時換掉，已排隊的那一幀看到不是自己就不再寫。 */
  let anim: { raf: number } | null = null
  let zoomTimer: ReturnType<typeof setTimeout> | undefined
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

  /**
   * 停掉程式捲動的補間（「今天」、選取任務的 focus）。動畫稽核 D7：補間不讓位的話，
   * 期間拖條會把捲動量算進拖曳（游標移 6px、日期偏 6 天）、滾輪無效、縮放後今天偏掉。
   */
  function stopScroll(): void {
    if (anim) cancelAnimationFrame(anim.raf)
    anim = null
  }

  function scrollTo(x: number, animated = false): void {
    const sc = scroller.value
    if (!sc) return
    const max = Math.max(0, sc.scrollWidth - sc.clientWidth)
    const to = Math.max(0, Math.min(max, x))
    stopScroll()
    const from = sc.scrollLeft
    if (!animated || Math.abs(to - from) < 1.5) {
      sc.scrollLeft = to
      syncRuler()
      return
    }
    // 距離越遠動畫越長（與總覽時間軸「今天」同一條，lib/scrollTween）
    const dur = scrollTweenMs(to - from)
    const t0 = performance.now()
    const self = { raf: 0 }
    const step = (now: number): void => {
      if (anim !== self) return
      const p = Math.min(1, (now - t0) / dur)
      sc.scrollLeft = from + (to - from) * easeOutQuart(p)
      syncRuler()
      if (p < 1) self.raf = requestAnimationFrame(step)
      else anim = null
    }
    anim = self
    self.raf = requestAnimationFrame(step)
  }

  /** 使用者自己動手的事件：一發生就停掉補間。捕獲階段，比條 / 畫布自己的 pointerdown（會 stopPropagation）早。 */
  const USER_EVENTS = ['pointerdown', 'wheel', 'touchstart'] as const
  let listening: HTMLElement | null = null

  /** 把「使用者動手就停補間」掛到目前的 scroller（面板收合再展開會換一顆）。 */
  function listen(el: HTMLElement | null): void {
    if (listening) for (const t of USER_EVENTS) listening.removeEventListener(t, stopScroll, true)
    listening = el
    if (el)
      for (const t of USER_EVENTS)
        el.addEventListener(t, stopScroll, { capture: true, passive: true })
  }

  function jumpToday(animated = false): void {
    const sc = scroller.value
    if (!sc) return
    const { a } = taskStore.range
    const offset = clock.todayIdx - a + dayFraction(new Date(clock.now))
    scrollTo(offset * ui.dayWidth - sc.clientWidth / 2, animated)
  }

  function shift(dx: number): void {
    const sc = scroller.value
    if (sc) {
      sc.scrollLeft += dx
      syncRuler()
    } else {
      // 動畫稽核 review：收合期間專案起點變了，重新展開時才不會捲回舊的 px（整片跳好幾天）
      scrollX.value = Math.max(0, scrollX.value + dx)
    }
  }

  function onZoom(value: number | string): void {
    const v = typeof value === 'number' ? value : parseFloat(value)
    if (Number.isNaN(v)) return
    // 補間的終點是用舊比例算的，縮放後再捲過去會偏掉
    stopScroll()
    ui.zooming = true
    clearTimeout(zoomTimer)
    zoomTimer = setTimeout(() => {
      ui.zooming = false
    }, ZOOM_SETTLE_MS)
    ui.setDayWidth(v)
  }

  /*
   * 第一次捲到今天：資料已到就在掛載當下捲（同一個 task、第一幀之前）；資料晚到（onMounted 之後才非同步載進來）
   * 就在任務到齊、DOM 更新完時立刻捲。legacy 是掛載後 60ms 才跳（`setTimeout(() => this.jumpToday(), 60)`，:1926）：
   * 從總覽切進來時那 60ms 落在 Dashboard 淡入期間，捲動逼出整頁版面計算、onscroll 再同步尺規，長幀把淡入吃掉（動畫稽核 K1）。
   * 掛載當下頁面還是透明的（切頁淡入的 enter-from），捲動看不到；直接開頁時第一幀就停在今天。
   * 任務到齊就算跳過了：面板收合著（沒有 scroller）時 jumpToday 什麼都不做，同 legacy，展開時照 D12 回到記住的位置；
   * 不能等到有 scroller 才算，否則展開後任務數一變（新增、刪除、背景重載）就把使用者捲到的位置拉回今天（review）。
   */
  let jumped = false
  function initialJump(): void {
    if (jumped || !taskStore.tasks.length) return
    jumped = true
    jumpToday(false)
    stopInitialJump()
  }
  const stopInitialJump = watch(() => taskStore.tasks.length, initialJump, { flush: 'post' })

  onMounted(() => {
    measure()
    listen(scroller.value)
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure())
      if (scroller.value) ro.observe(scroller.value)
    }
    window.addEventListener('resize', measure)
    initialJump()
  })

  // 面板重新展開時 scroller 會換一顆 DOM，要重新量與重新監看
  watch(scroller, (el) => {
    listen(el)
    if (!el) return
    // 新的一顆從 0 開始：捲回收合前最後的位置（動畫稽核 D12；scrollX 在舊的一顆卸載後仍是最後的值）
    if (scrollX.value) {
      el.scrollLeft = scrollX.value
      syncRuler()
    }
    ro?.disconnect()
    ro?.observe(el)
    measure()
  })

  onBeforeUnmount(() => {
    stopScroll()
    listen(null)
    clearTimeout(zoomTimer)
    ro?.disconnect()
    window.removeEventListener('resize', measure)
  })

  return { scrollX, viewW, onScroll: syncRuler, scrollTo, jumpToday, onZoom, shift }
}
