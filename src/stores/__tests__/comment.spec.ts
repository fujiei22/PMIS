import { createPinia, setActivePinia } from 'pinia'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sampleProject } from '@/mocks/sampleProject'
import { useCommentStore } from '@/stores/comment'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('commentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUiStore().now = NOW
    useTaskStore().load(structuredClone(sampleProject))
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
      useUiStore().now = Date.parse('2026-09-18T23:00:00Z')
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
      useUiStore().now = Date.parse('2026-09-19T15:30:00Z')
      c.draft = '深夜留言'
      c.addDraftFiles([{ name: 'b.txt', size: 1 } as unknown as File])
      c.send('t1', 'task')
      const row = c.forTarget('t1')[0]!
      expect(row.at).toBe('2026-09-19T23:30')
      expect(row.files[0]!.at).toBe('2026-09-19')
    })
  })
})
