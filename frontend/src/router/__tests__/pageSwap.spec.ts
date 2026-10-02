import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isPageSwapping,
  notifyPageEntered,
  notifyPageSettled,
  onPageSettled,
  swapRestoresScroll,
  waitForPageSwap,
} from '@/router/pageSwap'

/**
 * 切頁協調（pageSwap）：捲動等新頁掛上才還原（spec 7b）；新頁的 setup 能問「是不是切頁進來、會不會還原捲動」，
 * 進場過渡跑完再通知一次（K1：Dashboard 等它才掛首屏外的面板）。模組層狀態，每條結束前都把等待中的切頁放掉。
 */
describe('pageSwap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    notifyPageEntered()
    vi.useRealTimers()
  })

  it('等待中是切頁進來；新頁掛上（enter）後就不是了', async () => {
    expect(isPageSwapping()).toBe(false)
    const done = waitForPageSwap()
    expect(isPageSwapping()).toBe(true)
    notifyPageEntered()
    await done
    expect(isPageSwapping()).toBe(false)
  })

  it('會還原到非 0 的捲動位置時 swapRestoresScroll 為真，掛上後清掉', async () => {
    const done = waitForPageSwap(2000, true)
    expect(swapRestoresScroll()).toBe(true)
    notifyPageEntered()
    await done
    expect(swapRestoresScroll()).toBe(false)
  })

  it('不還原捲動的切頁：swapRestoresScroll 為假', () => {
    void waitForPageSwap()
    expect(isPageSwapping()).toBe(true)
    expect(swapRestoresScroll()).toBe(false)
  })

  it('上一次還沒等到就又切頁：上一次先 resolve，restore 換成這一次的', async () => {
    const first = waitForPageSwap(2000, true)
    const second = waitForPageSwap(2000, false)
    await first
    expect(isPageSwapping()).toBe(true)
    expect(swapRestoresScroll()).toBe(false)
    notifyPageEntered()
    await second
    expect(isPageSwapping()).toBe(false)
  })

  it('過渡沒觸發：逾時 resolve，狀態一併清掉', async () => {
    const done = waitForPageSwap(500, true)
    vi.advanceTimersByTime(500)
    await done
    expect(isPageSwapping()).toBe(false)
    expect(swapRestoresScroll()).toBe(false)
  })

  it('onPageSettled 只在下一次進場結束叫一次；取消後不叫', () => {
    const a = vi.fn()
    const b = vi.fn()
    onPageSettled(a)
    const cancel = onPageSettled(b)
    cancel()
    notifyPageSettled()
    notifyPageSettled()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })
})
