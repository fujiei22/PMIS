import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTaskActions } from '@/composables/useTaskActions'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useFilterStore } from '@/stores/filter'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'

/** 新實體的 id 是 UUID v4（spec 目標 4），只能斷言格式。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const NOW = Date.parse('2026-09-18T10:00:00Z')

/**
 * 「新增任務 / 開立 Issue 的預設值」是畫面行為，不是資料層的規則（契約 E）：
 * 它讀 selection / filter / clock，所以住在 composable，
 * 資料 store 只收算好的參數。
 */
describe('useTaskActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useClockStore().now = NOW
    useSelectionStore()
    useTaskStore().load(structuredClone(sampleProject))
  })

  describe('addTaskWithDefaults', () => {
    it('分類取選取的分類，日期今天起五天，並選取新任務', () => {
      const sel = useSelectionStore()
      sel.groupId = 'g3'
      const t = useTaskActions().addTaskWithDefaults()!
      expect(t.id).toMatch(UUID)
      expect(t.groupId).toBe('g3')
      expect(t.name).toBe('新任務')
      expect(t.created).toBe('2026-09-18')
      expect(t.start).toBe('2026-09-18')
      expect(t.end).toBe('2026-09-22')
      expect(t.status).toBe('todo')
      expect(t.priority).toBe('mid')
      expect(sel.taskId).toBe(t.id)
      expect(useTaskStore().taskById(t.id)).toBeDefined()
    })

    it('沒選分類時取選取任務所在的分類', () => {
      const sel = useSelectionStore()
      sel.selectTask('t9')
      const t = useTaskActions().addTaskWithDefaults()!
      expect(t.groupId).toBe(useTaskStore().taskById('t9')!.groupId)
    })

    it('什麼都沒選時取第一個分類', () => {
      const t = useTaskActions().addTaskWithDefaults()!
      expect(t.groupId).toBe(useTaskStore().groups[0]!.id)
    })

    it('負責人沿用成員篩選', () => {
      useFilterStore().memberIds = ['m2', 'm5']
      const t = useTaskActions().addTaskWithDefaults()!
      expect(t.assigneeIds).toEqual(['m2', 'm5'])
      // 是複本，之後改篩選不會動到任務
      useFilterStore().memberIds.push('m7')
      expect(t.assigneeIds).toEqual(['m2', 'm5'])
    })

    it('一個分類都沒有時改成新增分類並回 null', () => {
      const tasks = useTaskStore()
      tasks.groups = []
      tasks.tasks = []
      expect(useTaskActions().addTaskWithDefaults()).toBeNull()
      expect(tasks.groups).toHaveLength(1)
      expect(tasks.tasks).toHaveLength(0)
    })
  })

  describe('addIssueForTask', () => {
    it('建立者取任務第一位負責人，期限跟著任務結束日', () => {
      const task = useTaskStore().taskById('t3')!
      const i = useTaskActions().addIssueForTask('t3')!
      expect(i.id).toMatch(UUID)
      expect(i.taskId).toBe('t3')
      expect(i.creatorId).toBe(task.assigneeIds[0])
      expect(i.ownerIds).toEqual(task.assigneeIds.slice(0, 1))
      expect(i.due).toBe(task.end)
      expect(i.created).toBe('2026-09-18')
      expect(useIssueStore().byId(i.id)).toBeDefined()
    })

    it('任務沒有負責人時建立者用 currentUserId', () => {
      useTaskStore().taskById('t3')!.assigneeIds = []
      const i = useTaskActions().addIssueForTask('t3')!
      expect(i.creatorId).toBe(useMemberStore().currentUserId)
      expect(i.ownerIds).toEqual([])
    })

    it('任務不存在時回 null', () => {
      expect(useTaskActions().addIssueForTask('nope')).toBeNull()
    })
  })
})
