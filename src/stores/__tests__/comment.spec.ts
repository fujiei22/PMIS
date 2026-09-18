import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
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
    expect(files.map((f) => f.id)).toEqual(['c3:0', 'c3:1', 'c1:0'])
    expect(files[0].name).toBe('component-checklist.xlsx')
    expect(files[0].by).toBe('成員2')
    expect(files[2].by).toBe('成員1')
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
    expect(rows[0].text).toBe('新留言')
    expect(rows[0].memberId).toBe('m1')
    expect(rows[0].targetKind).toBe('task')
    expect(rows[0].files.map((f) => f.name)).toEqual(['a.txt'])
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
})
