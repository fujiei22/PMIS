import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import {
  applyTaskEdit,
  durationBlock,
  durationNote,
  durationOf,
  explainSchedule,
  isLate,
  isOverdue,
  isPlannedDone,
  lateDays,
  moveBlock,
  planTasks,
  predecessorIds,
  scheduleProject,
  scheduleTasks,
  scheduleWithPlan,
  startBlock,
  taskPickerNote,
  topoOrder,
} from '@/lib/schedule'
import { createWorkdays } from '@/lib/workdays'
import type { Dependency, Task, WorkCalendar } from '@/types/models'

/**
 * 前推排程的規則（規則見 docs/reference/scheduling.md）。
 * 測試日曆：10/9（五）補假、10/10（六）國慶、10/17（六）補班；今天預設 2026-10-08（四）。
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

/** 造一筆任務：預設未開始、10/08 開始、工期 1、沒有基準。 */
function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    groupId: 'g1',
    name: id,
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
const dep = (from: string, to: string): Dependency => ({ id: `${from}>${to}`, from, to })
/** 跑排程，回 { id: [start, end] }。 */
const run = (ts: Task[], deps: Dependency[] = [], today = NOW) =>
  Object.fromEntries(scheduleTasks(ts, deps, wd, today).map((x) => [x.id, [x.start, x.end]]))

describe('scheduleTasks', () => {
  it('根任務：照設定的開始日，遇假日順延；工期算工作天', () => {
    expect(run([task('a', { start: '2026-10-09', duration: 3 })])).toEqual({
      a: ['2026-10-12', '2026-10-14'],
    })
  })

  it('完成到開始：從前置結束的下一個工作天開始，取最晚的前置', () => {
    // b 從 10/08 排 3 個工作天：10/08、10/12、10/13（跳過 9、10、11）→ c 從 10/14 開始
    const r = run(
      [task('a'), task('b', { duration: 3 }), task('c')],
      [dep('a', 'c'), dep('b', 'c')],
    )
    expect(r.c).toEqual(['2026-10-14', '2026-10-14'])
  })

  it('未開始的任務不早於今天；今天不是工作天就下一個工作天', () => {
    expect(run([task('a', { start: '2026-10-01', duration: 2 })])).toEqual({
      a: ['2026-10-08', '2026-10-12'],
    })
    expect(run([task('a', { start: '2026-10-01' })], [], dayIndex('2026-10-10')).a![0]).toBe(
      '2026-10-12',
    )
  })

  it('已開始：開始日是實際值，不受前置與今天影響', () => {
    const r = run(
      [
        task('a', { duration: 5 }),
        task('b', { status: 'doing', start: '2026-10-05', duration: 3 }),
      ],
      [dep('a', 'b')],
    )
    expect(r.b![0]).toBe('2026-10-05')
  })

  it('逾期未完成：結束日推到今天，後續任務跟著推', () => {
    const r = run(
      [task('a', { status: 'doing', start: '2026-09-28', duration: 2 }), task('b')],
      [dep('a', 'b')],
    )
    expect(r.a).toEqual(['2026-09-28', '2026-10-08'])
    expect(r.b).toEqual(['2026-10-12', '2026-10-12'])
  })

  it('暫停而且逾期：一樣推到今天', () => {
    const r = run([task('a', { status: 'paused', start: '2026-09-28', duration: 2 })])
    expect(r.a).toEqual(['2026-09-28', '2026-10-08'])
  })

  it('今天是週六而且逾期：結束日推到下一個工作天', () => {
    const r = run(
      [task('a', { status: 'doing', start: '2026-09-28', duration: 2 })],
      [],
      dayIndex('2026-10-10'),
    )
    expect(r.a![1]).toBe('2026-10-12')
  })

  it('實際開始日在週六：從下一個工作天算第 1 天', () => {
    const r = run(
      [task('a', { status: 'doing', start: '2026-10-03', duration: 1 })],
      [],
      dayIndex('2026-10-05'),
    )
    expect(r.a).toEqual(['2026-10-03', '2026-10-05'])
  })

  it('完成：結束日＝完成日；完成得早時，未開始的下游仍不早於今天', () => {
    const r = run(
      [
        task('a', { status: 'done', start: '2026-10-01', done: '2026-10-02', duration: 5 }),
        task('b'),
      ],
      [dep('a', 'b')],
    )
    expect(r.a).toEqual(['2026-10-01', '2026-10-02'])
    expect(r.b![0]).toBe('2026-10-08')
  })

  it('相依指向不存在的任務：當作沒有那條前置', () => {
    expect(run([task('b')], [dep('zzz', 'b')])).toEqual({ b: ['2026-10-08', '2026-10-08'] })
  })

  it('沒有開始日的根任務從今天排；工期 0 或 NaN 當 1', () => {
    expect(run([task('a', { start: '' })]).a).toEqual(['2026-10-08', '2026-10-08'])
    expect(run([task('a', { duration: 0 })]).a).toEqual(['2026-10-08', '2026-10-08'])
    expect(run([task('a', { duration: Number.NaN })]).a).toEqual(['2026-10-08', '2026-10-08'])
  })

  it('起訖沒變的回原物件；同樣的輸入結果相同', () => {
    const a = task('a')
    const out = scheduleTasks([a], [], wd, NOW)
    expect(out[0]).toBe(a)
    expect(scheduleTasks([a], [], wd, NOW)).toEqual(out)
  })

  it('資料有環：只略過環上一條相依，其餘照規則排', () => {
    const deps = [dep('a', 'b'), dep('b', 'a'), dep('b', 'c')]
    // 強制放行 a（b 還沒排到，當作沒有前置）→ 10/08；b 接在 a 後面，跳過 10/09 補假、10/10–11 週末 → 10/12；c 接在 b 後面
    expect(run([task('a'), task('b'), task('c')], deps)).toEqual({
      a: ['2026-10-08', '2026-10-08'],
      b: ['2026-10-12', '2026-10-12'],
      c: ['2026-10-13', '2026-10-13'],
    })
  })

  it('長鏈（20000 筆、陣列倒著放）不遞迴、不爆呼叫堆疊', () => {
    const ts = Array.from({ length: 20000 }, (_, i) => task(`n${i}`)).reverse()
    const deps = Array.from({ length: 19999 }, (_, i) => dep(`n${i}`, `n${i + 1}`))
    const by = new Map(scheduleTasks(ts, deps, wd, NOW).map((x) => [x.id, x]))
    expect(by.get('n19999')!.start > by.get('n0')!.start).toBe(true)
  })
})

