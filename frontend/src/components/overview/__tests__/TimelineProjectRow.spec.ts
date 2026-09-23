// 時間軸專案列：根元素帶 data-project 與狀態 class、左欄數字、bar 的 px 位置、速覽外殼常駐與展開收合。
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { buildPortfolio } from '@/api/mock/portfolio'
import TimelineProjectRow from '@/components/overview/TimelineProjectRow.vue'
import { TIMELINE_DAY_W } from '@/constants/overview'
import { dayIndex } from '@/lib/date'
import { deriveProject } from '@/lib/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

async function setup(id = 'portal') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/projects/:id', name: 'dashboard', component: { template: '<div />' } },
  ] })
  useClockStore().now = new Date('2026-09-22T10:00:00').getTime()
  const data = buildPortfolio(sampleProject, '2026-09-22')
  await usePortfolioStore().load(data)
  const p = data.projects.find((x) => x.id === id)!
  const startIdx = dayIndex('2026-06-01')
  return mount(TimelineProjectRow, { props: { row: { p, d: deriveProject(p, '2026-09-22') }, startIdx, dw: TIMELINE_DAY_W },
    global: { plugins: [router] } })
}

/** 從 inline style 取出某個 px 值。 */
function px(style: string, prop: string): number {
  return parseFloat(new RegExp(`${prop}:\\s*([\\d.]+)px`).exec(style)![1]!)
}

describe('TimelineProjectRow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('根元素 .p-block 帶 data-project 與 paused（需注意）；.p-row 不帶 data-project', async () => {
    const w = await setup()
    expect(w.attributes('data-project')).toBe('portal')
    expect(w.classes()).toEqual(expect.arrayContaining(['p-block', 'paused']))
    expect(w.find('.p-row').attributes('data-project')).toBeUndefined()
  })

  it('左欄：進度「實際 / 理論」、落後只寫 %，13 用 warn 色', async () => {
    const w = await setup()
    expect(w.find('.c-pct').text().replace(/\s+/g, ' ')).toBe('62% / 75%')
    expect(w.find('.c-pct').attributes('title')).toBe('實際進度 62% / 理論進度 75%')
    expect(w.find('.c-gap').text()).toBe('13%')
    expect(w.find('.c-gap').classes()).toContain('warn')
  })

  it('bar 位置 = (開始日 − 範圍起點) × 日寬，寬 = 總天數 × 日寬（102 天）', async () => {
    const w = await setup()
    const style = w.find('.bar').attributes('style')!
    expect(px(style, 'left')).toBeCloseTo((dayIndex('2026-07-06') - dayIndex('2026-06-01')) * TIMELINE_DAY_W, 3)
    expect(px(style, 'width')).toBeCloseTo(102 * TIMELINE_DAY_W, 3)
    expect(w.find('.bar-label').text()).toBe('客戶入口網站改版')
  })

  it('速覽外殼一直在 DOM；點列展開，標頭有專案名、PM、收合、進入；Enter 收回', async () => {
    const w = await setup()
    const ov = useOverviewStore()
    expect(w.find('.qv .quick-wrap').exists()).toBe(true)
    await w.find('.p-row').trigger('click')
    expect(ov.isExpanded('portal')).toBe(true)
    expect(w.find('.p-row').attributes('aria-expanded')).toBe('true')
    const head = w.find('.qv-head')
    expect(head.find('.qv-name').text()).toBe('客戶入口網站改版')
    expect(head.text()).toContain('成員8')
    expect(head.find('.btn-enter').attributes('href')).toBe('/projects/portal')
    expect(head.find('.btn-quick').exists()).toBe(true)
    await w.find('.p-row').trigger('keydown', { key: 'Enter' })
    expect(ov.isExpanded('portal')).toBe(false)
  })
})
