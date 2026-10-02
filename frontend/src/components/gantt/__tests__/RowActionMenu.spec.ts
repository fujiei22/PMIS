import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import RowActionMenu from '@/components/gantt/RowActionMenu.vue'
import { EDIT_BLOCK_TEXT, OVERDUE_SHRINK_TEXT } from '@/constants/dashboard'
import { sampleProject } from '@/mocks/sampleProject'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { ProjectData } from '@/types/models'

/**
 * 甘特列「⋮」選單的工期 −1 / +1（規則見 docs/reference/scheduling.md〈有效工期〉）：
 * 跟看板卡片的 ▲▼ 同一套規則；選單有位置，停用原因除了 title 也寫成看得見的一行（觸控看不到 title）。
 * 範例在 2026-09-18 推算。
 */

let update: MockInstance

/** 掛上選單並打開某個任務的。 */
async function openMenu(id: string): Promise<VueWrapper> {
  const w = mount(RowActionMenu)
  useUiStore().rowMenu = { id, left: 0, top: 0 }
  await nextTick()
  return w
}

/** −1 與 +1。 */
function steps(w: VueWrapper) {
  const [down, up] = w.findAll('.rm-step')
  return { down: down!, up: up! }
}

beforeEach(async () => {
  await loadSample()
  update = vi.spyOn(useTaskStore(), 'updateTask').mockResolvedValue()
})

describe('RowActionMenu 的工期', () => {
  it('按鈕寫「−1」「+1」，中間是「N 工作天」，title 註明工期是工作天', async () => {
    const w = await openMenu('t5')
    const { down, up } = steps(w)
    expect(down.text()).toBe('−1')
    expect(up.text()).toBe('+1')
    expect(w.find('.rm-days').text()).toBe('7 工作天')
    expect(w.find('.rm-stepper').attributes('title')).toBe('工期（工作天）')
    expect(w.find('.rm-note').exists()).toBe(false)
  })

  it('t5（未開始、工期 7）：+1 送工期 8、−1 送工期 6', async () => {
    const { down, up } = steps(await openMenu('t5'))
    await up.trigger('click')
    expect(update).toHaveBeenLastCalledWith('t5', { duration: 8 })
    await down.trigger('click')
    expect(update).toHaveBeenLastCalledWith('t5', { duration: 6 })
  })

  it('t3（逾期）：顯示有效工期 9，+1 送 10；−1 停用，說明逾期中', async () => {
    const w = await openMenu('t3')
    const { down, up } = steps(w)
    expect(w.find('.rm-days').text()).toBe('9 工作天')
    await up.trigger('click')
    expect(update).toHaveBeenLastCalledWith('t3', { duration: 10 })
    expect(down.attributes('disabled')).toBeDefined()
    expect(down.attributes('title')).toBe(OVERDUE_SHRINK_TEXT)
    expect(w.find('.rm-note').text()).toBe(OVERDUE_SHRINK_TEXT)
  })

  it('已完成的 t2：−1 / +1 都停用，說明結束日就是完成日', async () => {
    const w = await openMenu('t2')
    const { down, up } = steps(w)
    for (const s of [down, up]) {
      expect(s.attributes('disabled')).toBeDefined()
      expect(s.attributes('title')).toBe(EDIT_BLOCK_TEXT.done)
    }
    expect(w.find('.rm-note').text()).toBe(EDIT_BLOCK_TEXT.done)
  })

  it('工期到上限 3650：+1 停用', async () => {
    const data: ProjectData = structuredClone(sampleProject)
    data.tasks.find((t) => t.id === 't24')!.duration = 3650
    await loadSample({ data })
    const { down, up } = steps(await openMenu('t24'))
    expect(up.attributes('disabled')).toBeDefined()
    expect(down.attributes('disabled')).toBeUndefined()
  })
})
