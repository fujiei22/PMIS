/**
 * 卡片檢視的 PM 泳道 PmLane 的測試（用 mock 的範例專案組合，取成員5：PMIS、金流介接兩張卡）。
 *
 * 測什麼：標頭的名字、專案數膠囊、需注意數；卡片與泳道抽屜的 grid order——
 * 抽屜排在展開那張卡「所在列的最後一張卡」之後：一列放得下兩張時排在第二張卡後面，一列只放一張時緊接在展開那張後面；
 * 進到卡片檢視時同泳道若有多張展開（時間軸留下來的），只留最後展開的那張。
 * 卡片網格的高度撐住 / 放開（heightTween）只在卡片有進出、換順序時做；卸載時停掉進行中的補間。
 * 為什麼：列下展開靠 order 把抽屜插到該列下方，同列其他卡片才不會被擠到下一列；欄數依寬度變，要兩種都驗。
 * 篩選時每條泳道都會重新渲染，卡片沒變的泳道也撐住再放開的話，每條都要多逼一次版面計算（review M1）。
 * jsdom 沒有版面，欄數由 stub 的 getComputedStyle 決定。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { buildPortfolio } from '@/api/mock/portfolio'
import PmLane from '@/components/overview/PmLane.vue'
import { cancelHeight, holdHeight, releaseHeight } from '@/composables/heightTween'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

// 照原本的行為跑，只記下呼叫
vi.mock('@/composables/heightTween', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/composables/heightTween')>()
  return {
    ...m,
    holdHeight: vi.fn(m.holdHeight),
    releaseHeight: vi.fn(m.releaseHeight),
    cancelHeight: vi.fn(m.cancelHeight),
  }
})

/** 讓 grid 容器回報指定欄數；其他元素照原本的 getComputedStyle。 */
function stubColumns(n: number): void {
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const cs = real(el, pseudo)
    if (!(el instanceof HTMLElement) || !el.classList.contains('lane-body')) return cs
    return new Proxy(cs, {
      get: (t, k) => (k === 'gridTemplateColumns' ? Array(n).fill('300px').join(' ') : Reflect.get(t, k)),
    })
  })
}

/** @param expanded 掛載前先展開的專案（照順序，模擬從時間軸帶過來的狀態） */
async function setup(expanded: string[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/projects/:id', name: 'dashboard', component: { template: '<div />' } },
  ] })
  useClockStore().now = new Date('2026-09-22T10:00:00').getTime()
  await usePortfolioStore().load(buildPortfolio(sampleProject, '2026-09-22'))
  const ov = useOverviewStore()
  for (const id of expanded) ov.toggleExpanded(id)
  const group = ov.groups.find((g) => g.pm.id === 'm5')!
  const w = mount(PmLane, { props: { group }, global: { plugins: [router] } })
  await flushPromises()
  return w
}

/** 每張卡與抽屜的 inline order。 */
function orders(w: Awaited<ReturnType<typeof setup>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const el of w.findAll('[data-project], .drawer')) {
    const key = el.attributes('data-project') ?? 'drawer'
    out[key] = Number(/order:\s*(\d+)/.exec(el.attributes('style') ?? '')![1])
  }
  return out
}

describe('PmLane', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const fn of [holdHeight, releaseHeight, cancelHeight]) vi.mocked(fn).mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('標頭：名字、專案數膠囊、需注意數', async () => {
    stubColumns(3)
    const w = await setup()
    expect(w.find('.pm-name').text()).toBe('成員5')
    // 數字與單位之間是不斷行空白，比對前去掉空白
    expect(w.find('.pm-count').text().replace(/\s/g, '')).toBe('2個專案')
    expect(w.find('.pm-alert').text().replace(/\s/g, '')).toBe('1需注意')
  })

  it('一列放得下兩張：展開第一張，抽屜排在第二張卡之後', async () => {
    stubColumns(3)
    const w = await setup(['pmis'])
    expect(orders(w)).toEqual({ pmis: 0, payment: 2, drawer: 3 })
  })

  it('一列只放一張：抽屜緊接在展開那張之後', async () => {
    stubColumns(1)
    const w = await setup(['pmis'])
    expect(orders(w)).toEqual({ pmis: 0, payment: 2, drawer: 1 })
  })

  it('進到卡片檢視時同泳道多張展開，只留最後展開的那張', async () => {
    stubColumns(3)
    await setup(['payment', 'wiki', 'pmis'])
    expect(useOverviewStore().expandedIds).toEqual(['wiki', 'pmis'])
  })

  it('卡片沒進出的重新渲染（篩選換了 group 物件、卡片一樣）不撐住也不放開；卡片有進出才撐住再放開', async () => {
    stubColumns(3)
    const w = await setup()
    const body = w.find('.lane-body').element
    const group = w.props('group')
    await w.setProps({ group: { ...group, rows: [...group.rows] } })
    expect(holdHeight).not.toHaveBeenCalled()
    expect(releaseHeight).not.toHaveBeenCalled()
    await w.setProps({ group: { ...group, rows: group.rows.slice(0, 1) } })
    expect(holdHeight).toHaveBeenCalledWith(body)
    expect(releaseHeight).toHaveBeenCalledWith(body)
  })

  it('卡片換順序也撐住再放開（換列時網格高度可能變）', async () => {
    stubColumns(3)
    const w = await setup()
    const group = w.props('group')
    await w.setProps({ group: { ...group, rows: [...group.rows].reverse() } })
    expect(holdHeight).toHaveBeenCalledTimes(1)
    expect(releaseHeight).toHaveBeenCalledTimes(1)
  })

  it('卸載時停掉卡片網格進行中的補間', async () => {
    stubColumns(3)
    const w = await setup()
    const body = w.find('.lane-body').element
    w.unmount()
    expect(cancelHeight).toHaveBeenCalledWith(body)
  })
})
