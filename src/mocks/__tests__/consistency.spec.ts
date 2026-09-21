import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import { cascade } from '@/lib/schedule'
import { sampleProject } from '@/mocks/sampleProject'

/**
 * mocks 自身的一致性守衛。
 *
 * spec 目標 5：接後端後 `load()` 不再跑 cascade，資料以後端為準。
 * 那條路徑要成立，這份 mocks 就必須「已經是 cascade 之後的樣子」——
 * 否則載入畫面會跟現在不一樣。現況已經滿足，這支測試把它鎖住：
 * 有人改了 mocks 的日期或相依而沒對齊，這裡會先紅。
 */
describe('sampleProject 一致性', () => {
  it('跑 cascade 不會改動任何任務（載入不需要 cascade）', () => {
    const after = cascade(sampleProject.tasks, sampleProject.deps)
    expect(after.map((t) => ({ id: t.id, start: t.start, end: t.end }))).toEqual(
      sampleProject.tasks.map((t) => ({ id: t.id, start: t.start, end: t.end })),
    )
  })

  it('每條相依的下游 start 不早於上游 start', () => {
    const by = new Map(sampleProject.tasks.map((t) => [t.id, t]))
    for (const d of sampleProject.deps) {
      const from = by.get(d.from)
      const to = by.get(d.to)
      expect(from, `相依 ${d.id} 的 from=${d.from} 不存在`).toBeDefined()
      expect(to, `相依 ${d.id} 的 to=${d.to} 不存在`).toBeDefined()
      expect(dayIndex(to!.start)).toBeGreaterThanOrEqual(dayIndex(from!.start))
    }
  })

  it('id 在每一種資料裡都唯一，且跨種類不重複', () => {
    const all = [
      ...sampleProject.groups.map((x) => x.id),
      ...sampleProject.members.map((x) => x.id),
      ...sampleProject.tasks.map((x) => x.id),
      ...sampleProject.deps.map((x) => x.id),
      ...sampleProject.issues.map((x) => x.id),
      ...sampleProject.comments.map((x) => x.id),
    ]
    expect(new Set(all).size).toBe(all.length)
  })

  it('外鍵都指得到：task.groupId / issue.taskId / comment.targetId / 成員', () => {
    const groupIds = new Set(sampleProject.groups.map((g) => g.id))
    const taskIds = new Set(sampleProject.tasks.map((t) => t.id))
    const issueIds = new Set(sampleProject.issues.map((i) => i.id))
    const memberIds = new Set(sampleProject.members.map((m) => m.id))

    for (const t of sampleProject.tasks) {
      expect(groupIds.has(t.groupId)).toBe(true)
      for (const m of t.assigneeIds) expect(memberIds.has(m)).toBe(true)
    }
    for (const i of sampleProject.issues) {
      expect(taskIds.has(i.taskId)).toBe(true)
      expect(memberIds.has(i.creatorId)).toBe(true)
      for (const m of i.ownerIds) expect(memberIds.has(m)).toBe(true)
    }
    for (const c of sampleProject.comments) {
      expect(memberIds.has(c.memberId)).toBe(true)
      expect(c.targetKind === 'task' ? taskIds.has(c.targetId) : issueIds.has(c.targetId)).toBe(true)
    }
    expect(memberIds.has(sampleProject.currentUserId)).toBe(true)
  })

  // 契約 A：附件要有 id，api.downloadAttachment(attachmentId) 才有東西可指。
  it('每個附件都有 id，格式是 <commentId>:<index> 且全域唯一', () => {
    const seen = new Set<string>()
    let count = 0
    for (const c of sampleProject.comments) {
      c.files.forEach((f, i) => {
        count++
        expect(f.id).toBe(`${c.id}:${i}`)
        expect(seen.has(f.id)).toBe(false)
        seen.add(f.id)
      })
    }
    expect(count).toBeGreaterThan(0)
  })
})
