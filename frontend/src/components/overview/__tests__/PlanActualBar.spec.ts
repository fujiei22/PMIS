/**
 * 實際 / 理論合一進度條 PlanActualBar 的測試。
 *
 * 測什麼：落後與超前時填色寬度、落差段的位置與色調、▼理論 / ▲實際游標的文字；
 * 0% / 100% 時標籤的位移；progressbar 的無障礙數值。
 * 為什麼：填色只到兩者較小的那端、落差段補上中間，落後 / 超前兩種方向算法相反，
 * 兩端的標籤位移要跟著百分比走才不會超出條外。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlanActualBar from '@/components/overview/PlanActualBar.vue'

describe('PlanActualBar', () => {
  it('落後：填到實際，實際→理論畫紅斜紋段', () => {
    const w = mount(PlanActualBar, { props: { actual: 40, planned: 70, tone: 'late' } })
    const fill = w.find('.fill')
    expect(fill.classes()).toContain('fill-late')
    expect(fill.attributes('style')).toContain('width: 40%')
    const seg = w.find('.gap-seg')
    expect(seg.classes()).toContain('gap-behind')
    expect(seg.attributes('style')).toContain('left: 40%; width: 30%')
    expect(w.find('.pin-plan').text()).toBe('理論 70%')
    expect(w.find('.pin-act').text()).toBe('實際 40%')
  })

  it('超前：填到理論，理論→實際畫綠段；100% 的標籤往左貼齊、0% 不位移', () => {
    const w = mount(PlanActualBar, { props: { actual: 100, planned: 0, tone: 'doing' } })
    expect(w.find('.fill').attributes('style')).toContain('width: 0%')
    const seg = w.find('.gap-seg')
    expect(seg.classes()).toContain('gap-ahead')
    expect(seg.attributes('style')).toContain('left: 0%; width: 100%')
    expect(w.find('.pin-act .pin-label').attributes('style')).toContain('translateX(-100%)')
    expect(w.find('.pin-plan .pin-label').attributes('style')).toContain('translateX(-0%)')
  })

  it('progressbar 帶實際值與實際 / 理論文字', () => {
    const w = mount(PlanActualBar, { props: { actual: 62, planned: 75, tone: 'paused' } })
    const bar = w.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('62')
    expect(bar.attributes('aria-valuetext')).toBe('實際 62%，理論 75%')
  })
})
