import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import TaskProperties from '@/components/detail/TaskProperties.vue'
import { BASELINE_ROW_TEXT } from '@/constants/dashboard'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 屬性面板的「工期」「計畫」兩列（規則見 docs/reference/scheduling.md〈有效工期〉〈計畫與延遲〉）。
 *
 * 範例 t3：進行中、09-08 開工、輸入工期 7；09-18 時已逾期，推算結束日推到 09-18，
 * 所以有效工期是 09-08～09-18 的 9 個工作天。它比計畫（09-17 → 09-29）早開工，所以不算延遲。
 * 範例 t13：計畫 09-08 → 09-14、工期 5；09-18 時推算結束日推到 09-18，晚 4 個工作天（09-15～09-18）。
 */

/** 掛 t3（或指定任務）的屬性面板；props 取 store 推算後的任務，跟 DetailModal 一樣。 */
function mountProps(id = 't3') {
  return mount(TaskProperties, { props: { task: useTaskStore().taskById(id)! } })
}

/** 找某個標籤（「工期」「計畫基準」…）所在的那一列。 */
function rowOf(w: ReturnType<typeof mountProps>, label: string) {
  const row = w.findAll('.row').find((r) => r.find('.label').text().endsWith(label))
  if (!row) throw new Error(`找不到「${label}」列`)
  return row
}

describe('TaskProperties 工期與計畫基準', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('工期列顯示有效工期（逾期延長後是 9 工作天，不是輸入的 7）', () => {
    const row = rowOf(mountProps(), '工期')
    expect(row.find('.pill').text()).toContain('9 工作天')
  })

  it('工期列點了開日期選擇器', async () => {
    const w = mountProps()
    await rowOf(w, '工期').find('.pill').trigger('click')
    expect(useUiStore().taskDatePicker?.id).toBe('t3')
  })

  it('時程列只寫起訖，不再帶「· Nd」', () => {
    const text = rowOf(mountProps(), '時程').find('.pill').text()
    expect(text).toContain('2026/09/08 → 2026/09/18')
    expect(text).not.toMatch(/·\s*\d+d/)
  })

  it('計畫列：計畫起訖、title 說明計畫怎麼來、晚 4 工作天', () => {
    const row = rowOf(mountProps('t13'), BASELINE_ROW_TEXT.label)
    expect(row.text()).toContain('2026/09/08 → 2026/09/14')
    expect(row.find('.pill-static').attributes('title')).toContain(BASELINE_ROW_TEXT.rule)
    expect(row.find('.late-days').text()).toBe('晚 4 工作天')
  })

  it('「晚 N 工作天」用 --danger-text', () => {
    // jsdom 不套 SFC 的 scoped style，直接看原始碼的規則（同 tokens.spec 的做法）
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/detail/TaskProperties.vue'),
      'utf8',
    )
    expect(src).toMatch(/\.late-days\s*\{[^}]*color:\s*var\(--danger-text\)/)
  })

  it('推算結束沒晚於計畫結束就不顯示「晚 N 工作天」（t3 逾期，但比計畫早開工）', () => {
    const row = rowOf(mountProps('t3'), BASELINE_ROW_TEXT.label)
    expect(row.text()).toContain('2026/09/17 → 2026/09/29')
    expect(row.find('.late-days').exists()).toBe(false)
  })

  // PM 改了就是新計畫：把延遲的 t13 工期拉長到 9 天，計畫結束日跟著到 09-18，延遲消失
  it('PM 改工期：計畫跟著改，延遲消失', async () => {
    await useTaskStore().updateTask('t13', { duration: 9 })
    const row = rowOf(mountProps('t13'), BASELINE_ROW_TEXT.label)
    expect(row.text()).toContain('2026/09/08 → 2026/09/18')
    expect(row.find('.late-days').exists()).toBe(false)
  })
})
