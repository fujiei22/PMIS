import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import {
  durationNote,
  editPolicy,
  LOCKED_POLICY,
  samePolicy,
  taskPickerNote,
  type EditCtx,
} from '@/lib/editPolicy'
import { createWorkdays } from '@/lib/workdays'
import type { Task, WorkCalendar } from '@/types/models'

/**
 * 編輯限制（規則見 docs/reference/scheduling.md〈編輯限制〉）。
 * 測試日曆同 scheduleRules.spec：10/9（五）補假、10/10（六）國慶、10/17（六）補班；今天 2026-10-08（四）。
 */
const CAL: WorkCalendar = {
  weekendDays: [6, 7],
  coveredYears: [2026],
  days: [
    { date: '2026-10-09', isWorkday: false, name: '補假', source: 'official' },
    { date: '2026-10-10', isWorkday: false, name: '國慶日', source: 'official' },
    { date: '2026-10-17', isWorkday: true, name: '補班', source: 'override' },
  ],
}
const wd = createWorkdays(CAL)
const NOW = dayIndex('2026-10-08')
const ctx = (hasPred: string[] = []): EditCtx => ({ hasPred: new Set(hasPred), wd, todayIdx: NOW })

/** 推算後的任務：預設未開始、10/08 起訖、工期 1、id 'a'。 */
function task(over: Partial<Task> = {}): Task {
  return {
    id: 'a',
    groupId: 'g1',
    name: 'a',
    created: '2026-10-01',
    start: '2026-10-08',
    end: '2026-10-08',
    status: 'todo',
    done: '',
    priority: 'mid',
    assigneeIds: [],
    duration: 1,
    baselineStart: '',
    baselineEnd: '',
    ...over,
  }
}
const at = (over: Partial<Task>, hasPred: string[] = []) => editPolicy(task(over), ctx(hasPred))
/** 進行中、10/05 開工、工期 5（照工期 10/12 結束，沒逾期）。 */
const DOING = { status: 'doing', start: '2026-10-05', end: '2026-10-12', duration: 5 } as const
/** 進行中、09/28 開工、工期 2（照工期 09/29 結束，逾期）。 */
const OVERDUE = { status: 'doing', start: '2026-09-28', end: '2026-10-08', duration: 2 } as const
const DONE = { status: 'done', start: '2026-10-01', end: '2026-10-02', done: '2026-10-02' } as const

describe('editPolicy', () => {
  it('全欄位形狀：未開始的根任務都能改、開始日沒有上下限，只帶「今天以前會算延遲」的提醒', () => {
    expect(at({})).toEqual({
      moveBlock: null,
      startBlock: null,
      durationBlock: null,
      overdue: false,
      startMaxIdx: null,
      endMinIdx: null,
      warnPastStart: true,
      endBaseIdx: NOW,
    })
  })

  it('選結束日換算工期的起點：未開始根任務被順延到今天時是計畫開始日，其他是畫面上的開始日', () => {
    // 計畫 10/01 開始、還沒開工：推算開始日順延到今天 10/08 → 從計畫開始日算（PM 點的日子就是計畫）
    expect(at({ baselineStart: '2026-10-01' }).endBaseIdx).toBe(dayIndex('2026-10-01'))
    // 存的開始日 10/12 晚於計畫開始日 10/01（刪相依後釘住的根任務），沒有被順延到今天 → 畫面上的開始日
    expect(at({ start: '2026-10-12', baselineStart: '2026-10-01' }).endBaseIdx).toBe(
      dayIndex('2026-10-12'),
    )
    expect(at(DOING).endBaseIdx).toBe(dayIndex('2026-10-05'))
    expect(LOCKED_POLICY.endBaseIdx).toBeNull()
  })

  it('有前置、未開始：不能改開始日、不能拖；工期可以改；選結束日不能早於開始日', () => {
    expect(at({ start: '2026-10-12', end: '2026-10-12' }, ['a'])).toMatchObject({
      moveBlock: 'predecessor',
      startBlock: 'predecessor',
      durationBlock: null,
      endMinIdx: dayIndex('2026-10-12'),
      warnPastStart: false,
    })
  })

  it('進行中：開始日不晚於今天；沒逾期時結束日沒有下限', () => {
    expect(at(DOING)).toMatchObject({
      moveBlock: null,
      startMaxIdx: NOW,
      overdue: false,
      endMinIdx: null,
      warnPastStart: false,
    })
  })

  it('逾期（進行中與暫停）：結束日最早是今天', () => {
    expect(at(OVERDUE)).toMatchObject({ overdue: true, endMinIdx: NOW })
    expect(at({ ...OVERDUE, status: 'paused' })).toMatchObject({
      startMaxIdx: NOW,
      overdue: true,
      endMinIdx: NOW,
    })
  })

  it('已完成：不能拖、不能改工期；開始日可以更正（有前置也可以）但不晚於完成日', () => {
    expect(at(DONE, ['a'])).toMatchObject({
      moveBlock: 'done',
      startBlock: null,
      durationBlock: 'done',
      startMaxIdx: dayIndex('2026-10-02'),
    })
  })

  it('LOCKED_POLICY（任務不存在）：什麼都不能改', () => {
    expect([
      LOCKED_POLICY.moveBlock,
      LOCKED_POLICY.startBlock,
      LOCKED_POLICY.durationBlock,
    ]).toEqual(['missing', 'missing', 'missing'])
  })

  it('samePolicy：欄位全同才算同一份', () => {
    expect(samePolicy(at({}), at({}))).toBe(true)
    expect(samePolicy(at({}), at({}, ['a']))).toBe(false)
  })
})

describe('說明行', () => {
  it('taskPickerNote：擋下的原因優先；進行中對準開始日 → startAfterToday；逾期對準結束日 → overdueShrink', () => {
    expect(taskPickerNote(at({}, ['a']), 'end')).toBe('predecessor')
    expect(taskPickerNote(at(DONE), 'start')).toBe('done')
    expect(taskPickerNote(LOCKED_POLICY, 'start')).toBe('missing')
    expect(taskPickerNote(at(DOING), 'start')).toBe('startAfterToday')
    expect(taskPickerNote(at(DOING), 'end')).toBeNull()
    expect(taskPickerNote(at(OVERDUE), 'end')).toBe('overdueShrink')
  })

  it('taskPickerNote：未開始的根任務對準哪一端都提醒 pastStartLate（選了開始日換到結束日時不能消失）', () => {
    expect(taskPickerNote(at({}), 'start')).toBe('pastStartLate')
    expect(taskPickerNote(at({}), 'end')).toBe('pastStartLate')
  })

  it('durationNote：完成 → done；逾期 → overdueShrink；任務不存在 → missing；其他沒有', () => {
    expect(durationNote(at(DONE))).toBe('done')
    expect(durationNote(at(OVERDUE))).toBe('overdueShrink')
    expect(durationNote(LOCKED_POLICY)).toBe('missing')
    expect(durationNote(at(DOING))).toBeNull()
    expect(durationNote(at({}, ['a']))).toBeNull()
  })
})
