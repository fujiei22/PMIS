import { describe, it, expect } from 'vitest'
import { sampleProject } from '@/mocks/sampleProject'

describe('sampleProject', () => {
  it('mock 資料數量與 id 互相引用成立', () => {
    const taskIds = new Set(sampleProject.tasks.map((t) => t.id))

    expect(sampleProject.tasks).toHaveLength(30)
    expect(sampleProject.issues).toHaveLength(12)
    expect(sampleProject.deps).toHaveLength(27)
    expect(sampleProject.comments).toHaveLength(5)
    expect(sampleProject.members).toHaveLength(7)
    expect(sampleProject.groups).toHaveLength(6)

    for (const i of sampleProject.issues) expect(taskIds.has(i.taskId)).toBe(true)
    for (const d of sampleProject.deps) {
      expect(taskIds.has(d.from)).toBe(true)
      expect(taskIds.has(d.to)).toBe(true)
    }
    for (const c of sampleProject.comments) expect(c.targetKind).toBe('task')

    expect(sampleProject.currentUserId).toBe('m1')
  })

  it('每個任務都掛在既有分類、負責人都是既有成員', () => {
    const groupIds = new Set(sampleProject.groups.map((g) => g.id))
    const memberIds = new Set(sampleProject.members.map((m) => m.id))

    for (const t of sampleProject.tasks) {
      expect(groupIds.has(t.groupId)).toBe(true)
      for (const id of t.assigneeIds) expect(memberIds.has(id)).toBe(true)
    }
    for (const i of sampleProject.issues) {
      expect(memberIds.has(i.creatorId)).toBe(true)
      for (const id of i.ownerIds) expect(memberIds.has(id)).toBe(true)
    }
    for (const c of sampleProject.comments) expect(memberIds.has(c.memberId)).toBe(true)
  })
})
