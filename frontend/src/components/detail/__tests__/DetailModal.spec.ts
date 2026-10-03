import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSampleCalendar } from '@/__tests__/loadSample'
import DetailHeader from '@/components/detail/DetailHeader.vue'
import DetailModal from '@/components/detail/DetailModal.vue'
import { sampleProject } from '@/mocks/sampleProject'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 詳情標題的 debounce 送出（review：改用 Transition 之後，關閉或換筆時 commit 讀到的已經是新的 detail）。
 * 平板點遮罩不會 blur，打字後 300ms 內關閉或切到別筆，草稿仍要送回打字的那一筆。
 */

let w: VueWrapper | null = null

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  useSampleCalendar()
  useTaskStore().load(structuredClone(sampleProject))
  // 詳情開著會鎖捲動（useScrollLock 先停平滑捲動），jsdom 沒有 scrollTo
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  w?.unmount()
  w = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 開 t3 的詳情、掛上 DetailModal（子元件 stub），在標題打字。 */
function typeTitleOnT3(v: string): void {
  useUiStore().openDetail('t3', 'task')
  w = mount(DetailModal, { shallow: true })
  w.findComponent(DetailHeader).vm.$emit('update:name', v)
  // 本地逐鍵立即生效；api 等 debounce
  expect(useTaskStore().taskById('t3')!.name).toBe(v)
}

describe('DetailModal 標題草稿', () => {
  it('改名後 300ms 內關閉：仍送到原任務', async () => {
    const commit = vi.spyOn(useTaskStore(), 'commitTaskPatch').mockResolvedValue()
    typeTitleOnT3('新名字')
    useUiStore().closeDetail()
    await nextTick()
    // 關閉的當下就送出，不等 debounce
    expect(commit).toHaveBeenCalledWith('t3', { name: '新名字' })
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    // debounce 到期不會再送一次
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('改名後 300ms 內換到別筆 Issue：仍送到原任務，不動 Issue', async () => {
    const commit = vi.spyOn(useTaskStore(), 'commitTaskPatch').mockResolvedValue()
    const commitIssue = vi.spyOn(useIssueStore(), 'commitIssuePatch').mockResolvedValue()
    typeTitleOnT3('新名字')
    useUiStore().openDetail('i1', 'issue', 't3')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    expect(commit).toHaveBeenCalledWith('t3', { name: '新名字' })
    expect(commitIssue).not.toHaveBeenCalled()
  })
})
