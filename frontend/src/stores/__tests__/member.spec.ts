import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { sampleProject } from '@/mocks/sampleProject'
import { useMemberStore } from '@/stores/member'
import { useTaskStore } from '@/stores/task'

describe('memberStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useTaskStore().load(structuredClone(sampleProject))
  })

  it('load 後帶入成員與 currentUserId', () => {
    const s = useMemberStore()
    expect(s.members).toHaveLength(7)
    expect(s.currentUserId).toBe('m1')
  })

  it('byId 查得到成員，查不到回 undefined', () => {
    const s = useMemberStore()
    expect(s.byId('m3')?.name).toBe('成員3')
    expect(s.byId('nope')).toBeUndefined()
  })

  it('assignable：只列沒停用的人，原本就選了的停用者留著；順序照 members', () => {
    const data = structuredClone(sampleProject)
    data.members[1]!.active = false // m2
    data.members[3]!.active = false // m4
    useTaskStore().load(data)
    const s = useMemberStore()
    expect(s.assignable().map((m) => m.id)).toEqual(['m1', 'm3', 'm5', 'm6', 'm7'])
    expect(s.assignable(['m4']).map((m) => m.id)).toEqual(['m1', 'm3', 'm4', 'm5', 'm6', 'm7'])
  })

  it('reset 清空成員與登入者', () => {
    const s = useMemberStore()
    s.reset()
    expect(s.members).toEqual([])
    expect(s.currentUserId).toBe('')
  })
})
