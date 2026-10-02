import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PanelShell from '@/components/common/PanelShell.vue'
import { useUiStore } from '@/stores/ui'

/**
 * 面板外殼的 overflow：展開的過渡（grid-template-rows）跑完才放行。
 * 動畫稽核 D3：展開當下就 visible 的話，內容比還在長高的外框高，甘特有 z-index 的內容整張蓋在下方看板上。
 */

/** jsdom 沒有 TransitionEvent 建構子：用一般 Event 補上 propertyName。 */
function transitionEnd(propertyName: string, bubbles = false): Event {
  const e = new Event('transitionend', { bubbles })
  Object.defineProperty(e, 'propertyName', { value: propertyName })
  return e
}

function mountShell() {
  return mount(PanelShell, {
    props: { panel: 'gantt' },
    slots: { default: () => h('div', { class: 'content' }, '甘特') },
  })
}

const clipOf = (w: ReturnType<typeof mountShell>): string =>
  (w.find('.panel-clip').element as HTMLElement).style.overflow

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PanelShell 的 overflow（D3）', () => {
  it('一開始就展開：直接放行（沒有過渡要等）', () => {
    expect(clipOf(mountShell())).toBe('visible')
  })

  it('收合當下就裁；再展開時等 grid-template-rows 的 transitionend 才放行', async () => {
    const ui = useUiStore()
    const w = mountShell()
    ui.panelOff.gantt = true
    await nextTick()
    expect(clipOf(w)).toBe('clip')

    ui.panelOff.gantt = false
    await nextTick()
    expect(clipOf(w)).toBe('clip')

    // 內容裡別的屬性 / 別的元素冒泡上來的 transitionend 不算
    await w.find('.panel-body').trigger('transitionend')
    w.find('.panel-body').element.dispatchEvent(transitionEnd('opacity'))
    w.find('.content').element.dispatchEvent(transitionEnd('grid-template-rows', true))
    await nextTick()
    expect(clipOf(w)).toBe('clip')

    w.find('.panel-body').element.dispatchEvent(transitionEnd('grid-template-rows'))
    await nextTick()
    expect(clipOf(w)).toBe('visible')
  })

  it('transitionend 沒來（過渡被打斷、沒有過渡）時，保險計時器到了也放行', async () => {
    const ui = useUiStore()
    const w = mountShell()
    ui.panelOff.gantt = true
    await nextTick()
    ui.panelOff.gantt = false
    await nextTick()
    expect(clipOf(w)).toBe('clip')

    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(clipOf(w)).toBe('visible')
  })

  it('展開途中又收合：保險計時器不會把收合中的面板放行', async () => {
    const ui = useUiStore()
    const w = mountShell()
    ui.panelOff.gantt = true
    await nextTick()
    ui.panelOff.gantt = false
    await nextTick()
    ui.panelOff.gantt = true
    await nextTick()

    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(clipOf(w)).toBe('clip')
  })
})
