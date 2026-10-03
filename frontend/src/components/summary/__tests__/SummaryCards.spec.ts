import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { loadSample } from '@/__tests__/loadSample'
import SummaryCards from '@/components/summary/SummaryCards.vue'
import { useClockStore } from '@/stores/clock'
import { useTaskStore } from '@/stores/task'

/**
 * 整體進度的「理論進度」：計畫結束日早於今天的任務才算該完成，今天到期的今天還沒到期。
 * 這是刻意和 legacy（`<=`）不同的地方（user 決定），也和總覽的 taskPlanned 同一個定義，
 * 兩頁同一個專案的理論 % 才會一致。範例專案有一個任務（t8）的計畫在 2026-09-18 結束。
 */
describe('SummaryCards 理論進度', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('今天到期的任務不算進理論：09-18 是 5 / 30、17%', () => {
    useClockStore().now = new Date('2026-09-18T10:00:00').getTime()
    const card = mount(SummaryCards).find('[data-testid="summary-progress"]')
    expect(card.findAll('.bar-frac')[1]!.text()).toBe('5 / 30')
    expect(card.find('.bar-pct.plan').text()).toBe('17%')
  })

  it('隔天就算：09-19 是 6 / 30、20%', () => {
    useClockStore().now = new Date('2026-09-19T10:00:00').getTime()
    const card = mount(SummaryCards).find('[data-testid="summary-progress"]')
    expect(card.findAll('.bar-frac')[1]!.text()).toBe('6 / 30')
    expect(card.find('.bar-pct.plan').text()).toBe('20%')
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

/** 數字跟 task store 的 counts 走（跟總覽同一個 countTasks），卡片不自己數。 */
describe('SummaryCards 的數字來源', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('t24 改完成：counts 與卡片的實際進度一起變成 5 / 30', async () => {
    useClockStore().now = new Date('2026-09-18T10:00:00').getTime()
    const card = mount(SummaryCards).find('[data-testid="summary-progress"]')
    const s = useTaskStore()
    await s.updateTask('t24', { status: 'done' })
    await nextTick()
    expect(s.counts.byStatus.done).toBe(5)
    expect(card.findAll('.bar-frac')[0]!.text()).toBe('5 / 30')
  })

  it('原始碼不呼叫 isLate／isPlannedDone（計數只在 lib/taskCounts.ts）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/summary/SummaryCards.vue'),
      'utf8',
    )
    expect(src, '改讀 taskStore.counts').not.toMatch(/\b(isLate|isPlannedDone)\(/)
  })
})
