import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import GanttGroupRow from '@/components/gantt/GanttGroupRow.vue'
import { dayIndex } from '@/lib/date'
import { useTaskStore } from '@/stores/task'

/**
 * 甘特左欄分類列的天數：是分類期間（最早開始到最晚結束的日曆天），不是工期。
 * 工期改成工作天之後兩者單位不同，title 要講清楚，數字本身不變。
 */
describe('GanttGroupRow 分類期間', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('title 註明「分類期間（日曆天）」，數字仍是頭尾都算的日曆天', () => {
    const s = useTaskStore()
    const group = s.groups.find((g) => g.id === 'g1')!
    const tasks = s.tasks.filter((t) => t.groupId === 'g1')
    const span =
      Math.max(...tasks.map((t) => dayIndex(t.end))) -
      Math.min(...tasks.map((t) => dayIndex(t.start))) +
      1
    const el = mount(GanttGroupRow, { props: { group } }).find('.span')
    expect(el.attributes('title')).toBe('分類期間（日曆天）')
    expect(el.text()).toBe(`${span}d`)
  })
})
