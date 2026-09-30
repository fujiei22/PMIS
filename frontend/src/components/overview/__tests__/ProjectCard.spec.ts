/**
 * 總覽專案卡 ProjectCard 的測試（用 mock 的範例專案組合，取「客戶入口網站改版」）。
 *
 * 測什麼：名稱、狀態 pill 與卡片色系、實際進度、meta 的落後色調與到期日；
 * 卡片拆成兩個並排的點擊區：左邊主體 .card-main（role=button）展開速覽、右緣直條「進入」導頁；
 * 展開時的外框狀態與 aria-controls 指向速覽抽屜；點擊與 Enter / Space 切換展開；
 * 「進入」連結的網址，以及點「進入」不會切換展開；同泳道只展開一張。速覽抽屜本身見 LaneDrawer.spec。
 * 為什麼：兩個動作要是兄弟元素，不能再把連結包在 role="button" 裡（巢狀互動元素，報讀與鍵盤都會混）；
 * 落後色調與卡片色系是依門檻派生的，寫死時鐘才驗得出來。
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
  const w = mount(ProjectCard, { props: { row: { p, d: deriveProject(p, '2026-09-22') }, laneIds: ['portal', 'app'] },
    global: { plugins: [router] }, attachTo: document.body })
  return { w }
}

describe('ProjectCard', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('客戶入口：名稱、需注意 pill（paused 色系）、卡片本身不帶狀態色、實際 62%、meta 落後 13 用 warn 色', async () => {
    const { w } = await setup()
    expect(w.find('.card-name').text()).toBe('客戶入口網站改版')
    expect(w.find('.pill').classes()).toContain('pill-paused')
    expect(w.find('article').classes()).toEqual(['card'])
    expect(w.find('.pill').text()).toContain('需注意')
    expect(w.find('.hero').text().replace(/\s/g, '')).toBe('62%')
    expect(w.find('.meta-gap').text()).toBe('落後 13%')
    expect(w.find('.meta-gap').classes()).toContain('warn')
    expect(w.find('.card-meta').text()).toContain('2026-10-16')
    w.unmount()
  })

  it('兩個點擊區是兄弟：外框不是按鈕，主體是 role=button，右緣「進入」不在主體裡', async () => {
    const { w } = await setup()
    const card = w.find('article')
    expect(card.attributes('role')).toBeUndefined()
    expect(card.attributes('tabindex')).toBeUndefined()
    const main = card.find('.card-main')
    expect(main.attributes('role')).toBe('button')
    expect(main.attributes('tabindex')).toBe('0')
    expect(main.find('.btn-enter').exists()).toBe(false)
    expect(card.find(':scope > .enter-edge').exists()).toBe(true)
    w.unmount()
  })

  it('速覽不在卡片裡；展開時外框加 is-open，主體的 aria-controls 指向泳道的抽屜 lane-qv-m8', async () => {
    const { w } = await setup()
    const card = w.find('article')
    const main = w.find('.card-main')
    expect(w.find('.quick-view').exists()).toBe(false)
    expect(main.attributes('aria-controls')).toBe('lane-qv-m8')
    expect(card.classes()).not.toContain('is-open')
    await main.trigger('click')
    expect(card.classes()).toContain('is-open')
    w.unmount()
  })

  it('點卡片主體切換展開；Enter 與 Space 也可以', async () => {
    const { w } = await setup()
    const ov = useOverviewStore()
    const main = w.find('.card-main')
    await main.trigger('click')
    expect(ov.isExpanded('portal')).toBe(true)
    expect(main.attributes('aria-expanded')).toBe('true')
    await main.trigger('keydown', { key: 'Enter' })
    expect(ov.isExpanded('portal')).toBe(false)
    await main.trigger('keydown', { key: ' ' })
    expect(ov.isExpanded('portal')).toBe(true)
    w.unmount()
  })

  it('同泳道只展開一張：展開這張時收起同泳道的 app，別的泳道不動', async () => {
    const { w } = await setup()
    const ov = useOverviewStore()
    ov.toggleExpanded('app')
    ov.toggleExpanded('pmis')
    await w.find('.card-main').trigger('click')
    expect(ov.expandedIds).toEqual(['pmis', 'portal'])
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
})
