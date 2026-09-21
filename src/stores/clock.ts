import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isoFromIndex, todayIndex } from '@/lib/date'
import type { ISODate } from '@/types/models'

/** 時鐘 tick 間隔；legacy 是 `setInterval(() => this.forceUpdate(), 60000)`（:1927）。 */
const TICK_MS = 60_000

/**
 * 時鐘層（契約 C）：所有層都可以讀它，它不讀任何人。
 *
 * 原本 `now / todayIdx / todayIso` 在 `useUiStore`（派生層），
 * 導致資料層要算「今天」就得 import 派生層（review C4）。
 * 搬到這裡之後資料層只依賴 api / lib / types / clock；
 * `ui.ts` 暫時保留同名的轉接欄位，呼叫端到 R3 一次改完。
 */
export const useClockStore = defineStore('clock', () => {
  /** 目前時間；`useNow` 每 60 秒 tick 一次，測試與 e2e 直接寫死它。 */
  const now = ref(Date.now())
  /** 今天的日索引，延遲判定與今日線都讀它。 */
  const todayIdx = computed(() => todayIndex(now.value))
  /** 今天的 'YYYY-MM-DD'，填完成日時用。legacy `today()` :2269 */
  const todayIso = computed<ISODate>(() => isoFromIndex(todayIdx.value))

  let timer: ReturnType<typeof setInterval> | undefined

  /** 開始走針；重複呼叫不會疊加計時器。 */
  function start(intervalMs: number = TICK_MS): void {
    stop()
    now.value = Date.now()
    timer = setInterval(() => {
      now.value = Date.now()
    }, intervalMs)
  }

  function stop(): void {
    clearInterval(timer)
    timer = undefined
  }

  return { now, todayIdx, todayIso, start, stop }
})
