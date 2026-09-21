import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi } from '@/api'
import { sampleProject } from '@/mocks/sampleProject'
import { useProjectSync } from '@/stores/_sync'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'

describe('useProjectSync', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    mockApi.reset(structuredClone(sampleProject))
    await useTaskStore().load()
  })

  it('依 type 前綴路由到 task / issue / comment store', () => {
    const sync = useProjectSync()
    const tasks = useTaskStore()
    const issues = useIssueStore()
    const comments = useCommentStore()
    sync.start()

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
    sync.start()
    const next = structuredClone(sampleProject)
    next.tasks = next.tasks.slice(0, 3)
    mockApi.emit({ type: 'project.reloaded', payload: next })
    expect(tasks.tasks).toHaveLength(3)
    sync.stop()
  })

  it('stop 之後不再收事件；重複 start 只訂一次', () => {
    const sync = useProjectSync()
    const tasks = useTaskStore()
    sync.start()
    sync.start()
    sync.stop()
    mockApi.emit({ type: 'task.updated', payload: { ...tasks.taskById('t3')!, name: '不該進來' } })
    expect(tasks.taskById('t3')!.name).not.toBe('不該進來')
  })
})
