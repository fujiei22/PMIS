import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import TaskProperties from '@/components/detail/TaskProperties.vue'
import { BASELINE_ROW_TEXT } from '@/constants/dashboard'
import { sampleProject } from '@/mocks/sampleProject'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 屬性面板的「工期」「計畫基準」兩列（規則見 docs/reference/scheduling.md〈有效工期〉〈基準與基準鎖〉）。
 *
 * 範例 t3：進行中、09-08 開工、輸入工期 7；09-18 時已逾期，推算結束日推到 09-18，
 * 所以有效工期是 09-08～09-18 的 9 個工作天；基準 09-08 → 09-16，晚 2 個工作天（09-17、09-18）。
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

  it('計畫基準列：基準起訖、鎖頭圖示、晚 2 工作天', () => {
    const row = rowOf(mountProps(), BASELINE_ROW_TEXT.label)
    expect(row.text()).toContain('2026/09/08 → 2026/09/16')
    expect(row.find('.lock-icon').exists()).toBe(true)
    expect(row.find('.late-days').text()).toBe('晚 2 工作天')
  })

  it('「晚 N 工作天」用 --danger-text', () => {
    // jsdom 不套 SFC 的 scoped style，直接看原始碼的規則（同 tokens.spec 的做法）
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/detail/TaskProperties.vue'),
      'utf8',
    )
    expect(src).toMatch(/\.late-days\s*\{[^}]*color:\s*var\(--danger-text\)/)
  })

  it('沒有延遲的任務不顯示「晚 N 工作天」', () => {
    // t4：進行中、推算結束 09-24 等於基準結束
    const row = rowOf(mountProps('t4'), BASELINE_ROW_TEXT.label)
    expect(row.text()).toContain('2026/09/14 → 2026/09/24')
    expect(row.find('.late-days').exists()).toBe(false)
  })

  it('解鎖後（規劃中）基準列顯示「跟著排程（規劃中）」，沒有日期與鎖頭', async () => {
    await useTaskStore().unlockBaseline()
    const row = rowOf(mountProps(), BASELINE_ROW_TEXT.label)
    expect(row.text()).toContain(BASELINE_ROW_TEXT.unlocked)
    expect(row.text()).not.toContain('2026/09/08')
    expect(row.find('.lock-icon').exists()).toBe(false)
    expect(row.find('.late-days').exists()).toBe(false)
  })

  it('沒有基準的任務（舊資料）顯示「未設定」', async () => {
    const data = structuredClone(sampleProject)
    const t3 = data.tasks.find((t) => t.id === 't3')!
    t3.baselineStart = ''
    t3.baselineEnd = ''
    await loadSample({ data })
    const row = rowOf(mountProps(), BASELINE_ROW_TEXT.label)
    expect(row.text()).toContain(BASELINE_ROW_TEXT.none)
    expect(row.find('.late-days').exists()).toBe(false)
  })
})
