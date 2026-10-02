import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi as maybeMockApi } from '@/api'
import { sampleProject } from '@/mocks/sampleProject'
import { useProjectSync } from '@/stores/_sync'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useProjectStore } from '@/stores/project'
import { useTaskStore } from '@/stores/task'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

describe('useProjectSync', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    mockApi.reset(structuredClone(sampleProject))
    await useTaskStore().load('pmis')
  })

  it('依 type 前綴路由到 task / issue / comment store', () => {
    const sync = useProjectSync()
    const tasks = useTaskStore()
    const issues = useIssueStore()
    const comments = useCommentStore()
    sync.start('pmis')

    mockApi.emit({ type: 'task.updated', payload: { ...tasks.taskById('t3')!, name: '任務事件' } })
    mockApi.emit({ type: 'issue.updated', payload: { ...issues.byId('i1')!, title: 'Issue 事件' } })
    mockApi.emit({ type: 'comment.deleted', payload: { id: 'c1' } })
    mockApi.emit({ type: 'group.updated', payload: { id: 'g1', name: '分類事件' } })

    expect(tasks.taskById('t3')!.name).toBe('任務事件')
    expect(issues.byId('i1')!.title).toBe('Issue 事件')
    expect(comments.comments.some((c) => c.id === 'c1')).toBe(false)
    expect(tasks.groupById('g1')!.name).toBe('分類事件')
    sync.stop()
  })

  it('project.reloaded 重新載入整包', () => {
    const sync = useProjectSync()
    const tasks = useTaskStore()
    sync.start('pmis')
    const next = structuredClone(sampleProject)
    next.tasks = next.tasks.slice(0, 3)
    mockApi.emit({ type: 'project.reloaded', payload: next })
    expect(tasks.tasks).toHaveLength(3)
    sync.stop()
  })

  it('project.updated 更新專案本身（例：基準鎖定日），canEdit 不變', () => {
    const sync = useProjectSync()
    const project = useProjectStore()
    sync.start('pmis')
    mockApi.emit({
      type: 'project.updated',
      payload: { ...project.meta, baselineLockedOn: '2026-09-18' },
    })
    expect(project.meta.baselineLockedOn).toBe('2026-09-18')
    expect(project.canEdit).toBe(true)
    sync.stop()
  })

  it('stop 之後不再收事件；重複 start 只訂一次', () => {
    const sync = useProjectSync()
    const tasks = useTaskStore()
    sync.start('pmis')
    sync.start('pmis')
    sync.stop()
    mockApi.emit({ type: 'task.updated', payload: { ...tasks.taskById('t3')!, name: '不該進來' } })
    expect(tasks.taskById('t3')!.name).not.toBe('不該進來')
  })
})
