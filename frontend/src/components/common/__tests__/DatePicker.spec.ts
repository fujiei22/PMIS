import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import DatePicker from '@/components/common/DatePicker.vue'
import { useMenus } from '@/composables/useMenus'
import { EDIT_BLOCK_TEXT, OVERDUE_SHRINK_TEXT, PICK_LIMIT_TEXT } from '@/constants/dashboard'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 日期選擇器依排程規則編輯（規則見 docs/reference/scheduling.md）：
 * 工期是工作天、有前置的未開始任務不能改開始日、已完成的不能改工期，
 * 停用的地方一律有看得見的說明行（觸控看不到 title）；非工作天上底色、底部列出本月假日。
 *
 * 範例在 2026-09-18 推算；9/25 中秋、9/28 教師節、10/09 補假、10/10 國慶。
 */

/** 開浮層用的點擊事件：jsdom 的 getBoundingClientRect 一律回 0，位置不重要。 */
function click(): MouseEvent {
  const e = new MouseEvent('click')
  Object.defineProperty(e, 'currentTarget', { value: document.createElement('div') })
  return e
}

/** 掛上選擇器，再走跟畫面一樣的入口（useMenus）打開某個任務的起訖選擇器。 */
async function openTask(id: string): Promise<VueWrapper> {
  const w = mount(DatePicker)
  useMenus().openTaskDatePicker(click(), id)
  await nextTick()
  return w
}

/** 起訖選擇器裡某一天的格子。 */
function cell(w: VueWrapper, iso: string) {
  return w.find(`.task-date-picker [data-date="${iso}"]`)
}

let update: MockInstance

beforeEach(async () => {
  await loadSample()
  update = vi.spyOn(useTaskStore(), 'updateTask').mockResolvedValue()
})

describe('任務起訖日期選擇器：有前置、未開始（t5）', () => {
  it('開始日停用、預設對準結束日，說明行寫出原因', async () => {
    const w = await openTask('t5')
    const [start, end] = w.findAll('.cal-end')
    expect(start!.classes()).toContain('disabled')
    expect(start!.attributes('aria-disabled')).toBe('true')
    expect(end!.classes()).toContain('aimed')
    expect(w.find('.task-date-picker .cal-note').text()).toBe(EDIT_BLOCK_TEXT.predecessor)

    // 點了停用的開始日也不會換過去
    await start!.trigger('click')
    expect(useUiStore().taskDatePicker!.target).toBe('end')
  })

  it('點 10/08 當結束日：換算成工期 8（09/29 起的工作天，10/09–10/11 放假不算）', async () => {
    const w = await openTask('t5')
    await cell(w, '2026-10-08').trigger('click')
    expect(update).toHaveBeenCalledWith('t5', { duration: 8 })
  })

  it('開始日以前的格子停用，點了不送（不能對調成新的開始日）', async () => {
    const w = await openTask('t5')
    expect(cell(w, '2026-09-28').classes()).toContain('disabled')
    expect(cell(w, '2026-09-29').classes()).not.toContain('disabled')
    await cell(w, '2026-09-28').trigger('click')
    expect(update).not.toHaveBeenCalled()
  })

  it('工期欄：送工作天數、單位寫「工作天」，超過上限夾在 3650', async () => {
    const w = await openTask('t5')
    const input = w.find('.task-date-picker input[data-dur]')
    expect((input.element as HTMLInputElement).value).toBe('7')
    expect(w.find('.cal-days-unit').text()).toBe('工作天')

    await input.setValue('9')
    expect(update).toHaveBeenLastCalledWith('t5', { duration: 9 })
    await input.setValue('5000')
    expect(update).toHaveBeenLastCalledWith('t5', { duration: 3650 })
  })
})

describe('任務起訖日期選擇器：未開始的根任務（t24，10/08 開始）', () => {
  it('填結束日時點在開始日之前：起訖對調，送新的開始日與換算的工期', async () => {
    const w = await openTask('t24')
    expect(useUiStore().taskDatePicker!.target).toBe('start')
    await w.findAll('.cal-end')[1]!.trigger('click')
    await cell(w, '2026-10-01').trigger('click')
    // 10/01、02、05、06、07、08 共 6 個工作天
    expect(update).toHaveBeenCalledWith('t24', { start: '2026-10-01', duration: 6 })
  })

  it('填開始日只送開始日（工期不變、結束日由工期推算），之後換填結束日', async () => {
    const w = await openTask('t24')
    await cell(w, '2026-10-13').trigger('click')
    expect(update).toHaveBeenCalledWith('t24', { start: '2026-10-13' })
    expect(useUiStore().taskDatePicker!.target).toBe('end')
  })
})

