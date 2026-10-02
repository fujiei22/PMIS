import type { Budget } from '@/types/models'

/** 剩餘預算；超支時為負數。 */
export function budgetRemaining(b: Budget): number {
  return b.total - b.actual
}

/** 使用率，夾在 0~1；預算 ≤ 0 時當 0（避免除以 0），超支時頂在 1。 */
export function budgetRatio(b: Budget): number {
  if (b.total <= 0) return 0
  return Math.min(Math.max(b.actual / b.total, 0), 1)
}

export function isOverBudget(b: Budget): boolean {
  return b.actual > b.total
}

/** 儀表指針角度（度）：使用率 0 = -90°（最左），1 = 90°（最右）。 */
export function gaugeAngle(ratio: number): number {
  return -90 + ratio * 180
}
