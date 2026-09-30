/**
 * 「進入」連結 EnterLink 的測試：卡片右緣直條（edge）與速覽標頭入口塊（head）兩種樣式。
 *
 * 測什麼：兩種都導到該專案的 Dashboard、帶共用的 btn-enter class；
 * 可讀名稱含專案名；edge 只有箭頭，所以另給 title 提示，head 有看得到的「進入」字樣。
 * 為什麼：一頁有很多張卡，每條直條都只畫箭頭，報讀時要靠專案名才分得出是哪一張；
 * e2e 以 getByRole('link', { name: /進入/ }) 找它，名稱開頭要是「進入」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import EnterLink from '@/components/overview/EnterLink.vue'

const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/', component: { template: '<div />' } },
  { path: '/projects/:id', name: 'dashboard', component: { template: '<div />' } },
] })

function setup(variant: 'edge' | 'head') {
  return mount(EnterLink, {
    props: { id: 'portal', name: '客戶入口網站改版', variant },
    global: { plugins: [router] },
  })
}

describe('EnterLink', () => {
  it('edge：右緣直條只畫箭頭，可讀名稱含專案名、title 提示「進入 Dashboard」', () => {
    const a = setup('edge').find('a')
    expect(a.attributes('href')).toBe('/projects/portal')
    expect(a.classes()).toEqual(expect.arrayContaining(['btn-enter', 'enter-edge']))
    expect(a.attributes('aria-label')).toBe('進入 客戶入口網站改版 Dashboard')
    expect(a.attributes('title')).toBe('進入 Dashboard')
    expect(a.text()).toBe('')
    expect(a.find('svg').exists()).toBe(true)
  })

  it('head：速覽標頭入口塊寫「進入」，不帶 title', () => {
    const a = setup('head').find('a')
    expect(a.attributes('href')).toBe('/projects/portal')
    expect(a.classes()).toEqual(expect.arrayContaining(['btn-enter', 'enter-head']))
    expect(a.attributes('aria-label')).toBe('進入 客戶入口網站改版 Dashboard')
    expect(a.attributes('title')).toBeUndefined()
    expect(a.text()).toBe('進入')
  })
})
