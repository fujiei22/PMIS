import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { sampleProject } from '@/mocks/sampleProject'
import { useBudgetStore } from '@/stores/budget'
import { useTaskStore } from '@/stores/task'

describe('budgetStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('載入前是 0', () => {
    expect(useBudgetStore().budget).toEqual({ total: 0, actual: 0 })
  })

  it('taskStore.load 後帶入預算與支出', () => {
    useTaskStore().load(structuredClone(sampleProject))
    expect(useBudgetStore().budget).toEqual({ total: 50000, actual: 32500 })
  })

  it('setAll 複製一份，不和來源共用物件', () => {
    const src = { total: 10, actual: 3 }
    const s = useBudgetStore()
    s.setAll(src)
    src.actual = 99
    expect(s.budget.actual).toBe(3)
  })
})
