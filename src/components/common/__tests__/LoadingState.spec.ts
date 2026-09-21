import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import LoadingState from '@/components/common/LoadingState.vue'

describe('LoadingState', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('loading 態顯示載入中、沒有重試鈕', () => {
    const w = mount(LoadingState, { props: { state: 'loading', error: null } })
    expect(w.text()).toContain('載入中')
    expect(w.find('button').exists()).toBe(false)
  })

  it('error 態顯示錯誤文字與重試鈕，按了發出 retry', async () => {
    const w = mount(LoadingState, { props: { state: 'error', error: '連線失敗' } })
    expect(w.find('[data-load-error]').text()).toBe('連線失敗')
    await w.find('button.btn-danger').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })
})
