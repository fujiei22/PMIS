import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
