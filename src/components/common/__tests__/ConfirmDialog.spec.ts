import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'

/**
 * ConfirmDialog 是純展示元件（契約 H）：只認 props、只發 next / confirm / cancel，
 * 不讀 store、不知道 kind。文案怎麼組是 `useConfirmProps` 的事（見 useConfirmProps.spec）。
 */

const base = {
  open: true,
  step: 1 as 1 | 2,
  title: '刪除任務？',
  body: '將刪除任務「A」，同時移除其 2 筆 Issue 與所有串接關係。',
  confirmLabel: '繼續刪除',
}

describe('ConfirmDialog 純展示', () => {
  it('open=false 什麼都不畫', () => {
    const w = mount(ConfirmDialog, { props: { ...base, open: false } })
    expect(w.find('.confirm-dialog').exists()).toBe(false)
  })

  it('step 1 畫標題 / 內文 / 取消 + 繼續鈕（btn-next）', () => {
    const w = mount(ConfirmDialog, { props: base })
    expect(w.find('.confirm-title').text()).toBe('刪除任務？')
    expect(w.find('.confirm-title').classes()).not.toContain('final')
    expect(w.find('.confirm-body').text()).toBe(base.body)
    expect(w.find('.btn-cancel').text()).toBe('取消')
    expect(w.find('.btn-next').text()).toBe('繼續刪除')
    expect(w.find('.btn-danger').exists()).toBe(false)
    // 沒給 extra 就不畫額外那行
    expect(w.find('.confirm-extra').exists()).toBe(false)
  })

  it('step 2 標題轉紅（final）、確認鈕是 btn-danger', () => {
    const w = mount(ConfirmDialog, {
      props: { ...base, step: 2, title: '再次確認', confirmLabel: '確認刪除' },
    })
    expect(w.find('.confirm-title').text()).toBe('再次確認')
    expect(w.find('.confirm-title').classes()).toContain('final')
    expect(w.find('.btn-next').exists()).toBe(false)
    expect(w.find('.btn-danger').text()).toBe('確認刪除')
  })

  it('有 extra 時多畫一行', () => {
    const w = mount(ConfirmDialog, { props: { ...base, extra: '附註一句' } })
    expect(w.find('.confirm-extra').text()).toBe('附註一句')
  })

  it('三顆鈕各自發自己的事件，元件不自己改任何狀態', async () => {
    const w = mount(ConfirmDialog, { props: base })
    await w.find('.btn-cancel').trigger('click')
    await w.find('.btn-next').trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('next')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeUndefined()

    const w2 = mount(ConfirmDialog, { props: { ...base, step: 2, confirmLabel: '確認刪除' } })
    await w2.find('.btn-danger').trigger('click')
    expect(w2.emitted('confirm')).toHaveLength(1)
  })
})
