import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isoFromIndex, todayIndex } from '@/lib/date'
import { systemNow } from '@/lib/devClock'
import type { ISODate } from '@/types/models'

/** 時鐘 tick 間隔；legacy 是 `setInterval(() => this.forceUpdate(), 60000)`（:1927）。 */
const TICK_MS = 60_000

/**
 * 時鐘層（契約 C）：所有層都可以讀它，它不讀任何人。
 *
 * 原本 `now / todayIdx / todayIso` 在 `useUiStore`（派生層），
 * 導致資料層要算「今天」就得 import 派生層（review C4）。
 * 搬到這裡之後資料層只依賴 api / lib / types / clock；
 * `ui.ts` 原本保留的同名轉接欄位已在 R3 拿掉。
 *
 * 「現在」一律取 `systemNow()`（`lib/devClock.ts`）而不是 `Date.now()`：
 * mock 的 dev server 會把今天平移到 2026-09-18（範例資料推算用的今天，`?today=` 可改），
 * 其他環境（production、vitest、真後端）就是 `Date.now()`。時鐘仍只依賴 lib，不 import 任何 store。
 */
export const useClockStore = defineStore('clock', () => {
  /** 目前時間（`systemNow()`）；`useNow` 每 60 秒 tick 一次，測試與 e2e 直接寫死它。 */
  const now = ref(systemNow())
  /** 今天的日索引，延遲判定與今日線都讀它。 */
  const todayIdx = computed(() => todayIndex(now.value))
  /** 今天的 'YYYY-MM-DD'，填完成日時用。legacy `today()` :2269 */
  const todayIso = computed<ISODate>(() => isoFromIndex(todayIdx.value))

  let timer: ReturnType<typeof setInterval> | undefined

  /** 開始走針：先對一次時，之後每 intervalMs 取一次 `systemNow()`；重複呼叫不會疊加計時器。 */
  function start(intervalMs: number = TICK_MS): void {
    stop()
    now.value = systemNow()
    timer = setInterval(() => {
      now.value = systemNow()
    }, intervalMs)
  }

  function stop(): void {
    clearInterval(timer)
    timer = undefined
  }

  return { now, todayIdx, todayIso, start, stop }
})
