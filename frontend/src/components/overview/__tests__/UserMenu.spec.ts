// 總覽頂欄的登入者選單：顯示誰（名錄到了用名錄那筆、還沒到用 session）、開關（點外面 / Esc）、登出後導到登入頁。
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { api, mockApi as maybeMockApi } from '@/api'
import { buildPortfolio } from '@/api/mock/portfolio'
import UserMenu from '@/components/overview/UserMenu.vue'
import { sampleProject } from '@/mocks/sampleProject'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSessionStore } from '@/stores/session'

/** 測試一定走 mock 實作（mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

let router: Router

function mountMenu() {
  return mount(UserMenu, { global: { plugins: [router] }, attachTo: document.body })
}

describe('UserMenu', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    mockApi.reset()
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'overview', component: { template: '<div />' } },
        { path: '/login', name: 'login', component: { template: '<div />' } },
      ],
    })
    await router.push('/')
    await useSessionStore().load()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockApi.reset()
    document.body.innerHTML = ''
  })

  it('名錄還沒到：用 session 的名字與角色，頭像先灰色（登出選單照樣點得到）', () => {
    const w = mountMenu()
    const trigger = w.find('[data-testid="user-menu"]')
    expect(trigger.find('.me-name').text()).toBe('成員11')
    expect(trigger.find('.me-role').text()).toBe('PM 主管')
    expect(trigger.find('.avatar').attributes('style')).toContain(
      '--av-color: var(--text-placeholder)',
    )
    w.unmount()
  })

  it('名錄到了：用名錄那一筆（頭像有成員色）', async () => {
    await usePortfolioStore().load(buildPortfolio(sampleProject, '2026-09-22'))
    const w = mountMenu()
    expect(w.find('.avatar').attributes('style')).toContain('--av-color: #475569')
    w.unmount()
  })

  it('沒登入、也沒有名錄：不顯示', () => {
    useSessionStore().clear()
    const w = mountMenu()
    expect(w.find('[data-testid="user-menu"]').exists()).toBe(false)
    w.unmount()
  })

  it('點了展開選單（目前只有「登出」）；再點一次收起', async () => {
    const w = mountMenu()
    const trigger = w.find('[data-testid="user-menu"]')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(w.findAll('[role="menuitem"]').map((b) => b.text())).toEqual(['登出'])
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    w.unmount()
  })

  it('按 Esc 關、焦點回到觸發鈕；點外面也關', async () => {
    const w = mountMenu()
    const trigger = w.find('[data-testid="user-menu"]')
    await trigger.trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    w.unmount()
  })

  it('點「登出」：關選單、通知後端、導到登入頁', async () => {
    const spy = vi.spyOn(api, 'logout')
    const w = mountMenu()
    await w.find('[data-testid="user-menu"]').trigger('click')
    await w.find('[role="menuitem"]').trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(useSessionStore().info).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    w.unmount()
  })
})
