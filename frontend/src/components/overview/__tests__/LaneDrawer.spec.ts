/**
 * 卡片泳道的速覽抽屜 LaneDrawer 的測試（用 mock 的範例專案組合，取成員8：客戶入口網站改版、行動 App v2）。
 *
 * 測什麼：沒有展開時隱藏、0fr、沒有內容；展開時先顯示再切 1fr，order 排在該卡所在列之後、id 對應卡片的 aria-controls；
 * 同一列換一張時抽屜不收、直接換內容；換到別列時先收起（0fr、還在舊位置），收完才到新位置展開；全部收合後隱藏。
 * 為什麼：每條泳道只有一個抽屜（照 iTunes 列下展開），切換時的收 / 開順序與位置都靠這個元件的狀態機；
 * 抽屜橫跨整列，收合時若還佔 grid 位置會把同列卡片拆開，所以要 display: none。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { buildPortfolio } from '@/api/mock/portfolio'
import LaneDrawer from '@/components/overview/LaneDrawer.vue'
import { PANEL_UNMOUNT_MS } from '@/constants/overview'
import { deriveProject, type ProjectRow } from '@/lib/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

async function setup(cols: number) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/projects/:id', name: 'dashboard', component: { template: '<div />' } },
  ] })
  useClockStore().now = new Date('2026-09-22T10:00:00').getTime()
  const data = buildPortfolio(sampleProject, '2026-09-22')
  await usePortfolioStore().load(data)
  const rows: ProjectRow[] = ['portal', 'app'].map((id) => {
    const p = data.projects.find((x) => x.id === id)!
    return { p, d: deriveProject(p, '2026-09-22') }
  })
  return mount(LaneDrawer, { props: { pmId: 'm8', rows, cols }, global: { plugins: [router] } })
}

const style = (w: Awaited<ReturnType<typeof setup>>) => w.find('.drawer').attributes('style') ?? ''

describe('LaneDrawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('沒有展開：隱藏、0fr、沒有內容；id 對應卡片的 aria-controls', async () => {
    const w = await setup(3)
    expect(w.find('.drawer').attributes('id')).toBe('lane-qv-m8')
    expect(style(w)).toContain('display: none')
    expect(style(w)).toContain('0fr')
    expect(w.find('.quick-view').exists()).toBe(false)
  })

  it('展開：顯示、1fr、排在該列之後；標頭沒有收合鈕，再點一次卡片（store）收起，收完才隱藏', async () => {
    const w = await setup(3)
    const ov = useOverviewStore()
    ov.toggleExpanded('portal')
    await flushPromises()
    expect(style(w)).not.toContain('display: none')
    expect(style(w)).toContain('1fr')
    expect(style(w)).toContain('order: 3')
    expect(w.find('.drawer').attributes('data-drawer')).toBe('portal')
    expect(w.find('.btn-quick').exists()).toBe(false)
    ov.toggleExpanded('portal')
    await flushPromises()
    expect(style(w)).toContain('0fr')
    expect(style(w)).not.toContain('display: none')
    vi.advanceTimersByTime(PANEL_UNMOUNT_MS)
    await flushPromises()
    expect(style(w)).toContain('display: none')
  })

  it('同一列換一張：抽屜不收，直接換內容', async () => {
    const w = await setup(3)
    const ov = useOverviewStore()
    ov.toggleExpandedInLane('portal', ['portal', 'app'])
    await flushPromises()
    ov.toggleExpandedInLane('app', ['portal', 'app'])
    await flushPromises()
    expect(style(w)).toContain('1fr')
    expect(style(w)).toContain('order: 3')
    expect(w.find('.drawer').attributes('data-drawer')).toBe('app')
    expect(w.find('.qv-name').text()).toBe('行動 App v2')
  })

  it('換到別列：先在舊位置收起，收完才到新位置展開', async () => {
    const w = await setup(1)
    const ov = useOverviewStore()
    ov.toggleExpandedInLane('portal', ['portal', 'app'])
    await flushPromises()
    expect(style(w)).toContain('order: 1')
    ov.toggleExpandedInLane('app', ['portal', 'app'])
    await flushPromises()
    expect(style(w)).toContain('0fr')
    expect(style(w)).toContain('order: 1')
    expect(w.find('.drawer').attributes('data-drawer')).toBe('portal')
    vi.advanceTimersByTime(PANEL_UNMOUNT_MS)
    await flushPromises()
    expect(style(w)).toContain('order: 3')
    expect(style(w)).toContain('1fr')
    expect(w.find('.drawer').attributes('data-drawer')).toBe('app')
  })
})
