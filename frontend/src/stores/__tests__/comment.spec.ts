import { createPinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mockApi as maybeMockApi } from '@/api'
import { useProjectBoot } from '@/composables/useProjectBoot'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useUiStore } from '@/stores/ui'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('commentStore', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    mockApi.reset(structuredClone(sampleProject))
    useClockStore().now = NOW
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // boot 負責 error sink，也把派生層的清理 watch 掛好（契約 E）
    await useProjectBoot().reload()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('初始值為契約 D 列的預設', () => {
    const c = useCommentStore()
    expect(c.comments).toHaveLength(5)
    expect(c.draft).toBe('')
    expect(c.draftFiles).toEqual([])
    expect(c.dateFrom).toBe('')
    expect(c.dateTo).toBe('')
    expect(c.memberIds).toEqual([])
    expect(c.tab).toBe('comments')
    expect(c.fileView).toBe('icon')
    expect(c.fileSel).toEqual([])
  })

  it('forTarget 以 at 倒序回該目標的留言', () => {
    const c = useCommentStore()
    expect(c.forTarget('t1').map((x) => x.id)).toEqual(['c3', 'c2', 'c1'])
    expect(c.forTarget('t2').map((x) => x.id)).toEqual(['c4'])
    expect(c.forTarget('t30')).toEqual([])
  })

  it('forTarget 套日期與成員篩選', () => {
    const c = useCommentStore()
    c.dateFrom = '2026-09-09'
    expect(c.forTarget('t1').map((x) => x.id)).toEqual(['c3', 'c2'])
    c.dateTo = '2026-09-09'
    expect(c.forTarget('t1').map((x) => x.id)).toEqual(['c2'])
    c.dateFrom = ''
    c.dateTo = ''
    c.memberIds = ['m2']
    expect(c.forTarget('t1').map((x) => x.id)).toEqual(['c3'])
  })

  it('filesForTarget 給 comment.id:index 的 id 並倒序', () => {
    const c = useCommentStore()
    const files = c.filesForTarget('t1')
    // 同一天的兩個檔案誰先誰後不保證（沿用 legacy 的比較函式，相等時不回 0），
    // 所以只斷言 id 的組成與「新的在前」。
    expect(files.map((f) => f.id).sort()).toEqual(['c1:0', 'c3:0', 'c3:1'])
    expect(files.slice(0, 2).map((f) => f.at)).toEqual(['2026-09-11', '2026-09-11'])
    expect(files[0]!.by).toBe('成員2')
    expect(files[2]!.id).toBe('c1:0')
    expect(files[2]!.name).toBe('nav-spec-v3.png')
    expect(files[2]!.by).toBe('成員1')
  })

  it('commenterIds 只回在這個目標留過言的人', () => {
    const c = useCommentStore()
    expect(c.commenterIds('t1')).toEqual(['m1', 'm3', 'm2'])
    expect(c.commenterIds('t2')).toEqual(['m4'])
  })

  it('send 用 currentUserId、插到最前、清 draft', () => {
    const c = useCommentStore()
    c.draft = '  新留言  '
    c.addDraftFiles([{ name: 'a.txt', size: 12 } as unknown as File])
    c.send('t1', 'task')
    const rows = c.forTarget('t1')
    expect(rows[0]!.text).toBe('新留言')
    expect(rows[0]!.memberId).toBe('m1')
    expect(rows[0]!.targetKind).toBe('task')
    expect(rows[0]!.files.map((f) => f.name)).toEqual(['a.txt'])
    expect(c.draft).toBe('')
    expect(c.draftFiles).toEqual([])
  })

  it('send 在草稿全空時不送出', () => {
    const c = useCommentStore()
    c.draft = '   '
    c.send('t1', 'task')
    expect(c.forTarget('t1')).toHaveLength(3)
  })

  it('addDraftFiles / removeDraft / resetDraft', () => {
    const c = useCommentStore()
    c.addDraftFiles([{ name: 'a.txt', size: 1 } as unknown as File, { name: 'b.txt', size: 2 } as unknown as File])
    expect(c.draftFiles.map((f) => f.name)).toEqual(['a.txt', 'b.txt'])
    c.removeDraft(0)
    expect(c.draftFiles.map((f) => f.name)).toEqual(['b.txt'])
    c.draft = '打到一半'
    c.resetDraft()
    expect(c.draft).toBe('')
    expect(c.draftFiles).toEqual([])
  })

  it('remove 刪掉一則留言', () => {
    const c = useCommentStore()
    c.remove('c2')
    expect(c.forTarget('t1').map((x) => x.id)).toEqual(['c3', 'c1'])
  })

  // review M5：id 用 'c' + Date.now() 時，固定時鐘下兩則留言同 id，刪一則會連帶刪掉另一則。
  it('固定時鐘下連送兩則留言，id 不同且只刪得掉其中一則', () => {
    const c = useCommentStore()
    c.draft = '第一則'
    c.send('t1', 'task')
    c.draft = '第二則'
    c.send('t1', 'task')

    const rows = c.forTarget('t1')
    const ids = rows.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)

    const first = rows.find((x) => x.text === '第一則')!
    c.remove(first.id)
    const left = c.forTarget('t1').map((x) => x.text)
    expect(left).toContain('第二則')
    expect(left).not.toContain('第一則')
  })

  // review m1：貼圖建的 blob url 一直沒 revoke，換任務 / 移掉附件都在漏記憶體。
  describe('blob url 釋放', () => {
    let created: string[]
    let revoked: string[]

    beforeEach(() => {
      created = []
      revoked = []
      let n = 0
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        const u = 'blob:mock/' + ++n
        created.push(u)
        return u
      })
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
        revoked.push(u)
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    /** 造一個會被當成圖片的 File 替身。 */
    const img = (name: string) => ({ name, size: 10, type: 'image/png' }) as unknown as File

    it('removeDraft 釋放被移掉那個附件的 url', () => {
      const c = useCommentStore()
      c.addDraftFiles([img('a.png'), img('b.png')])
      expect(created).toHaveLength(2)

      c.removeDraft(0)
      expect(revoked).toEqual([created[0]])
      expect(c.draftFiles.map((f) => f.name)).toEqual(['b.png'])
    })

    it('resetDraft 釋放草稿裡所有附件的 url', () => {
      const c = useCommentStore()
      c.addDraftFiles([img('a.png'), img('b.png')])
      c.resetDraft()
      expect(revoked.sort()).toEqual([...created].sort())
      expect(c.draftFiles).toEqual([])
    })

    it('沒有 url 的附件不會呼叫 revokeObjectURL', () => {
      const c = useCommentStore()
      c.addDraftFiles([{ name: 'a.txt', size: 1 } as unknown as File])
      c.removeDraft(0)
      c.resetDraft()
      expect(revoked).toEqual([])
    })

    it('送出留言後不 revoke，留言列表還要用那個 url 顯示縮圖', () => {
      const c = useCommentStore()
      c.addDraftFiles([img('a.png')])
      c.draft = '帶圖'
      c.send('t1', 'task')
      expect(revoked).toEqual([])
      expect(c.forTarget('t1')[0]!.files[0]!.url).toBe(created[0])
    })
  })

  // review M1：legacy :2186-2188 用 getFullYear/getMonth/getDate，日期與時分必須同一個本地時鐘。
  describe('固定在 Asia/Taipei（UTC+8）的留言時間戳', () => {
    const origin = process.env.TZ
    beforeAll(() => {
      process.env.TZ = 'Asia/Taipei'
    })
    afterAll(() => {
      process.env.TZ = origin
    })

    it('UTC+8 早上 07:00 送出的留言標成當天，不是前一天', () => {
      // 2026-09-19T07:00+08:00 === 2026-09-18T23:00Z
      const c = useCommentStore()
      useClockStore().now = Date.parse('2026-09-18T23:00:00Z')
      c.draft = '早上留言'
      c.addDraftFiles([{ name: 'a.txt', size: 1 } as unknown as File])
      c.send('t1', 'task')
      const row = c.forTarget('t1')[0]!
      expect(row.at).toBe('2026-09-19T07:00')
      expect(row.files[0]!.at).toBe('2026-09-19')
    })

    it('UTC+8 深夜 23:30 送出的留言標成當天，不是隔天', () => {
      // 2026-09-19T23:30+08:00 === 2026-09-19T15:30Z
      const c = useCommentStore()
      useClockStore().now = Date.parse('2026-09-19T15:30:00Z')
      c.draft = '深夜留言'
      c.addDraftFiles([{ name: 'b.txt', size: 1 } as unknown as File])
      c.send('t1', 'task')
      const row = c.forTarget('t1')[0]!
      expect(row.at).toBe('2026-09-19T23:30')
      expect(row.files[0]!.at).toBe('2026-09-19')
    })
  })

  // ── 樂觀更新（契約 B / review C2）────────────────────────────────────────
  describe('經 api 的樂觀更新', () => {
    /** 造一個會被當成圖片的 File 替身。 */
    const img = (name: string) => ({ name, size: 10, type: 'image/png' }) as unknown as File

    it('send 走 api.createComment 並把原始 File 一起送出', async () => {
      const c = useCommentStore()
      const spy = vi.spyOn(api, 'createComment')
      const file = { name: 'a.txt', size: 3, type: 'text/plain' } as unknown as File
      c.addDraftFiles([file])
      c.draft = '帶檔案'
      await c.send('t1', 'task')

      expect(spy).toHaveBeenCalledTimes(1)
      const [comment, files] = spy.mock.calls[0]!
      expect(comment.text).toBe('帶檔案')
      expect(files).toEqual([file])
      expect(comment.files[0]!.id).toBe(`${comment.id}:0`)
    })

    it('response 換掉 blob url 時 revoke 舊值（review M13）', async () => {
      const c = useCommentStore()
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock/1')
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      vi.spyOn(api, 'createComment').mockImplementation(async (comment) => ({
        ...comment,
        files: comment.files.map((f) => ({ ...f, url: `https://server/files/${f.id}` })),
      }))

      c.addDraftFiles([img('a.png')])
      c.draft = '帶圖'
      await c.send('t1', 'task')

      const row = c.forTarget('t1')[0]!
      expect(row.files[0]!.url).toBe(`https://server/files/${row.id}:0`)
      expect(revoke).toHaveBeenCalledWith('blob:mock/1')
    })

    it('send 失敗 → 留言被收回並推一筆錯誤', async () => {
      const c = useCommentStore()
      mockApi.failNext('createComment')
      c.draft = '送不出去'
      await c.send('t1', 'task')
      expect(c.forTarget('t1').map((x) => x.text)).not.toContain('送不出去')
      expect(useUiStore().errors[0]!.label).toBe('送出留言')
    })

    // review F6：送不出去不能連草稿一起吃掉
    it('send 失敗 → 草稿的文字與附件回來，blob url 不被 revoke', async () => {
      const c = useCommentStore()
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock/1')
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      mockApi.failNext('createComment')
      c.addDraftFiles([img('a.png')])
      c.draft = '送不出去'
      await c.send('t1', 'task')

      expect(c.draft).toBe('送不出去')
      expect(c.draftFiles.map((f) => f.name)).toEqual(['a.png'])
      expect(c.draftFiles[0]!.url).toBe('blob:mock/1')
      expect(revoke).not.toHaveBeenCalled()
    })

    it('send 失敗但使用者已經開始打新的字 → 不蓋掉新草稿', async () => {
      const c = useCommentStore()
      mockApi.setLatency(5)
      mockApi.failNext('createComment')
      c.draft = '送不出去'
      const pending = c.send('t1', 'task')
      c.draft = '新打的字'
      await pending
      mockApi.setLatency(0)
      expect(c.draft).toBe('新打的字')
    })

    it('remove 走 api.deleteComment，失敗時留言回來', async () => {
      const c = useCommentStore()
      const spy = vi.spyOn(api, 'deleteComment')
      await c.remove('c2')
      expect(spy).toHaveBeenCalledWith('c2')
      expect(c.forTarget('t1').map((x) => x.id)).toEqual(['c3', 'c1'])

      mockApi.failNext('deleteComment')
      await c.remove('c1')
      expect(c.forTarget('t1').map((x) => x.id)).toEqual(['c3', 'c1'])
      expect(useUiStore().errors[0]!.label).toBe('刪除留言')
    })
  })

  describe('applyEvent', () => {
    it('comment.created / comment.deleted', () => {
      const c = useCommentStore()
      c.applyEvent({
        type: 'comment.created',
        payload: {
          id: 'cX',
          targetId: 't1',
          targetKind: 'task',
          memberId: 'm2',
          at: '2026-09-18T11:00',
          text: '別人留的',
          files: [],
        },
      })
      expect(c.forTarget('t1')[0]!.text).toBe('別人留的')
      c.applyEvent({ type: 'comment.deleted', payload: { id: 'cX' } })
      expect(c.forTarget('t1').some((x) => x.id === 'cX')).toBe(false)
    })
  })
})