/**
 * 總覽下拉外殼 OvDropdown 的測試。
 *
 * 測什麼：面板只在 open 時畫出、點觸發鈕只 emit 不自己改狀態、aria-expanded / active / disabled
 * 跟著 props 走、trigger slot 能換掉觸發鈕內容、attrs 落在單一 root。
 * 為什麼：頂欄三個篩選（成員 / 狀態 / 需注意）都套這個外殼，開關狀態在 overview store；
 * 外殼若自己持有狀態或多出一層 root，`data-ov-dd` 這類 e2e 鉤子就會掛錯地方。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OvDropdown from '@/components/overview/OvDropdown.vue'

describe('OvDropdown', () => {
  it('open=false 不畫面板；點觸發鈕 emit toggle；aria-expanded 跟著 open', async () => {
    const w = mount(OvDropdown, { props: { label: '狀態', active: false, open: false }, slots: { default: '<i class="opt" />' } })
    expect(w.find('.dd-menu').exists()).toBe(false)
    expect(w.find('button.dd-trigger').attributes('aria-expanded')).toBe('false')
    await w.find('button.dd-trigger').trigger('click')
    expect(w.emitted('toggle')).toHaveLength(1)
    await w.setProps({ open: true })
    expect(w.find('.dd-menu .opt').exists()).toBe(true)
    expect(w.find('button.dd-trigger').attributes('aria-expanded')).toBe('true')
  })
  it('active 時觸發鈕帶 .active；disabled 時按不下去', async () => {
    const w = mount(OvDropdown, { props: { label: '狀態 2', active: true, open: false, disabled: true } })
    expect(w.find('.dd-trigger').classes()).toContain('active')
    expect(w.find('.dd-trigger').attributes('disabled')).toBeDefined()
  })
  it('trigger slot 可換掉觸發鈕內容；attrs 落在單一 root', () => {
    const w = mount(OvDropdown, { props: { label: '成員', active: false, open: false }, attrs: { 'data-ov-dd': 'pm' },
      slots: { trigger: '<span class="stack" />' } })
    expect(w.attributes('data-ov-dd')).toBe('pm')
    expect(w.find('.dd-trigger .stack').exists()).toBe(true)
  })
})
