import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Budget } from '@/types/models'

/**
 * 專案預算與已支出。
 * 資料由 taskStore.load() 從 ProjectData 餵進來（目前沒有任何寫入 api，只讀）。
 */
export const useBudgetStore = defineStore('budget', () => {
  const budget = ref<Budget>({ total: 0, actual: 0 })

  /** 載入時整份換掉。 */
  function setAll(next: Budget): void {
    budget.value = { ...next }
  }

  /** 換專案時清空（預算 ≤ 0 時摘要卡自己處理，不會除以 0，見 lib/budget.ts）。 */
  function reset(): void {
    setAll({ total: 0, actual: 0 })
  }

  return { budget, setAll, reset }
})
