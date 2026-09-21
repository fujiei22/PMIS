import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { sampleProject } from '@/mocks/sampleProject'
import { useIssueStore } from '@/stores/issue'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 新實體的 id 是 UUID v4（spec 目標 4），只能斷言格式。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('issueStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUiStore().now = NOW
    useTaskStore().load(structuredClone(sampleProject))
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

  it('addIssue 依任務帶入預設值', () => {
    const s = useIssueStore()
    const task = useTaskStore().taskById('t3')!
    const i = s.addIssue('t3')!
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

  it('addIssue 在任務沒有負責人時用 currentUserId', () => {
    const s = useIssueStore()
    const tasks = useTaskStore()
    tasks.taskById('t3')!.assigneeIds = []
    expect(s.addIssue('t3')!.creatorId).toBe('m1')
  })

  it('addIssue 任務不存在時回 null', () => {
    expect(useIssueStore().addIssue('nope')).toBeNull()
  })

  it('updateIssue: status→closed 填 done、離開 closed 清 done', () => {
    const s = useIssueStore()
    s.updateIssue('i1', { status: 'closed' })
    expect(s.byId('i1')!.done).toBe('2026-09-18')
    s.updateIssue('i1', { status: 'open' })
    expect(s.byId('i1')!.done).toBe('')
    s.updateIssue('i1', { title: '改標題' })
    expect(s.byId('i1')!.title).toBe('改標題')
  })

  it('updateIssue 不覆蓋已填的 done', () => {
    const s = useIssueStore()
    s.updateIssue('i1', { done: '2026-09-10' })
    s.updateIssue('i1', { status: 'closed' })
    expect(s.byId('i1')!.done).toBe('2026-09-10')
  })

  it('removeIssue 清 selection.issueId 與 ui.detail', () => {
    const s = useIssueStore()
    const sel = useSelectionStore()
    const ui = useUiStore()
    sel.selectIssue('i1')
    ui.openDetail('i1', 'issue')
    s.removeIssue('i1')
    expect(s.byId('i1')).toBeUndefined()
    expect(sel.issueId).toBeNull()
    expect(ui.detail).toBeNull()
  })
})
