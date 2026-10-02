import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import SummaryCards from '@/components/summary/SummaryCards.vue'
import { useClockStore } from '@/stores/clock'

/**
 * 整體進度的「理論進度」：基準結束日早於今天的任務才算該完成，今天到期的今天還沒到期。
 * 這是刻意和 legacy（`<=`）不同的地方（user 決定），也和總覽的 taskPlanned 同一個定義，
 * 兩頁同一個專案的理論 % 才會一致。範例專案有一個任務（t8）的基準在 2026-09-18 結束。
 */
describe('SummaryCards 理論進度', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('今天到期的任務不算進理論：09-18 是 6 / 30、20%', () => {
    useClockStore().now = new Date('2026-09-18T10:00:00').getTime()
    const card = mount(SummaryCards).find('[data-testid="summary-progress"]')
    expect(card.findAll('.bar-frac')[1]!.text()).toBe('6 / 30')
    expect(card.find('.bar-pct.plan').text()).toBe('20%')
  })

  it('隔天就算：09-19 是 7 / 30、23%', () => {
    useClockStore().now = new Date('2026-09-19T10:00:00').getTime()
    const card = mount(SummaryCards).find('[data-testid="summary-progress"]')
    expect(card.findAll('.bar-frac')[1]!.text()).toBe('7 / 30')
    expect(card.find('.bar-pct.plan').text()).toBe('23%')
  })
})

/**
 * title 講清楚判準與單位：理論進度、已延遲看的是計畫基準（不是到期日已過）；
 * 專案總時長仍是日曆天（工期才是工作天，兩者單位不同）。
 */
describe('SummaryCards 的 title', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('理論進度註明「依計畫基準」', () => {
    const card = mount(SummaryCards).find('[data-testid="summary-progress"]')
    const plan = card.findAll('.bar-label').find((el) => el.text() === '理論進度')!
    expect(plan.attributes('title')).toContain('依計畫基準')
  })

  it('任務狀態卡的「已延遲」註明「依計畫基準」', () => {
    const late = mount(SummaryCards).find('[data-testid="summary-tasks"] .legend-row.late')
    expect(late.attributes('title')).toContain('依計畫基準')
  })

  it('專案總時長註明「日曆天」', () => {
    const duration = mount(SummaryCards).find('[data-testid="summary-progress"] .duration')
    expect(duration.attributes('title')).toContain('日曆天')
  })
})
