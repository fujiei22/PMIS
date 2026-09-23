/**
 * 專案速覽 QuickView 的測試（用 mock 的範例專案組合）。
 *
 * 測什麼：四組標題、近期任務的快到期標記、落後色調、三種空值文案，
 * 以及 withHead 時的標頭（專案名、狀態 pill、PM、收合鈕、進入連結）。
 * 為什麼：卡片與時間軸共用這份速覽；快到期與落後色調是依今天日期與門檻派生的，
 * 寫死時鐘才驗得出邊界（09-23 算快到期、09-30 不算）。收合鈕要切 overview store 的展開狀態。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { buildPortfolio } from '@/api/mock/portfolio'
import QuickView from '@/components/overview/QuickView.vue'
import { deriveProject } from '@/lib/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/', component: { template: '<div />' } },
  { path: '/projects/:id', name: 'dashboard', component: { template: '<div />' } },
] })

async function setup(id: string, withHead = false) {
  useClockStore().now = new Date('2026-09-22T10:00:00').getTime()
  const data = buildPortfolio(sampleProject, '2026-09-22')
  await usePortfolioStore().load(data)
  const p = data.projects.find((x) => x.id === id)!
  return mount(QuickView, { props: { row: { p, d: deriveProject(p, '2026-09-22') }, withHead }, global: { plugins: [router] } })
}

describe('QuickView', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('四組標題；portal 的近期任務 09-23 標成快到期、09-30 不標', async () => {
    const w = await setup('portal')
    expect(w.findAll('.qb-title').map((x) => x.text())).toEqual(['進度與任務數', '時程', '風險項目', '成員與近期任務'])
    const dates = w.findAll('.tasks .task-date')
    expect(dates[0]!.classes()).toContain('due-soon')
    expect(dates[2]!.classes()).not.toContain('due-soon')
    expect(w.find('.gap-note').classes()).toContain('warn')
  })

  it('空值文案：報表資料倉儲沒有近期任務、沒有未結 Issue', async () => {
    const w = await setup('dw')
    expect(w.text()).toContain('沒有近期到期任務')
    expect(w.text()).toContain('無未結 Issue')
  })

  it('withHead：專案名、pill、PM、收合鈕、進入連結；收合鈕切換展開', async () => {
    const w = await setup('portal', true)
    const ov = useOverviewStore()
    ov.toggleExpanded('portal')
    const head = w.find('.qv-head')
    expect(head.find('.qv-name').text()).toBe('客戶入口網站改版')
    expect(head.find('.pill').classes()).toContain('pill-paused')
    expect(head.text()).toContain('成員8')
    expect(head.find('.btn-enter').attributes('href')).toBe('/projects/portal')
    await head.find('.btn-quick').trigger('click')
    expect(ov.isExpanded('portal')).toBe(false)
  })
})
