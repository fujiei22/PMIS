/**
 * 面板標題列排序控制 OvSortControls 的測試。
 *
 * 測什麼：預設兩個 chip 的標籤、層級與方向；點 chip 翻方向、點 ✕ 只移除不翻方向；
 * 從選單加一層後右側顯示「層級 箭頭」與方向文字；選單往右展開會超出視窗時改靠按鈕右緣。
 * 為什麼：✕ 是 chip 的兄弟按鈕，若點擊冒泡到 chip 會變成「移除又翻方向」；
 * 排序狀態在 overview store，卡片與時間軸共用，元件只能讀寫 store、不能自己留一份；
 * 平板直向時排序鈕在標題列右半，選單照舊往右開會超出螢幕、整頁可以左右晃。
 * jsdom 沒有版面，按鈕位置、選單寬與視窗寬用 spy 給。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OvSortControls from '@/components/overview/OvSortControls.vue'
import { useOverviewStore } from '@/stores/overview'

describe('OvSortControls', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())
  it('預設兩個 chip：① 落後進度百分比（desc）② 專案到期日（asc）', () => {
    const w = mount(OvSortControls)
    const chips = w.findAll('.sort-chip')
    expect(chips.map((c) => c.find('.chip-label').text())).toEqual(['落後進度百分比', '專案到期日'])
    expect(chips.map((c) => c.find('.chip-level').text())).toEqual(['1', '2'])
    expect(chips[0]!.find('.chip-arrow').classes()).toContain('desc')
    expect(chips[1]!.find('.chip-arrow').classes()).not.toContain('desc')
  })
  it('點 chip 翻方向；點 ✕ 只移除、不翻方向', async () => {
    const w = mount(OvSortControls)
    const ov = useOverviewStore()
    await w.findAll('.sort-chip')[0]!.trigger('click')
    expect(ov.sorts[0]!.dir).toBe('asc')
    await w.findAll('.chip-x')[1]!.trigger('click')
    expect(ov.sorts).toEqual([{ k: 'gap', dir: 'asc' }])
  })
  it('選單選項點一下加一層，右側顯示層級與方向', async () => {
    const w = mount(OvSortControls)
    const ov = useOverviewStore()
    ov.toggleDropdown('sort')
    await w.vm.$nextTick()
    const issue = () => w.findAll('.sort-option').find((o) => o.text().includes('Issue 數量'))!
    await issue().trigger('click')
    expect(ov.sorts.map((s) => s.k)).toEqual(['gap', 'due', 'issues'])
    expect(issue().find('.sort-badge').text()).toBe('3 ↓')
    expect(issue().find('.sort-dir').text()).toBe('多到少')
  })
  it('選單往右展開會超出視窗時，改成對齊按鈕右緣往左展開', async () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(768)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(218)
    const w = mount(OvSortControls, { attachTo: document.body })
    const ov = useOverviewStore()
    const at = (left: number) =>
      vi
        .spyOn(w.find('.sort-trigger').element, 'getBoundingClientRect')
        .mockReturnValue({ left } as DOMRect)

    // 平板直向：按鈕在 647px，218px 寬的選單往右開會超出 768
    at(647)
    ov.toggleDropdown('sort')
    await w.vm.$nextTick()
    expect(w.find('.sort-menu').classes()).toContain('align-end')

    // 空間夠：照舊往右開
    ov.closeDropdown()
    await w.vm.$nextTick()
    at(300)
    ov.toggleDropdown('sort')
    await w.vm.$nextTick()
    expect(w.find('.sort-menu').classes()).not.toContain('align-end')
    w.unmount()
  })
})