describe('任務起訖日期選擇器：已開始、已完成', () => {
  it('已完成的 t2：工期欄唯讀、結束日停用，說明行寫出原因', async () => {
    const w = await openTask('t2')
    const input = w.find('.task-date-picker input[data-dur]')
    expect(input.attributes('readonly')).toBeDefined()
    const [start, end] = w.findAll('.cal-end')
    expect(start!.classes()).toContain('aimed')
    expect(end!.classes()).toContain('disabled')
    expect(w.find('.task-date-picker .cal-note').text()).toBe(EDIT_BLOCK_TEXT.done)

    await input.setValue('9')
    await end!.trigger('click')
    expect(update).not.toHaveBeenCalled()
    expect(useUiStore().taskDatePicker!.target).toBe('start')
  })

  it('已開始的 t3 對準開始日：今天（09-18）以後的格子停用，說明行寫出原因', async () => {
    const w = await openTask('t3')
    expect(useUiStore().taskDatePicker!.target).toBe('start')
    expect(cell(w, '2026-09-18').classes()).not.toContain('disabled')
    expect(cell(w, '2026-09-21').classes()).toContain('disabled')
    expect(w.find('.task-date-picker .cal-note').text()).toBe(PICK_LIMIT_TEXT.startAfterToday)
    await cell(w, '2026-09-21').trigger('click')
    expect(update).not.toHaveBeenCalled()
  })

  it('逾期的 t3 對準結束日：今天以前的格子停用（結束日最早是今天），說明行寫出原因', async () => {
    const w = await openTask('t3')
    await w.findAll('.cal-end')[1]!.trigger('click')
    expect(cell(w, '2026-09-17').classes()).toContain('disabled')
    expect(cell(w, '2026-09-18').classes()).not.toContain('disabled')
    expect(w.find('.task-date-picker .cal-note').text()).toBe(OVERDUE_SHRINK_TEXT)
    await cell(w, '2026-09-21').trigger('click')
    // 有效工期：09/08 到 09/21 的工作天＝10
    expect(update).toHaveBeenCalledWith('t3', { duration: 10 })
  })
})

describe('日期選擇器標出非工作天', () => {
  it('非工作天的格子有 .off，假日名稱放 title；九月底部列出本月假日', async () => {
    const w = await openTask('t3')
    expect(cell(w, '2026-09-25').classes()).toContain('off')
    expect(cell(w, '2026-09-25').attributes('title')).toBe('中秋節')
    // 週末也是非工作天，但沒有名稱
    expect(cell(w, '2026-09-26').classes()).toContain('off')
    expect(cell(w, '2026-09-26').attributes('title')).toBeUndefined()
    expect(cell(w, '2026-09-24').classes()).not.toContain('off')
    expect(w.find('.task-date-picker .cal-holidays').text()).toBe(
      '本月假日：9/25 中秋節、9/28 教師節',
    )
  })

  it('沒有假日的月份不顯示本月假日', async () => {
    const w = await openTask('t3')
    useUiStore().taskDatePicker!.month = '2026-08'
    await nextTick()
    expect(w.find('.task-date-picker .cal-holidays').exists()).toBe(false)
  })
})

describe('完成日選擇器（任務模式）', () => {
  it('t2：開始日 09-02 以前的格子停用，點了不送；說明行寫出原因', async () => {
    const done = vi.spyOn(useTaskStore(), 'setTaskDoneDirect').mockResolvedValue()
    const w = mount(DatePicker)
    useMenus().openIssueDatePicker(click(), 't2', 'done', '2026-09-08', 'task')
    await nextTick()
    const at = (iso: string) => w.find(`.issue-date-picker [data-date="${iso}"]`)
    expect(at('2026-09-01').classes()).toContain('disabled')
    expect(at('2026-09-02').classes()).not.toContain('disabled')
    expect(at('2026-09-25').classes()).toContain('off')
    expect(w.find('.issue-date-picker .cal-note').text()).toBe(PICK_LIMIT_TEXT.doneBeforeStart)

    await at('2026-09-01').trigger('click')
    expect(done).not.toHaveBeenCalled()
    await at('2026-09-03').trigger('click')
    expect(done).toHaveBeenCalledWith('t2', '2026-09-03')
  })

  // review：已完成任務的結束日就是完成日，清掉會變成「完成卻沒有完成日」的舊資料狀態
  it('已完成的 t2：「清除」停用、點了不送，第二行說明寫出原因；進行中的 t3 可以清', async () => {
    const done = vi.spyOn(useTaskStore(), 'setTaskDoneDirect').mockResolvedValue()
    const w = mount(DatePicker)
    useMenus().openIssueDatePicker(click(), 't2', 'done', '2026-09-08', 'task')
    await nextTick()
    const clear = w.find('.issue-date-picker .cal-clear')
    expect(clear.classes()).toContain('disabled')
    expect(clear.attributes('aria-disabled')).toBe('true')
    expect(w.findAll('.issue-date-picker .cal-note').map((n) => n.text())).toEqual([
      PICK_LIMIT_TEXT.doneBeforeStart,
      PICK_LIMIT_TEXT.doneRequired,
    ])
    await clear.trigger('click')
    expect(done).not.toHaveBeenCalled()

    useUiStore().issueDatePicker = null
    useMenus().openIssueDatePicker(click(), 't3', 'done', '', 'task')
    await nextTick()
    const clear3 = w.find('.issue-date-picker .cal-clear')
    expect(clear3.classes()).not.toContain('disabled')
    await clear3.trigger('click')
    expect(done).toHaveBeenCalledWith('t3', '')
  })

  it('Issue 模式不限制日期', async () => {
    const w = mount(DatePicker)
    useMenus().openIssueDatePicker(click(), 'i1', 'due', '2026-09-08')
    await nextTick()
    expect(w.findAll('.issue-date-picker .cal-cell.disabled')).toHaveLength(0)
    expect(w.find('.issue-date-picker .cal-note').exists()).toBe(false)
  })
})
