/**
 * 面板標題列排序控制 OvSortControls 的測試。
 *
 * 測什麼：預設兩個 chip 的標籤、層級與方向；點 chip 翻方向、點 ✕ 只移除不翻方向；
 * 從選單加一層後右側顯示「層級 箭頭」與方向文字。
 * 為什麼：✕ 是 chip 的兄弟按鈕，若點擊冒泡到 chip 會變成「移除又翻方向」；
 * 排序狀態在 overview store，卡片與時間軸共用，元件只能讀寫 store、不能自己留一份。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import OvSortControls from '@/components/overview/OvSortControls.vue'
import { useOverviewStore } from '@/stores/overview'

describe('OvSortControls', () => {
  beforeEach(() => setActivePinia(createPinia()))
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
})
