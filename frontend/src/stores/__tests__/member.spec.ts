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
})