describe('topoOrder', () => {
  it('前置排在後續之前；起始那批照 ids 的順序', () => {
    const preds = new Map([
      ['c', ['a', 'b']],
      ['b', ['a']],
    ])
    expect(topoOrder(['c', 'b', 'a', 'd'], preds)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('ids 重複只排一次', () => {
    expect(topoOrder(['a', 'a', 'b'], new Map([['b', ['a']]]))).toEqual(['a', 'b'])
  })

  it('有環：只強制放行環上的一個任務；環的下游就算排在陣列最前面，也照常等前置', () => {
    // a ⇄ b、b → c
    const preds = new Map([
      ['a', ['b']],
      ['b', ['a']],
      ['c', ['b']],
    ])
    expect(topoOrder(['c', 'a', 'b'], preds)).toEqual(['b', 'a', 'c'])
    expect(topoOrder(['a', 'b', 'c'], preds)).toEqual(['a', 'b', 'c'])
  })
})

describe('applyTaskEdit', () => {
  const hasPred = new Set(['b'])
  const today = '2026-10-08'
  const edit = (t: Task, patch: Partial<Task>): Task =>
    applyTaskEdit([t], hasPred, t.id, patch, today)[0]!

  it('未開始 → 進行中／暫停：開始日記成今天', () => {
    expect(edit(task('a', { start: '2026-10-20' }), { status: 'doing' }).start).toBe(today)
    expect(edit(task('a', { start: '2026-10-20' }), { status: 'paused' }).start).toBe(today)
  })

  it('未開始 → 完成：開始日、完成日都記成今天', () => {
    const t = edit(task('a', { start: '2026-10-20' }), { status: 'done' })
    expect([t.start, t.done]).toEqual([today, today])
  })

  it('進行中 → 完成：補完成日；已有值不覆蓋', () => {
    const doing = task('a', { status: 'doing', start: '2026-10-01' })
    expect(edit(doing, { status: 'done' }).done).toBe(today)
    const withDone = task('a', { status: 'doing', start: '2026-10-01', done: '2026-10-05' })
    expect(edit(withDone, { status: 'done' }).done).toBe('2026-10-05')
  })

  it('完成 → 進行中：清完成日、開始日不變', () => {
    const done = task('a', { status: 'done', start: '2026-10-01', done: '2026-10-02' })
    const t = edit(done, { status: 'doing' })
    expect([t.start, t.done]).toEqual(['2026-10-01', ''])
  })

  it('已開始 → 未開始：清完成日、保留開始日', () => {
    const done = task('a', { status: 'done', start: '2026-10-01', done: '2026-10-02' })
    const t = edit(done, { status: 'todo' })
    expect([t.start, t.done]).toEqual(['2026-10-01', ''])
  })

  it('有前置的未開始任務：改開始日不會生效，回原陣列', () => {
    const list = [task('b')]
    expect(applyTaskEdit(list, hasPred, 'b', { start: '2026-12-01' }, today)).toBe(list)
  })

  it('工期夾在 1–3650；NaN 不寫入', () => {
    expect(edit(task('a', { duration: 5 }), { duration: 0 }).duration).toBe(1)
    expect(edit(task('a'), { duration: 5000 }).duration).toBe(3650)
    const list = [task('a', { duration: 5 })]
    expect(applyTaskEdit(list, hasPred, 'a', { duration: Number.NaN }, today)).toBe(list)
  })

  it('開始日的上限：進行中不晚於今天、完成不晚於完成日', () => {
    const doing = task('a', { status: 'doing', start: '2026-10-01' })
    expect(edit(doing, { start: '2026-10-20' }).start).toBe(today)
    const done = task('a', { status: 'done', start: '2026-10-01', done: '2026-10-05' })
    expect(edit(done, { start: '2026-10-07' }).start).toBe('2026-10-05')
  })

  it('完成日不早於開始日', () => {
    const done = task('a', { status: 'done', start: '2026-10-05', done: '2026-10-06' })
    expect(edit(done, { done: '2026-10-01' }).done).toBe('2026-10-05')
  })

  it('同時帶狀態與開始日：用 patch 的開始日（夾值後），不套「記成今天」', () => {
    const todo = task('a', { start: '2026-10-20' })
    expect(edit(todo, { status: 'doing', start: '2026-10-03' }).start).toBe('2026-10-03')
    expect(edit(todo, { status: 'doing', start: '2026-10-30' }).start).toBe(today)
  })

  it('沒有變動回原陣列', () => {
    const list = [task('a')]
    expect(applyTaskEdit(list, hasPred, 'a', { name: 'a' }, today)).toBe(list)
  })

  // review：已完成的結束日就是完成日，工期與「清掉完成日」都不會生效，不寫進資料
  it('已完成：改工期不生效、清掉完成日不生效（回原陣列）', () => {
    const list = [
      task('a', { status: 'done', start: '2026-10-01', done: '2026-10-05', duration: 3 }),
    ]
    expect(applyTaskEdit(list, hasPred, 'a', { duration: 9 }, today)).toBe(list)
    expect(applyTaskEdit(list, hasPred, 'a', { done: '' }, today)).toBe(list)
  })

  it('已完成而且完成日是空的舊資料：任何編輯都補上完成日（今天）', () => {
    const legacy = task('a', { status: 'done', start: '2026-10-01', done: '' })
    expect(edit(legacy, { name: '改名' }).done).toBe(today)
  })

  // PM 改了就是新計畫：未開始根任務的開始日同時是計畫開始日；已開始的開始日是實際值，改它不動計畫
  it('未開始根任務改開始日：計畫開始日跟著改；已開始的、有前置的不動計畫', () => {
    const root = task('a', { baselineStart: '2026-10-01' })
    expect(edit(root, { start: '2026-10-20' }).baselineStart).toBe('2026-10-20')
    const doing = task('a', { status: 'doing', start: '2026-10-05', baselineStart: '2026-10-01' })
    expect(edit(doing, { start: '2026-10-06' }).baselineStart).toBe('2026-10-01')
    const list = [task('b', { baselineStart: '2026-10-01' })]
    expect(applyTaskEdit(list, hasPred, 'b', { start: '2026-12-01' }, today)).toBe(list)
  })

  it('未開始 → 進行中：開始日記成實際開工日，計畫開始日留著', () => {
    const t = edit(task('a', { start: '2026-10-01', baselineStart: '2026-10-01' }), {
      status: 'doing',
    })
    expect([t.start, t.baselineStart]).toEqual([today, '2026-10-01'])
  })
})

/**
 * 計畫（規則見 docs/reference/scheduling.md〈計畫與延遲〉）：只看 PM 輸入的東西——根任務的計畫開始日、工期、相依。
 * 今天、實際開工與完工都不影響計畫；現實造成的落後才是延遲。
 */
describe('planTasks', () => {
  /** 計畫起訖，回 { id: [start, end] }。 */
  const plan = (ts: Task[], deps: Dependency[] = []) =>
    Object.fromEntries([...planTasks(ts, deps, wd, NOW)].map(([id, p]) => [id, [p.start, p.end]]))

  it('根任務從計畫開始日起算工期；後續任務接在前置的計畫結束之後', () => {
    // a：計畫 10/01 起 3 個工作天（跳過週末）→ 10/05；b 接在後面 2 天 → 10/06–10/07
    const a = task('a', { baselineStart: '2026-10-01', duration: 3 })
    const b = task('b', { duration: 2 })
    expect(plan([a, b], [dep('a', 'b')])).toEqual({
      a: ['2026-10-01', '2026-10-05'],
      b: ['2026-10-06', '2026-10-07'],
    })
  })

  it('不受今天與實際進度影響：晚開工、逾期、晚完成、還沒開始都照計畫', () => {
    // a 實際 10/06 才開工、b 已逾期、c 晚完成、d 計畫開始日已過還沒開始
    const a = task('a', {
      status: 'doing',
      start: '2026-10-06',
      baselineStart: '2026-10-01',
      duration: 3,
    })
    const c = task('c', {
      status: 'done',
      start: '2026-10-01',
      done: '2026-10-07',
      baselineStart: '2026-10-01',
      duration: 2,
    })
    const d = task('d', { start: '2026-10-08', baselineStart: '2026-10-01' })
    const e = task('e')
    expect(plan([a, c, d, e], [dep('c', 'e')])).toEqual({
      a: ['2026-10-01', '2026-10-05'],
      c: ['2026-10-01', '2026-10-02'],
      d: ['2026-10-01', '2026-10-01'],
      e: ['2026-10-05', '2026-10-05'],
    })
  })

  it('根任務沒有計畫開始日（舊資料）：用存的開始日；遇非工作天順延', () => {
    expect(plan([task('a', { start: '2026-10-09' })])).toEqual({
      a: ['2026-10-12', '2026-10-12'],
    })
  })

  it('長鏈（20000 筆、陣列倒著放）不遞迴、不爆呼叫堆疊', () => {
    const ts = Array.from({ length: 20000 }, (_, i) => task(`n${i}`)).reverse()
    const deps = Array.from({ length: 19999 }, (_, i) => dep(`n${i}`, `n${i + 1}`))
    const plan = planTasks(ts, deps, wd, NOW)
    expect(plan.get('n19999')!.start > plan.get('n0')!.start).toBe(true)
  })
})

describe('scheduleWithPlan', () => {
  it('推算起訖照舊，基準欄位填計畫起訖；晚於計畫的就是延遲', () => {
    // a 實際 10/06 開工，推算到 10/08；計畫 10/01–10/05。b 被推到 10/12 起，計畫 10/06–10/07
    const a = task('a', {
      status: 'doing',
      start: '2026-10-06',
      baselineStart: '2026-10-01',
      duration: 3,
    })
    const b = task('b', { duration: 2 })
    const [x, y] = scheduleWithPlan([a, b], [dep('a', 'b')], wd, NOW)
    expect([x!.start, x!.end, x!.baselineStart, x!.baselineEnd]).toEqual([
      '2026-10-06',
      '2026-10-08',
      '2026-10-01',
      '2026-10-05',
    ])
    expect([y!.start, y!.end, y!.baselineStart, y!.baselineEnd]).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-06',
      '2026-10-07',
    ])
    expect([isLate(x!), isLate(y!)]).toEqual([true, true])
  })

  it('PM 把逾期任務的工期拉長：計畫跟著延長，延遲消失（PM 說了算）', () => {
    const a = task('a', { status: 'doing', start: '2026-10-01', baselineStart: '2026-10-01' })
    expect(isLate(scheduleWithPlan([{ ...a, duration: 2 }], [], wd, NOW)[0]!)).toBe(true)
    expect(isLate(scheduleWithPlan([{ ...a, duration: 6 }], [], wd, NOW)[0]!)).toBe(false)
  })

  it('起訖與計畫都沒變的回原物件', () => {
    const a = task('a', { baselineStart: '2026-10-08', baselineEnd: '2026-10-08' })
    expect(scheduleWithPlan([a], [], wd, NOW)[0]).toBe(a)
  })
})

describe('scheduleProject 的說明（meta）與被略過的相依', () => {
  const meta = (inputs: Task[], deps: Dependency[], id: string, today = NOW) =>
    scheduleProject(inputs, deps, wd, today).meta.get(id)

  it('已開始 → actual；根任務 → root；被推到今天 → today', () => {
    const doing = task('a', { status: 'doing', start: '2026-10-05', duration: 5 })
    expect(meta([doing], [], 'a')!.startBy).toBe('actual')
    expect(meta([task('a', { start: '2026-10-12' })], [], 'a')!.startBy).toBe('root')
    expect(meta([task('a', { start: '2026-10-01' })], [], 'a')!.startBy).toBe('today')
  })

  it('有前置、前置早完成而被推到今天 → today，不帶 predId', () => {
    const a = task('a', { status: 'done', start: '2026-10-01', done: '2026-10-02' })
    expect(meta([a, task('b')], [dep('a', 'b')], 'b')).toEqual({
      startBy: 'today',
      endBy: 'duration',
    })
  })

  it('由前置決定 → pred，帶結束得最晚的那個前置', () => {
    const r = meta(
      [task('a'), task('b', { duration: 3 }), task('c')],
      [dep('a', 'c'), dep('b', 'c')],
      'c',
    )!
    expect([r.startBy, r.predId]).toEqual(['pred', 'b'])
  })

  it('兩個前置同一天結束：取相依先建立的', () => {
    const r = meta([task('a'), task('b'), task('c')], [dep('b', 'c'), dep('a', 'c')], 'c')!
    expect(r.predId).toBe('b')
  })

  it('結束日：done／duration／overdue；逾期帶原定結束日（照工期推算的那天）', () => {
    const done = task('a', { status: 'done', start: '2026-10-01', done: '2026-10-02' })
    expect(meta([done], [], 'a')).toEqual({ startBy: 'actual', endBy: 'done' })
    expect(meta([task('a', { duration: 3 })], [], 'a')).toEqual({
      startBy: 'root',
      endBy: 'duration',
    })
    const overdue = task('a', { status: 'doing', start: '2026-09-28', duration: 2 })
    expect(meta([overdue], [], 'a')).toEqual({
      startBy: 'actual',
      endBy: 'overdue',
      originalEnd: dayIndex('2026-09-29'),
    })
  })

  it('有環：被強制放行的任務當根任務、略過的相依列在 skipped；沒有環時 skipped 是空的', () => {
    const r = scheduleProject([task('a'), task('b')], [dep('a', 'b'), dep('b', 'a')], wd, NOW)
    expect(r.skipped).toEqual([{ from: 'b', to: 'a' }])
    expect(r.meta.get('a')).toEqual({ startBy: 'root', endBy: 'duration' })
    expect(r.meta.get('b')!.predId).toBe('a')
    expect(scheduleProject([task('a'), task('b')], [dep('a', 'b')], wd, NOW).skipped).toEqual([])
  })

  it('tasks 跟 scheduleWithPlan 一樣', () => {
    const ts = [task('a', { duration: 3 }), task('b')]
    const deps = [dep('a', 'b')]
    expect(scheduleProject(ts, deps, wd, NOW).tasks).toEqual(scheduleWithPlan(ts, deps, wd, NOW))
  })
})

describe('explainSchedule', () => {
  /** 用 inputs 排一次，再對某個 id 解釋（根任務要看輸入的開始日，所以傳原始輸入）。 */
  function explain(inputs: Task[], deps: Dependency[], id: string, today = NOW) {
    const scheduled = new Map(scheduleTasks(inputs, deps, wd, today).map((x) => [x.id, x]))
    return explainSchedule(
      inputs.find((x) => x.id === id)!,
      scheduled,
      deps,
      wd,
      today,
    )
  }

  it('已開始 → actual；根任務 → root；被推到今天 → today', () => {
    const doing = task('a', { status: 'doing', start: '2026-10-05', duration: 5 })
    expect(explain([doing], [], 'a')!.startBy).toBe('actual')
    expect(explain([task('a', { start: '2026-10-12' })], [], 'a')!.startBy).toBe('root')
    expect(explain([task('a', { start: '2026-10-01' })], [], 'a')!.startBy).toBe('today')
  })

  it('由前置決定 → pred，帶結束得最晚的那個前置', () => {
    const r = explain(
      [task('a'), task('b', { duration: 3 }), task('c')],
      [dep('a', 'c'), dep('b', 'c')],
      'c',
    )!
    expect([r.startBy, r.predId]).toEqual(['pred', 'b'])
  })

  it('結束日：done／duration／overdue', () => {
    const done = task('a', { status: 'done', start: '2026-10-01', done: '2026-10-02' })
    expect(explain([done], [], 'a')!.endBy).toBe('done')
    expect(explain([task('a', { duration: 3 })], [], 'a')!.endBy).toBe('duration')
    const overdue = task('a', { status: 'doing', start: '2026-09-28', duration: 2 })
    expect(explain([overdue], [], 'a')!.endBy).toBe('overdue')
  })

  it('不存在的任務回 null', () => {
    expect(explainSchedule(task('x'), new Map(), [], wd, NOW)).toBeNull()
  })
})

describe('編輯限制、逾期與有效工期', () => {
  const hasPred = predecessorIds([dep('a', 'b')])

  it('predecessorIds：有前置的任務 id', () => {
    expect([...hasPred]).toEqual(['b'])
  })

  it('有前置的未開始任務：開始日不能改、不能整條拖；工期可以改', () => {
    expect(startBlock(task('b'), hasPred)).toBe('predecessor')
    expect(moveBlock(task('b'), hasPred)).toBe('predecessor')
    expect(durationBlock(task('b'))).toBeNull()
  })

  it('根任務與進行中的任務都可以；已完成不能拖、不能改工期，開始日仍可更正', () => {
    expect([startBlock(task('a'), hasPred), moveBlock(task('a'), hasPred)]).toEqual([null, null])
    const doing = task('b', { status: 'doing', start: '2026-10-01' })
    expect([startBlock(doing, hasPred), moveBlock(doing, hasPred), durationBlock(doing)]).toEqual([
      null,
      null,
      null,
    ])
    const done = task('b', { status: 'done', start: '2026-10-01', done: '2026-10-02' })
    expect([startBlock(done, hasPred), moveBlock(done, hasPred), durationBlock(done)]).toEqual([
      null,
      'done',
      'done',
    ])
  })

  it('逾期與有效工期：進行中、09-28 開工、工期 2，在 10-08 時橫跨 9 個工作天', () => {
    const doing = task('a', { status: 'doing', start: '2026-09-28', duration: 2 })
    const [t] = scheduleTasks([doing], [], wd, NOW)
    expect(isOverdue(t!, wd, NOW)).toBe(true)
    // 09-28～10-08：9/28、29、30、10/1、2、5、6、7、8（測試日曆的假日是 10/9、10/10，不在區間內）
    expect(durationOf(t!, wd)).toBe(9)
  })

  it('有效工期：未開始回輸入值；完成回實際工作天、至少 1', () => {
    expect(durationOf(task('a', { duration: 4 }), wd)).toBe(4)
    const done = task('a', { status: 'done', start: '2026-10-08', end: '2026-10-13', duration: 9 })
    expect(durationOf(done, wd)).toBe(3)
    expect(isOverdue(task('a', { duration: 4 }), wd, NOW)).toBe(false)
  })
})

describe('延遲與計畫進度（依基準）', () => {
  it('已延遲＝未完成，而且推算結束日晚於基準結束日；沒有基準不算', () => {
    expect(isLate(task('a', { end: '2026-10-09', baselineEnd: '2026-10-08' }))).toBe(true)
    expect(isLate(task('a', { end: '2026-10-08', baselineEnd: '2026-10-08' }))).toBe(false)
    const done = task('a', { status: 'done', end: '2026-10-09', baselineEnd: '2026-10-08' })
    expect(isLate(done)).toBe(false)
    expect(isLate(task('a', { end: '2026-10-09' }))).toBe(false)
  })

  it('晚幾個工作天：基準結束隔天到推算結束之間的工作天；沒延遲是 0', () => {
    // 基準 10/08、推算 10/13：10/09 補假、10/10–11 週末 → 10/12、10/13 兩天
    expect(lateDays(task('a', { end: '2026-10-13', baselineEnd: '2026-10-08' }), wd)).toBe(2)
    expect(lateDays(task('a', { end: '2026-10-08', baselineEnd: '2026-10-08' }), wd)).toBe(0)
  })

  it('計畫完成＝基準結束日早於今天', () => {
    expect(isPlannedDone(task('a', { baselineEnd: '2026-10-07' }), NOW)).toBe(true)
    expect(isPlannedDone(task('a', { baselineEnd: '2026-10-08' }), NOW)).toBe(false)
    expect(isPlannedDone(task('a'), NOW)).toBe(false)
  })
})

// 日期選擇器與列選單的說明行原因（文字在 constants 的 EDIT_NOTE_TEXT）；開浮層估高與畫面用同一個判斷
describe('說明行原因', () => {
  const hasPred = new Set(['b'])

  it('taskPickerNote：有前置未開始 → predecessor；完成 → done；進行中對準開始日 → startAfterToday；逾期對準結束日 → overdueShrink', () => {
    expect(taskPickerNote(task('b'), 'end', hasPred, wd, NOW)).toBe('predecessor')
    const done = task('a', { status: 'done', done: '2026-10-08' })
    expect(taskPickerNote(done, 'start', hasPred, wd, NOW)).toBe('done')
    const doing = task('a', { status: 'doing', start: '2026-10-05', duration: 9 })
    expect(taskPickerNote(doing, 'start', hasPred, wd, NOW)).toBe('startAfterToday')
    const overdue = task('a', { status: 'doing', start: '2026-09-01', duration: 2 })
    expect(taskPickerNote(overdue, 'end', hasPred, wd, NOW)).toBe('overdueShrink')
    expect(taskPickerNote(task('a'), 'start', hasPred, wd, NOW)).toBeNull()
  })

  it('durationNote：完成 → done；逾期 → overdueShrink；其他沒有', () => {
    expect(durationNote(task('a', { status: 'done', done: '2026-10-08' }), wd, NOW)).toBe('done')
    expect(
      durationNote(task('a', { status: 'doing', start: '2026-09-01', duration: 2 }), wd, NOW),
    ).toBe('overdueShrink')
    expect(durationNote(task('a'), wd, NOW)).toBeNull()
  })
})
