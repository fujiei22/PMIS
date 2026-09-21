import { onBeforeUnmount, onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'

/** 時鐘 tick 間隔；legacy 是 `setInterval(() => this.forceUpdate(), 60000)`（:1927）。 */
const TICK_MS = 60_000

/**
 * 讓 `ui.now` 每分鐘前進一次，今日線、延遲判定、理論進度都跟著更新。
 * 掛在 DashboardView 一次就好；e2e 用 `page.clock.setFixedTime` 時 `Date.now()` 固定，不會漂。
 */
export function useNow(intervalMs: number = TICK_MS): void {
  const ui = useUiStore()
  let timer: ReturnType<typeof setInterval> | undefined

  onMounted(() => {
    ui.now = Date.now()
    timer = setInterval(() => {
      ui.now = Date.now()
    }, intervalMs)
  })

  onBeforeUnmount(() => {
    clearInterval(timer)
  })
}
