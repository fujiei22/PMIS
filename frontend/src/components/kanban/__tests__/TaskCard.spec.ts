import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import TaskCard from '@/components/kanban/TaskCard.vue'
import { EDIT_BLOCK_TEXT, OVERDUE_SHRINK_TEXT } from '@/constants/dashboard'
import { sampleProject } from '@/mocks/sampleProject'
import { useTaskStore } from '@/stores/task'
import type { ProjectData } from '@/types/models'

/**
 * 看板卡片的工期 ▲▼（規則見 docs/reference/scheduling.md〈有效工期〉）：
 * 以有效工期（工作天）加減一，送 `{ duration }`；逾期時 ▼ 停用（結束日最早是今天）、
 * 已完成兩顆都停用（結束日就是完成日）、工期限制在 1–3650。範例在 2026-09-18 推算。
 */

/** 掛一張卡；task 用 store 推算後的值（跟看板傳進來的一樣）。 */
function mountCard(id: string): VueWrapper {
  return mount(TaskCard, { props: { task: useTaskStore().taskById(id)! } })
}

/** ▲ 與 ▼。 */
function steps(w: VueWrapper) {
  const [up, down] = w.findAll('.step')
  return { up: up!, down: down! }
}

let update: MockInstance

/** 換一份範例資料重載（改某幾個任務的工期），再把 updateTask 換成 spy。 */
async function reloadWith(patch: Record<string, number>): Promise<void> {
  const data: ProjectData = structuredClone(sampleProject)
  for (const t of data.tasks) if (t.id in patch) t.duration = patch[t.id]!
  await loadSample({ data })
  update = vi.spyOn(useTaskStore(), 'updateTask').mockResolvedValue()
}

beforeEach(async () => {
  await loadSample()
  update = vi.spyOn(useTaskStore(), 'updateTask').mockResolvedValue()
})

describe('TaskCard 的工期 ▲▼', () => {
  it('t5（未開始、工期 7）：▲ 送工期 8、▼ 送工期 6', async () => {
    const { up, down } = steps(mountCard('t5'))
    await up.trigger('click')
    expect(update).toHaveBeenLastCalledWith('t5', { duration: 8 })
    await down.trigger('click')
    expect(update).toHaveBeenLastCalledWith('t5', { duration: 6 })
  })

  it('t3（逾期）：▲ 以有效工期 9 加一送 10；▼ 停用，說明逾期中', async () => {
    const { up, down } = steps(mountCard('t3'))
    await up.trigger('click')
    expect(update).toHaveBeenLastCalledWith('t3', { duration: 10 })
    expect(down.attributes('aria-disabled')).toBe('true')
    expect(down.attributes('title')).toBe(OVERDUE_SHRINK_TEXT)
    update.mockClear()
    await down.trigger('click')
    expect(update).not.toHaveBeenCalled()
  })

  it('已完成的 t2：▲▼ 都停用，說明結束日就是完成日', async () => {
    const { up, down } = steps(mountCard('t2'))
    for (const s of [up, down]) {
      expect(s.attributes('aria-disabled')).toBe('true')
      expect(s.attributes('title')).toBe(EDIT_BLOCK_TEXT.done)
      await s.trigger('click')
    }
    expect(update).not.toHaveBeenCalled()
  })

  it('工期到上限 3650：▲ 停用；只剩 1 工作天：▼ 停用', async () => {
    await reloadWith({ t24: 3650, t30: 1 })
    expect(steps(mountCard('t24')).up.attributes('aria-disabled')).toBe('true')
    expect(steps(mountCard('t24')).down.attributes('aria-disabled')).toBeUndefined()
    expect(steps(mountCard('t30')).down.attributes('aria-disabled')).toBe('true')
    expect(steps(mountCard('t30')).up.attributes('aria-disabled')).toBeUndefined()
    await steps(mountCard('t24')).up.trigger('click')
    await steps(mountCard('t30')).down.trigger('click')
    expect(update).not.toHaveBeenCalled()
  })

  it('數字是有效工期；帶單位的完整說法放 aria-label，title 註明是工作天', () => {
    const w = mountCard('t3')
    expect(w.find('.days-num').text()).toBe('9')
    expect(w.find('.days-num').attributes('aria-label')).toBe('9 工作天')
    expect(w.find('.range-days').attributes('title')).toBe('工期（工作天）')
  })
})

describe('TaskCard 的重繪範圍', () => {
  it('改別的任務不會讓這張卡重繪（policy 沒變就沿用同一個物件）', async () => {
    const s = useTaskStore()
    let updates = 0
    // hook 放在 setup 裡只建一次：taskById 讀的索引每次重算都是新的 Map，Host 一定會重跑 render，
    // 每次 render 都建新函式的話 prop 一定「變了」，量到的是 Host 的重繪而不是卡片自己的
    const Host = defineComponent({
      setup: () => {
        const onVnodeUpdated = () => {
          updates++
        }
        return () => h(TaskCard, { task: s.taskById('t3')!, onVnodeUpdated })
      },
    })
    mount(Host)
    s.applyLocalPatch('t24', { name: '改名' })
    await nextTick()
    expect(updates).toBe(0)
  })
})
