import { describe, expect, it } from 'vitest'
import { budgetRatio, budgetRemaining, gaugeAngle, isOverBudget } from '@/lib/budget'

describe('budget', () => {
  it('剩餘 = 預算 - 支出，超支為負', () => {
    expect(budgetRemaining({ total: 50000, actual: 32500 })).toBe(17500)
    expect(budgetRemaining({ total: 100, actual: 130 })).toBe(-30)
  })

  it('使用率夾在 0~1', () => {
    expect(budgetRatio({ total: 50000, actual: 32500 })).toBeCloseTo(0.65)
    expect(budgetRatio({ total: 100, actual: 250 })).toBe(1)
    expect(budgetRatio({ total: 100, actual: -5 })).toBe(0)
  })

  it('預算為 0 或負數時使用率是 0，不除以 0', () => {
    expect(budgetRatio({ total: 0, actual: 100 })).toBe(0)
    expect(budgetRatio({ total: -10, actual: 5 })).toBe(0)
  })

  it('只有支出大於預算才算超支', () => {
    expect(isOverBudget({ total: 100, actual: 100 })).toBe(false)
    expect(isOverBudget({ total: 100, actual: 101 })).toBe(true)
  })

  it('指針角度：0 → -90、0.5 → 0、1 → 90', () => {
    expect(gaugeAngle(0)).toBe(-90)
    expect(gaugeAngle(0.5)).toBe(0)
    expect(gaugeAngle(1)).toBe(90)
  })
})
