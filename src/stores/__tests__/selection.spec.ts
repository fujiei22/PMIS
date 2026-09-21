import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { sampleProject } from '@/mocks/sampleProject'
import { useFilterStore } from '@/stores/filter'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('selectionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUiStore().now = NOW
    useTaskStore().load(structuredClone(sampleProject))
  })

  it('selectTask 後 related 標 up / down 並發出 focusRequest', () => {
    const sel = useSelectionStore()
    sel.groupId = 'g2'
    sel.issueId = 'i1'
    sel.selectTask('t3')
    expect(sel.taskId).toBe('t3')
    expect(sel.issueId).toBeNull()
    expect(sel.groupId).toBeNull()
    expect(sel.related.t2).toBe('up')
    expect(sel.related.t4).toBe('down')
    expect(sel.related.t9).toBeUndefined()
    expect(sel.focusRequest).toEqual({ taskId: 't3', src: null, seq: 1 })
    sel.selectTask('t4', 'card')
    expect(sel.focusRequest).toEqual({ taskId: 't4', src: 'card', seq: 2 })
  })

  it('沒有選取任務時 related 為空', () => {
    expect(useSelectionStore().related).toEqual({})
  })

  it('toggleTask 已選再點就清空', () => {
    const sel = useSelectionStore()
    sel.toggleTask('t3')
    expect(sel.taskId).toBe('t3')
    sel.toggleTask('t3')
    expect(sel.taskId).toBeNull()
  })

  it('selectIssue 連帶選到它的任務，再點一次清空', () => {
    const sel = useSelectionStore()
    sel.groupId = 'g1'
    sel.selectIssue('i1')
    expect(sel.issueId).toBe('i1')
    expect(sel.taskId).toBe('t3')
    expect(sel.groupId).toBeNull()
    sel.selectIssue('i1')
    expect(sel.issueId).toBeNull()
    expect(sel.taskId).toBeNull()
  })

  it('selectIssue 在同任務已選時視為取消', () => {
    const sel = useSelectionStore()
    sel.selectTask('t3')
    sel.selectIssue('i2')
    expect(sel.issueId).toBeNull()
    expect(sel.taskId).toBeNull()
  })

  it('toggleGroup 切換分類並清任務 / Issue / editing', () => {
    const sel = useSelectionStore()
    const ui = useUiStore()
    sel.selectTask('t3')
    ui.editing = { kind: 't', id: 't3' }
    sel.toggleGroup('g1')
    expect(sel.groupId).toBe('g1')
    expect(sel.taskId).toBeNull()
    expect(sel.issueId).toBeNull()
    expect(ui.editing).toBeNull()
    sel.toggleGroup('g1')
    expect(sel.groupId).toBeNull()
  })

  it('softHighlight 在選分類時含該分類任務', () => {
    const sel = useSelectionStore()
    const tasks = useTaskStore()
    sel.toggleGroup('g1')
    const g1 = tasks.tasks.filter((t) => t.groupId === 'g1').map((t) => t.id)
    expect(Object.keys(sel.softHighlight).sort()).toEqual([...g1].sort())
    expect(sel.hasSelection).toBe(true)
  })

  it('softHighlight 在 onlyFiltered=false 且有篩選時含 matchedIds', () => {
    const sel = useSelectionStore()
    const f = useFilterStore()
    expect(sel.softFilterActive).toBe(false)
    f.onlyFiltered = false
    f.statuses = ['done']
    expect(sel.softFilterActive).toBe(true)
    expect(sel.hasSelection).toBe(true)
    for (const id of f.matchedIds) expect(sel.softHighlight[id]).toBe(true)
    expect(Object.keys(sel.softHighlight)).toHaveLength(f.matchedIds.size)
  })

  it('onlyFiltered=true 時不算 soft 篩選', () => {
    const sel = useSelectionStore()
    const f = useFilterStore()
    f.statuses = ['done']
    expect(sel.softFilterActive).toBe(false)
    expect(sel.softHighlight).toEqual({})
    expect(sel.hasSelection).toBe(false)
  })

  it('clear 清三個 id 與 ui.editing / ui.pickerFor', () => {
    const sel = useSelectionStore()
    const ui = useUiStore()
    sel.selectIssue('i1')
    sel.groupId = 'g1'
    ui.editing = { kind: 'i', id: 'i1' }
    ui.pickerFor = 't3'
    sel.clear()
    expect(sel.taskId).toBeNull()
    expect(sel.issueId).toBeNull()
    expect(sel.groupId).toBeNull()
    expect(ui.editing).toBeNull()
    expect(ui.pickerFor).toBeNull()
  })
})
