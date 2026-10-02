import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { api } from '@/api'
import { ApiError } from '@/api/types'
import { isoFromIndex } from '@/lib/date'
import { createWorkdays } from '@/lib/workdays'
import type { WorkCalendar } from '@/types/models'

/**
 * 工作日曆（`GET /api/calendar`）。排程用 `workdays` 判斷哪天上班（規則見 docs/reference/scheduling.md〈工作天〉）。
 *
 * - 全系統共用、跟登入者無關：不放進 ProjectData，也不在登出時重置（`useSession.spec` 的豁免清單）；
 *   每次進 Dashboard 都跟專案資料一起重抓（`useProjectBoot`）。
 * - `load()` 不 reject：日曆失敗不該擋住 Dashboard，排程退回只看週末，畫面提示「假日資料載入失敗」。
 *   已經有資料時重載失敗，保留舊資料；401 交給登入流程（api 層已通知導回登入頁），不顯示失敗提示。
 */
export const useWorkCalendarStore = defineStore('workCalendar', () => {
  /** 後端回來的日曆；約 200 筆、整份替換，不需要深層響應。 */
  const data = shallowRef<WorkCalendar | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  /** 排程用的查詢；還沒載入或失敗時只看週六日。 */
  const workdays = computed(() => createWorkdays(data.value))

  /** 直接給資料（單元測試的共用前置 `test-utils/loadSample.ts` 用）。 */
  function setAll(cal: WorkCalendar): void {
    data.value = cal
    status.value = 'ready'
  }

  /** 請求序號：快速進出 Dashboard 會有好幾發同時在飛，只採用最後發出的那一發（較舊的晚回來就丟掉）。 */
  let seq = 0

  /** 載入日曆；失敗時依上面的規則處理，不 reject。 */
  async function load(): Promise<void> {
    const ticket = ++seq
    if (!data.value) status.value = 'loading'
    try {
      const cal = await api.getCalendar()
      if (ticket === seq) setAll(cal)
    } catch (error) {
      console.error('[api]', '載入工作日曆', error)
      if (ticket !== seq || data.value) return
      const unauthorized = error instanceof ApiError && error.code === 'unauthorized'
      status.value = unauthorized ? 'idle' : 'error'
    }
  }

  /**
   * [a, b]（日索引）涵蓋的年份裡，官方資料還沒匯入的那幾年（遞增）。
   * 只有 ready 時才判斷：還沒載入時 coveredYears 是空的，判斷下去會把每一年都誤報成「未公布」。
   */
  function uncoveredYears(a: number, b: number): number[] {
    if (status.value !== 'ready') return []
    const covered = new Set(workdays.value.coveredYears)
    const last = Number(isoFromIndex(b).slice(0, 4))
    const out: number[] = []
    for (let y = Number(isoFromIndex(a).slice(0, 4)); y <= last; y++)
      if (!covered.has(y)) out.push(y)
    return out
  }

  return { data, status, workdays, setAll, load, uncoveredYears }
})
