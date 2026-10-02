import { createPinia, setActivePinia } from 'pinia'
import { mockApi } from '@/api'
import { useProjectBoot } from '@/composables/useProjectBoot'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useWorkCalendarStore } from '@/stores/workCalendar'
import type { ProjectData } from '@/types/models'

/**
 * 單元測試的共用前置（不是測試檔：檔名不是 `.spec.ts`，vitest 不會把它當測試跑；
 * 放在 `__tests__/` 底下，正式程式碼的型別檢查與 build 都不會碰到它）。
 *
 * 看得到日期的測試一律用這裡的兩支：排程依工作日曆推算，沒載入日曆時只看週末，
 * 範例資料在 2026-09-18 會有 18 筆起訖跟範例存的值不同（規則見 docs/reference/scheduling.md）。
 */

/** 範例資料的「今天」：2026-09-18 10:00（台北），跟 e2e 的固定時鐘、mock dev server 的預設同一天。 */
export const SAMPLE_NOW = Date.parse('2026-09-18T10:00:00+08:00')

/**
 * 新 pinia、mock 重置成範例（可換一份資料）、固定時鐘，再走一次 boot——跟進 Dashboard 一樣，
 * 專案資料與工作日曆一起載入。
 */
export async function loadSample(opts: { now?: number; data?: ProjectData } = {}): Promise<void> {
  setActivePinia(createPinia())
  mockApi!.reset(opts.data ?? structuredClone(sampleProject))
  useClockStore().now = opts.now ?? SAMPLE_NOW
  await useProjectBoot('pmis').reload()
}

/** 不走 boot、直接 `taskStore.load(data)` 的測試，先呼叫這支把工作日曆設好。 */
export function useSampleCalendar(): void {
  useWorkCalendarStore().setAll(structuredClone(sampleCalendar))
}
