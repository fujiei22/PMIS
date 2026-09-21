import { onBeforeUnmount } from 'vue'

/**
 * 拖曳到畫面邊緣時自動捲動。
 * legacy 對照：`autoScrollTick` / `startAuto` / `stopAuto`（:2437-2482）。
 */

/** 距離邊緣多少 px 內開始捲。legacy `EDGE`（:2443） */
const EDGE = 72
/** 每一幀最多捲幾 px（越靠近邊緣越接近上限）。legacy `MAX`（:2443） */
const MAX = 18
/** 沒有內層垂直捲動容器時，把畫面上緣當成這個 y（legacy :2457 寫死 60，避開頂部列）。 */
const WINDOW_TOP = 60

export interface AutoScrollTargets {
  /** 目前的指標座標；回 null 這一幀就不捲（例如 pan 自己已經在捲了）。 */
  pointer: () => { x: number; y: number } | null
  /** 水平捲動容器；回 null 代表這一輪不捲水平（legacy 重排時就不捲，:2445）。 */
  horizontal: () => HTMLElement | null
  /** 垂直捲動容器；它自己沒有可捲高度就退回捲視窗。 */
  vertical: () => HTMLElement | null
  /** 真的捲動了才呼叫；拖曳要用新的捲動位置重算一次結果。legacy :2476 */
  onScrolled: () => void
}

export interface AutoScroll {
  /** 開始 rAF 迴圈；重複呼叫不會疊加。 */
  start: () => void
  stop: () => void
}

/**
 * 建立一組邊緣自動捲動的控制。
 * 只在拖曳期間跑，`start()` 由拖曳開始時呼叫、`stop()` 由放開時呼叫。
 */
export function useAutoScroll(targets: AutoScrollTargets): AutoScroll {
  let raf: number | undefined

  /** 單軸的速度：離邊緣越近越快，最多 MAX。legacy :2448-2450 / :2460-2462 */
  function velocity(pos: number, min: number, max: number): number {
    if (pos < min + EDGE) return -Math.min(1, (min + EDGE - pos) / EDGE) * MAX
    if (pos > max - EDGE) return Math.min(1, (pos - (max - EDGE)) / EDGE) * MAX
    return 0
  }

  function tick(): void {
    const p = targets.pointer()
    if (!p) return
    let moved = false

    const sc = targets.horizontal()
    if (sc) {
      const r = sc.getBoundingClientRect()
      const vx = velocity(p.x, r.left, r.right)
      if (vx) {
        const before = sc.scrollLeft
        sc.scrollLeft += vx
        // 尺規同步交給 scroller 自己的 scroll 事件（legacy 在這裡手動 syncRuler）
        if (sc.scrollLeft !== before) moved = true
      }
    }

    const vs = targets.vertical()
    // 容器本身捲得動就捲它，否則捲視窗。legacy `innerV`（:2456）
    const innerV = !!vs && vs.scrollHeight > vs.clientHeight + 1
    const box = innerV && vs ? vs.getBoundingClientRect() : null
    const vy = velocity(p.y, box ? box.top : WINDOW_TOP, box ? box.bottom : window.innerHeight)
    if (vy) {
      let inner = false
      if (innerV && vs) {
        const before = vs.scrollTop
        vs.scrollTop += vy
        inner = vs.scrollTop !== before
        if (inner) moved = true
      }
      // 內層捲不動（沒有內層、或已經到底）就改捲視窗（legacy :2466-2472）
      if (!inner) {
        const before = window.scrollY
        window.scrollBy(0, vy)
        if (window.scrollY !== before) moved = true
      }
    }

    if (moved) targets.onScrolled()
  }

  function start(): void {
    if (raf !== undefined) return
    const step = (): void => {
      raf = requestAnimationFrame(step)
      tick()
    }
    raf = requestAnimationFrame(step)
  }

  function stop(): void {
    if (raf !== undefined) cancelAnimationFrame(raf)
    raf = undefined
  }

  onBeforeUnmount(stop)

  return { start, stop }
}
