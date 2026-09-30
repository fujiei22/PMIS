import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { useScrollLock } from '@/composables/useScrollLock'

/** 掛一個只呼叫 useScrollLock 的元件。 */
function host(initial = false): { locked: Ref<boolean>; unmount: () => void } {
  const locked = ref(initial)
  const w = mount(
    defineComponent({
      setup() {
        useScrollLock(locked)
        return () => h('div')
      },
    }),
  )
  return { locked, unmount: () => w.unmount() }
}

const undo: (() => void)[] = []
/** 暫時改寫 jsdom 固定的版面屬性，afterEach 還原。 */
function stub(obj: object, key: string, value: number): void {
  const own = Object.getOwnPropertyDescriptor(obj, key)
  Object.defineProperty(obj, key, { configurable: true, value })
  undo.push(() =>
    own ? Object.defineProperty(obj, key, own) : delete (obj as Record<string, unknown>)[key],
  )
}

let scrollTo: MockInstance
const mounted: (() => void)[] = []
function use(initial = false): Ref<boolean> {
  const { locked, unmount } = host(initial)
  mounted.push(unmount)
  return locked
}

beforeEach(() => {
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  // 有 15px 實體捲軸
  stub(window, 'innerWidth', 1015)
  stub(document.documentElement, 'clientWidth', 1000)
})

afterEach(() => {
  while (mounted.length) mounted.pop()!()
  while (undo.length) undo.pop()!()
  vi.restoreAllMocks()
  document.body.style.cssText = ''
})

describe('useScrollLock', () => {
  it('鎖：先停平滑捲動，body 不能捲、補上捲軸寬', async () => {
    const locked = use()
    locked.value = true
    await nextTick()
    expect(scrollTo).toHaveBeenCalledWith({
      top: window.scrollY,
      left: window.scrollX,
      behavior: 'instant',
    })
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.paddingRight).toBe('15px')
  })

  it('解鎖：還原成鎖之前的 inline 值，不捲回去', async () => {
    document.body.style.paddingRight = '3px'
    const locked = use()
    locked.value = true
    await nextTick()
    locked.value = false
    await nextTick()
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.paddingRight).toBe('3px')
    // 只有鎖的時候停了一次平滑捲動，解鎖沒有再捲
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('沒有實體捲軸（平板、隱藏捲軸）時不補空白', async () => {
    stub(window, 'innerWidth', 1000)
    const locked = use()
    locked.value = true
    await nextTick()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.paddingRight).toBe('')
  })

  it('兩個使用者同時鎖：兩個都放開才解鎖', async () => {
    const a = use(true)
    const b = use(true)
    await nextTick()
    a.value = false
    await nextTick()
    expect(document.body.style.overflow).toBe('hidden')
    b.value = false
    await nextTick()
    expect(document.body.style.overflow).toBe('')
  })

  it('鎖著的元件卸載時會放開', async () => {
    const { unmount } = host(true)
    await nextTick()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
