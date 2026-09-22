import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditDraft, type EditDraft } from '@/composables/useEditDraft'
import { useUiStore } from '@/stores/ui'

/**
 * 掛一個最小宿主元件：本地值放在 ref，commit 由測試決定成功或失敗。
 * `commit` 模擬 `runOptimistic` 的行為——永不 throw，失敗時把本地還原成 server 值。
 */
function mountDraft(
  commit: (v: string) => Promise<void>,
  editingId: () => string | null = () => 't1',
): {
  draft: EditDraft
  local: { value: string }
  unmount: () => void
} {
  const local = ref('server')
  let draft!: EditDraft
  const Host = defineComponent({
    setup() {
      draft = useEditDraft({
        get: () => local.value,
        applyLocal: (v) => {
          local.value = v
        },
        commit,
        editingId,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { draft, local, unmount: () => wrapper.unmount() }
}

describe('useEditDraft', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('每一鍵立即改本地，api 只在最後一鍵之後 300ms 送一次', async () => {
    const commit = vi.fn(async () => {})
    const { draft, local, unmount } = mountDraft(commit)

    draft.onInput('a')
    draft.onInput('ab')
    draft.onInput('abc')
    expect(local.value).toBe('abc')
    expect(commit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(299)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('abc')
    unmount()
  })

  it('flush 立刻送出還沒送的那一次；沒有變更時不送', async () => {
    const commit = vi.fn(async () => {})
    const { draft, unmount } = mountDraft(commit)

    draft.onInput('ab')
    await draft.flush()
    expect(commit).toHaveBeenCalledTimes(1)

    await draft.flush()
    expect(commit).toHaveBeenCalledTimes(1)
    // 已經 flush 過，debounce 到期不該再送一次
    vi.advanceTimersByTime(300)
    expect(commit).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('cancel 之後 debounce 不再送出', () => {
    const commit = vi.fn(async () => {})
    const { draft, unmount } = mountDraft(commit)
    draft.onInput('ab')
    draft.cancel()
    vi.advanceTimersByTime(300)
    expect(commit).not.toHaveBeenCalled()
    unmount()
  })

  it('commit 失敗（本地被還原）→ 結束編輯狀態', async () => {
    const ui = useUiStore()
    ui.editing = { kind: 't', id: 't1' }
    let onCommit: (v: string) => Promise<void> = async () => {}
    const mounted = mountDraft((v) => onCommit(v))
    // runOptimistic 失敗時做的事：把本地放回 server 值
    onCommit = async () => {
      mounted.local.value = 'server'
    }

    mounted.draft.onInput('打到一半')
    await mounted.draft.flush()

    expect(mounted.local.value).toBe('server')
    expect(ui.editing).toBeNull()
    mounted.unmount()
  })

  it('飛行途中又打字：對齊回送出的值之後，最新草稿會被放回本地', async () => {
    const ui = useUiStore()
    ui.editing = { kind: 't', id: 't1' }
    let release: () => void = () => {}
    const mounted = mountDraft(
      (v: string) =>
        new Promise<void>((resolve) => {
          release = () => {
            // 回應對齊：本地變成送出的值
            mounted.local.value = v
            resolve()
          }
        }),
    )

    mounted.draft.onInput('ab')
    const flushing = mounted.draft.flush()
    mounted.draft.onInput('abc')
    release()
    await flushing

    expect(mounted.local.value).toBe('abc')
    expect(ui.editing).not.toBeNull()
    mounted.unmount()
  })

  // review F7：失敗還原只該關掉「自己」那個編輯框
  it('commit 失敗但編輯中的是別筆 → 不動 ui.editing', async () => {
    const ui = useUiStore()
    ui.editing = { kind: 't', id: '別筆' }
    let onCommit: (v: string) => Promise<void> = async () => {}
    const mounted = mountDraft((v) => onCommit(v), () => 't1')
    onCommit = async () => {
      mounted.local.value = 'server'
    }

    mounted.draft.onInput('打到一半')
    await mounted.draft.flush()

    expect(ui.editing).toEqual({ kind: 't', id: '別筆' })
    mounted.unmount()
  })

  it('不擁有 editing 的欄位（editingId 回 null）失敗時不清 ui.editing', async () => {
    const ui = useUiStore()
    ui.editing = { kind: 'i', id: 'i1' }
    let onCommit: (v: string) => Promise<void> = async () => {}
    const mounted = mountDraft((v) => onCommit(v), () => null)
    onCommit = async () => {
      mounted.local.value = 'server'
    }

    mounted.draft.onInput('打到一半')
    await mounted.draft.flush()

    expect(ui.editing).toEqual({ kind: 'i', id: 'i1' })
    mounted.unmount()
  })

  it('卸載時把還沒送的草稿送出去', async () => {
    const commit = vi.fn(async () => {})
    const { draft, unmount } = mountDraft(commit)
    draft.onInput('ab')
    unmount()
    expect(commit).toHaveBeenCalledWith('ab')
  })
})
