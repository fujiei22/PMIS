import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { ApiError } from '@/api/types'
import ErrorBar from '@/components/common/ErrorBar.vue'
import { useUiStore } from '@/stores/ui'

describe('ErrorBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('沒有錯誤時不佔位置', () => {
    const w = mount(ErrorBar)
    expect(w.find('[data-errorbar]').exists()).toBe(false)
  })

  it('每筆顯示操作名稱 + 錯誤碼中文，容器是 role=alert', () => {
    const ui = useUiStore()
    ui.pushError({ label: '更新任務', error: new ApiError('network', 'fetch failed') })
    const w = mount(ErrorBar)
    const bar = w.find('[data-errorbar]')
    expect(bar.attributes('role')).toBe('alert')
    expect(bar.text()).toContain('更新任務')
    expect(bar.text()).toContain('連線失敗')
    // server 原文不上畫面（review M2）
    expect(bar.text()).not.toContain('fetch failed')
  })

  it('同 label 合併時顯示 ×N，✕ 可關掉那一筆', async () => {
    const ui = useUiStore()
    ui.pushError({ label: '更新任務', error: new ApiError('conflict', 'a') })
    ui.pushError({ label: '更新任務', error: new ApiError('conflict', 'b') })
    const w = mount(ErrorBar)
    expect(w.text()).toContain('×2')
    await w.find('.error-x').trigger('click')
    expect(ui.errors).toHaveLength(0)
  })

  it('關掉最後一筆後整條拿掉，不留做高度過渡的外層佔位置', async () => {
    const ui = useUiStore()
    ui.pushError({ label: '更新任務', error: new ApiError('network', 'x') })
    const w = mount(ErrorBar)
    expect(w.find('[data-errorbar]').exists()).toBe(true)
    await w.find('.error-x').trigger('click')
    expect(w.find('[data-errorbar]').exists()).toBe(false)
    expect(w.find('.error-slot').exists()).toBe(false)
  })

  it('讀不到補間時長（--t-panel）時不補間：進出場的 done 當場呼叫，關掉最後一筆就整條拿掉', async () => {
    const ui = useUiStore()
    // 不用 test-utils 預設的 Transition stub，真的走 onEnter / onLeave（jsdom 沒有 CSS 變數，時長讀成 0）
    const w = mount(ErrorBar, { global: { stubs: { transition: false } } })
    ui.pushError({ label: '更新任務', error: new ApiError('network', 'x') })
    await nextTick()
    expect(w.find('[data-errorbar]').exists()).toBe(true)
    await w.find('.error-x').trigger('click')
    expect(w.find('.error-slot').exists()).toBe(false)
  })

  it('最多列 3 筆，其餘收成「還有 N 筆」', () => {
    const ui = useUiStore()
    for (let i = 1; i <= 5; i++) {
      ui.pushError({ label: `錯誤 ${i}`, error: new ApiError('unknown', 'x') })
    }
    const w = mount(ErrorBar)
    expect(w.findAll('.error-item')).toHaveLength(3)
    expect(w.text()).toContain('還有 2 筆')
  })
})
