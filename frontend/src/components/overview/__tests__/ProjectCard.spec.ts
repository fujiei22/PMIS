/**
 * 總覽專案卡 ProjectCard 的測試（用 mock 的範例專案組合，取「客戶入口網站改版」）。
 *
 * 測什麼：名稱、狀態 pill 與卡片色系、實際進度、meta 的落後色調與到期日；
 * 速覽外殼常駐 DOM 並以 grid-template-rows 0fr / 1fr 切換；點擊與 Enter / Space 切換展開；
 * 「進入」連結的網址，以及點「進入」或速覽內部都不會切換展開。
 * 為什麼：整張卡是 role="button"，裡面又包了「進入」連結與速覽，
 * 冒泡與鍵盤事件很容易互相干擾；落後色調與卡片色系是依門檻派生的，寫死時鐘才驗得出來。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { buildPortfolio } from '@/api/mock/portfolio'
import ProjectCard from '@/components/overview/ProjectCard.vue'
import { deriveProject } from '@/lib/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/projects/:id', name: 'dashboard', component: { template: '<div />' } },
  ] })
  useClockStore().now = new Date('2026-09-22T10:00:00').getTime()
  const data = buildPortfolio(sampleProject, '2026-09-22')
  await usePortfolioStore().load(data)
  const p = data.projects.find((x) => x.id === 'portal')!
  const w = mount(ProjectCard, { props: { row: { p, d: deriveProject(p, '2026-09-22') } },
    global: { plugins: [router] }, attachTo: document.body })
  return { w }
}

describe('ProjectCard', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('客戶入口：名稱、需注意 pill（paused 色系）、實際 62%、meta 落後 13 用 warn 色', async () => {
    const { w } = await setup()
    expect(w.find('.card-name').text()).toBe('客戶入口網站改版')
    expect(w.find('article').classes()).toContain('card-paused')
    expect(w.find('.pill').text()).toContain('需注意')
    expect(w.find('.hero').text().replace(/\s/g, '')).toBe('62%')
    expect(w.find('.meta-gap').text()).toBe('落後 13 個百分點')
    expect(w.find('.meta-gap').classes()).toContain('warn')
    expect(w.find('.card-meta').text()).toContain('2026-10-16')
    w.unmount()
  })

  it('速覽外殼一直在 DOM；收合時 0fr、展開時 1fr', async () => {
    const { w } = await setup()
    expect(w.find('.quick-wrap').exists()).toBe(true)
    expect(w.find('.quick-wrap').attributes('style')).toContain('0fr')
    await w.find('article').trigger('click')
    expect(w.find('.quick-wrap').attributes('style')).toContain('1fr')
    w.unmount()
  })

  it('點卡片切換展開；Enter 與 Space 也可以', async () => {
    const { w } = await setup()
    const ov = useOverviewStore()
    await w.find('article').trigger('click')
    expect(ov.isExpanded('portal')).toBe(true)
    expect(w.find('article').attributes('aria-expanded')).toBe('true')
    await w.find('article').trigger('keydown', { key: 'Enter' })
    expect(ov.isExpanded('portal')).toBe(false)
    await w.find('article').trigger('keydown', { key: ' ' })
    expect(ov.isExpanded('portal')).toBe(true)
    w.unmount()
  })

  it('點「進入」或在「進入」上按 Enter 都不切換展開；連結指向 /projects/portal', async () => {
    const { w } = await setup()
    const ov = useOverviewStore()
    const link = w.find('.btn-enter')
    expect(link.attributes('href')).toBe('/projects/portal')
    await link.trigger('click')
    await link.trigger('keydown', { key: 'Enter' })
    expect(ov.isExpanded('portal')).toBe(false)
    w.unmount()
  })

  it('點速覽內部不收合', async () => {
    const { w } = await setup()
    const ov = useOverviewStore()
    ov.toggleExpanded('portal')
    await w.vm.$nextTick()
    await w.find('.quick-wrap').trigger('click')
    expect(ov.isExpanded('portal')).toBe(true)
    w.unmount()
  })
})
