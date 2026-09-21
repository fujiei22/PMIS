import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import FilesTab from '@/components/detail/FilesTab.vue'
import { sampleProject } from '@/mocks/sampleProject'
import { useCommentStore } from '@/stores/comment'
import { useTaskStore } from '@/stores/task'

/**
 * 下載的兩條路（review DX 19）：附件帶 url 就直接開，沒有 url 才跟 api 要 Blob。
 * 元件內不再自己造 demo Blob——那份假內容已經搬到 api mock（`downloadAttachment`）。
 */

/** jsdom 沒有 createObjectURL / revokeObjectURL，補上可觀察的替身。 */
function stubObjectUrl(): { created: Blob[]; revoked: string[] } {
  const created: Blob[] = []
  const revoked: string[] = []
  URL.createObjectURL = vi.fn((b: Blob) => {
    created.push(b)
    return `blob:stub/${created.length}`
  }) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u))
  return { created, revoked }
}

/** 攔下 <a>.click()，記下每次下載用的 href / download。 */
function stubAnchorClick(): { href: string; download: string }[] {
  const hits: { href: string; download: string }[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    hits.push({ href: this.href, download: this.download })
  })
  return hits
}

beforeEach(() => {
  setActivePinia(createPinia())
  useTaskStore().load(structuredClone(sampleProject))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FilesTab 下載', () => {
  it('附件有 url：直接開那個 url，不打 api', async () => {
    const comment = useCommentStore()
    comment.comments = [
      {
        id: 'cx',
        targetId: 'tx',
        targetKind: 'task',
        memberId: 'm1',
        at: '2026-09-20T10:00',
        text: '',
        files: [{ id: 'cx:0', name: 'has-url.png', size: 10, at: '2026-09-20', url: 'blob:has-url-1' }],
      },
    ]
    const spy = vi.spyOn(api, 'downloadAttachment')
    const hits = stubAnchorClick()

    const w = mount(FilesTab, { props: { targetId: 'tx' } })
    await w.find('.tile-dl').trigger('click')
    await flushPromises()

    expect(spy).not.toHaveBeenCalled()
    expect(hits).toEqual([{ href: 'blob:has-url-1', download: 'has-url.png' }])
  })

  it('附件沒有 url：跟 api 要 Blob 再下載', async () => {
    const comment = useCommentStore()
    comment.comments = [
      {
        id: 'cx',
        targetId: 'tx',
        targetKind: 'task',
        memberId: 'm1',
        at: '2026-09-20T10:00',
        text: '',
        files: [{ id: 'cx:0', name: 'no-url.pdf', size: 10, at: '2026-09-20' }],
      },
    ]
    const blob = new Blob(['x'], { type: 'text/plain' })
    const spy = vi.spyOn(api, 'downloadAttachment').mockResolvedValue(blob)
    const urls = stubObjectUrl()
    const hits = stubAnchorClick()

    const w = mount(FilesTab, { props: { targetId: 'tx' } })
    await w.find('.tile-dl').trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalledWith('cx:0')
    expect(urls.created).toEqual([blob])
    expect(hits).toEqual([{ href: 'blob:stub/1', download: 'no-url.pdf' }])
  })

  it('api 失敗不會炸掉畫面，只留 console.error', async () => {
    const comment = useCommentStore()
    comment.comments = [
      {
        id: 'cx',
        targetId: 'tx',
        targetKind: 'task',
        memberId: 'm1',
        at: '2026-09-20T10:00',
        text: '',
        files: [{ id: 'cx:0', name: 'no-url.pdf', size: 10, at: '2026-09-20' }],
      },
    ]
    vi.spyOn(api, 'downloadAttachment').mockRejectedValue(new Error('boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubObjectUrl()
    const hits = stubAnchorClick()

    const w = mount(FilesTab, { props: { targetId: 'tx' } })
    await w.find('.tile-dl').trigger('click')
    await flushPromises()

    expect(hits).toEqual([])
    expect(err).toHaveBeenCalled()
  })
})
