import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mockApi as maybeMockApi } from '@/api'
import { useProjectBoot } from '@/composables/useProjectBoot'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/** 新實體的 id 是 UUID v4（spec 目標 4），只能斷言格式。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('issueStore', () => {
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

  it('load 後帶入 12 筆 Issue，byId / byTask / openCount 可查', () => {
    const s = useIssueStore()
    expect(s.issues).toHaveLength(12)
    expect(s.byId('i1')?.title).toBe('路由切換時狀態遺失')
    expect(s.byId('nope')).toBeUndefined()
    expect(s.byTask('t3').map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(s.openCount('t3')).toBe(2)
    // i7 掛在 t1 且已結案，不計入未結數
    expect(s.byTask('t1')).toHaveLength(1)
    expect(s.openCount('t1')).toBe(0)
  })

  // spec 目標 7：未結數改成一顆 Map computed，不再每張卡各掃一次全表
  it('openCounts 是一顆 Map computed，openCount 只查表', () => {
    const s = useIssueStore()
    expect(s.openCounts).toBeInstanceOf(Map)
    expect(s.openCounts.get('t3')).toBe(2)
    expect(s.openCounts.get('t1')).toBeUndefined()
    expect(s.openCount('t1')).toBe(0)
  })

  // 建立者的推導與「任務不存在」在 useTaskActions（契約 E），見 useTaskActions.spec
  it('addIssue 依傳進來的任務帶入預設值', () => {
    const s = useIssueStore()
    const task = useTaskStore().taskById('t3')!
    const i = s.addIssue(task, task.assigneeIds[0]!)
    expect(i.id).toMatch(UUID)
    expect(i.taskId).toBe('t3')
    expect(i.title).toBe('新 Issue（點擊可改名）')
    expect(i.item).toBe('F')
    expect(i.level).toBe('C')
    expect(i.status).toBe('open')
    expect(i.creatorId).toBe(task.assigneeIds[0])
    expect(i.ownerIds).toEqual(task.assigneeIds.slice(0, 1))
    expect(i.due).toBe(task.end)
    expect(i.created).toBe('2026-09-18')
  })

  it('updateIssue: status→closed 填 done、離開 closed 清 done', async () => {
    const s = useIssueStore()
    await s.updateIssue('i1', { status: 'closed' })
    expect(s.byId('i1')!.done).toBe('2026-09-18')
    await s.updateIssue('i1', { status: 'open' })
    expect(s.byId('i1')!.done).toBe('')
    await s.updateIssue('i1', { title: '改標題' })
    expect(s.byId('i1')!.title).toBe('改標題')
  })

  it('updateIssue 不覆蓋已填的 done', async () => {
    const s = useIssueStore()
    await s.updateIssue('i1', { done: '2026-09-10' })
    await s.updateIssue('i1', { status: 'closed' })
    expect(s.byId('i1')!.done).toBe('2026-09-10')
  })

  it('removeIssue 清 selection.issueId 與 ui.detail', async () => {
    const s = useIssueStore()
    const sel = useSelectionStore()
    const ui = useUiStore()
    sel.selectIssue('i1')
    ui.openDetail('i1', 'issue')
    await s.removeIssue('i1')
    expect(s.byId('i1')).toBeUndefined()
    expect(sel.issueId).toBeNull()
    expect(ui.detail).toBeNull()
  })

  // ── 樂觀更新（契約 B）────────────────────────────────────────────────────
  describe('經 api 的樂觀更新', () => {
    it('updateIssue 把前端推導出來的 done 一起送給後端（後端不跑規則）', async () => {
      const s = useIssueStore()
      const spy = vi.spyOn(api, 'updateIssue')
      await s.updateIssue('i1', { status: 'closed' })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith('i1', { status: 'closed', done: '2026-09-18' })
    })

    it('updateIssue 失敗 → 還原成 server 值並推錯誤', async () => {
      const s = useIssueStore()
      const before = s.byId('i1')!.title
      mockApi.failNext('updateIssue')
      await s.updateIssue('i1', { title: '改到一半失敗' })
      expect(s.byId('i1')!.title).toBe(before)
      expect(useUiStore().errors[0]!.label).toBe('更新 Issue')
    })

    it('addIssue 失敗 → 本地那筆被收回', async () => {
      const s = useIssueStore()
      mockApi.failNext('createIssue')
      const task = useTaskStore().taskById('t3')!
      const i = s.addIssue(task, 'm1')
      await vi.waitFor(() => expect(s.byId(i.id)).toBeUndefined())
      expect(useUiStore().errors[0]!.label).toBe('新增 Issue')
    })

    it('removeIssue 失敗 → Issue 與它的留言回來', async () => {
      const s = useIssueStore()
      const comments = useCommentStore()
      const beforeIssues = s.issues.map((i) => i.id)
      const beforeComments = comments.comments.map((c) => c.id)
      mockApi.failNext('deleteIssue')
      await s.removeIssue('i1')
      expect(s.issues.map((i) => i.id)).toEqual(beforeIssues)
      expect(comments.comments.map((c) => c.id)).toEqual(beforeComments)
    })

    it('removeIssue 成功時連它的留言一起從本地移除', async () => {
      const s = useIssueStore()
      const comments = useCommentStore()
      comments.comments.push({
        id: 'cX',
        targetId: 'i1',
        targetKind: 'issue',
        memberId: 'm1',
        at: '2026-09-18T10:00',
        text: '掛在 i1 的留言',
        files: [],
      })
      await s.removeIssue('i1')
      expect(comments.comments.some((c) => c.id === 'cX')).toBe(false)
    })
  })

  describe('applyEvent', () => {
    it('issue.updated / issue.created / issue.deleted', () => {
      const s = useIssueStore()
      s.applyEvent({ type: 'issue.updated', payload: { ...s.byId('i1')!, title: '別人改的' } })
      expect(s.byId('i1')!.title).toBe('別人改的')

      const fresh = { ...s.byId('i1')!, id: 'iX', title: '新來的' }
      s.applyEvent({ type: 'issue.created', payload: fresh })
      expect(s.byId('iX')!.title).toBe('新來的')

      s.applyEvent({ type: 'issue.deleted', payload: { id: 'iX' } })
      expect(s.byId('iX')).toBeUndefined()
    })
  })
})