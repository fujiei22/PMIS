import { dayIndex, isoFromIndex } from '@/lib/date'
import { clampDuration, isOverdue, isStarted, sameTask } from '@/lib/schedule'
import type { Workdays } from '@/lib/workdays'
import type { Task } from '@/types/models'

/**
 * 編輯限制：一個任務此刻能怎麼改、不能的原因、可選日期的上下限（規則見 docs/reference/scheduling.md〈編輯限制〉）。
 * 甘特條、拖曳、日期選擇器、卡片 ±1、列選單、開浮層的估高、store 的 applyTaskEdit 都讀這一份，不各自判斷
 * （src/__tests__/edit-policy-guard.spec.ts 守）。全部是純函式，不碰 store。
 *
 * 管的範圍是排程類的編輯：開始日、工期、整條拖、把手、起訖選擇器、±1。還沒歸這裡管的入口：
 * - 改狀態：OptionMenu、屬性面板；store 的 applyTaskEdit 不擋狀態
 * - 完成日：DatePicker 的完成日選擇器、useMenus.openIssueDatePicker、store 的 setTaskDoneDirect
 * - 相依：usePointerDrag 的拉線、DependencyEditor（候選清單用全部任務）、store 的 addDep（只擋環）
 * - 搬列或卡片：moveTaskTo（三層時等於換上層）
 * 三層任務（上層由下層彙總、唯讀）要擋它們時，在 EditPolicy 加欄位（例如 statusBlock、doneBlock、linkBlock）、
 * EditCtx 帶「有子任務」的集合、EditBlock 加 'rollup' 原因，並讓那些入口與 store 端改讀它。
 * 唯讀（canEdit）不在這裡：由 `ui.canEdit` 與各入口的開關另外擋。
 */

/**
 * 不能編輯的原因（null＝可以）；文字在 constants 的 `EDIT_BLOCK_TEXT`。
 * missing：任務已不存在（`LOCKED_POLICY`，各入口一致預設擋下）。
 */
export type EditBlock = 'predecessor' | 'done' | 'missing' | null

/** 判斷編輯限制需要的情境；task store 組好（不公開），各入口經 `policyOf` 間接用。 */
export interface EditCtx {
  /** 有前置的任務 id：排程真的用到的前置（兩端都存在、沒被環略過；`Scheduled.hasPred`）。 */
  hasPred: ReadonlySet<string>
  wd: Workdays
  todayIdx: number
}

/**
 * 說明行的原因（日期選擇器、列選單）：擋下的原因，加上三種只在說明行出現的情況。
 * 文字在 constants 的 `EDIT_NOTE_TEXT`（`satisfies Record<EditNote, string>`，少一個就編譯不過）。
 */
export type EditNote =
  NonNullable<EditBlock> | 'startAfterToday' | 'overdueShrink' | 'pastStartLate'

/** 一個任務此刻的編輯限制；Block 欄位是 null、overdue 是 false、Idx 欄位是 null 表示沒有限制。 */
export interface EditPolicy {
  /** 整條拖、左把手（都會改開始日）：完成的不能；有前置、未開始的不能。 */
  moveBlock: EditBlock
  /** 日期選擇器改開始日：有前置、未開始的不能（已完成的可以更正）。 */
  startBlock: EditBlock
  /** 改工期（右把手、±1、工期欄、選結束日）：完成的不能（結束日就是完成日）。 */
  durationBlock: EditBlock
  /** 逾期未完成：結束日暫定今天，縮短工期不會讓它早於今天（−1 停用、右把手拖到今天以前不送）。 */
  overdue: boolean
  /** 開始日上限（日索引，含）：進行中／暫停＝今天；完成＝完成日；其他沒有。拖曳夾值、日期選擇器停用格子都看它。 */
  startMaxIdx: number | null
  /** 日期選擇器選結束日的下限（日索引，含）：開始日不能改時＝開始日（沒辦法對調）；逾期＝今天；其他沒有。 */
  endMinIdx: number | null
  /**
   * 提醒、不是限制：未開始的根任務，開始日可以選今天以前——照設成計畫開始日，但最快今天開工，所以直接算延遲。
   * 日期選擇器對準哪一端都顯示說明行。
   */
  warnPastStart: boolean
  /**
   * 日期選擇器選結束日時，換算工期的起點（日索引；沒有開始日是 null）。未開始的根任務、推算開始日被順延到今天
   * （計畫開始日已過）時是計畫開始日——PM 點的日子就是計畫；其他是畫面上的開始日。
   * 甘特右把手不讀它：拖曳時條的右端跟著滑鼠，從畫面上的開始日算（2026-10-03 定案）。
   */
  endBaseIdx: number | null
}

/** 任務不存在時的 policy：什麼都不能改。`policyOf` 對不存在的 id 回它，各入口不必處理 undefined。 */
export const LOCKED_POLICY: EditPolicy = Object.freeze<EditPolicy>({
  moveBlock: 'missing',
  startBlock: 'missing',
  durationBlock: 'missing',
  overdue: false,
  startMaxIdx: null,
  endMinIdx: null,
  warnPastStart: false,
  endBaseIdx: null,
})

/**
 * 任務 t 此刻的編輯限制。只讀 id、status、done、start、duration、baselineStart：
 * 畫面入口傳推算後的任務；store 的 applyTaskEdit 傳套用編輯後的存的值。已開始的任務兩者這幾欄相同；
 * 未開始的，applyTaskEdit 只用到 status 與 id 決定的欄位（startBlock、durationBlock、startMaxIdx）——
 * endMinIdx、endBaseIdx 讀的 start、baselineStart 只對畫面（推算後的值）有意義。
 * 要多讀別的欄位前，先確認兩種來源都對。
 */
export function editPolicy(t: Task, ctx: EditCtx): EditPolicy {
  const done = t.status === 'done'
  const startBlock: EditBlock = t.status === 'todo' && ctx.hasPred.has(t.id) ? 'predecessor' : null
  const overdue = isOverdue(t, ctx.wd, ctx.todayIdx)
  let startMaxIdx: number | null = null
  if (t.status === 'doing' || t.status === 'paused') startMaxIdx = ctx.todayIdx
  else if (done && t.done) startMaxIdx = dayIndex(t.done)
  let endMinIdx: number | null = startBlock && t.start ? dayIndex(t.start) : null
  if (overdue) endMinIdx = Math.max(endMinIdx ?? ctx.todayIdx, ctx.todayIdx)
  const warnPastStart = t.status === 'todo' && !startBlock
  const startIdx = t.start ? dayIndex(t.start) : null
  // 被順延到今天：未開始的根任務，推算開始日就是今天（或今天之後第一個工作天）、而計畫開始日在它之前
  const pushed =
    warnPastStart &&
    !!t.baselineStart &&
    startIdx === ctx.wd.onOrAfter(ctx.todayIdx) &&
    dayIndex(t.baselineStart) < startIdx
  return {
    moveBlock: done ? 'done' : startBlock,
    startBlock,
    durationBlock: done ? 'done' : null,
    overdue,
    startMaxIdx,
    endMinIdx,
    warnPastStart,
    endBaseIdx: pushed ? dayIndex(t.baselineStart) : startIdx,
  }
}

/** 兩份 policy 的每個欄位都相同（store 的 identity 快取用：沒變就沿用舊物件，元件不會重繪）。 */
export function samePolicy(a: EditPolicy, b: EditPolicy): boolean {
  return (Object.keys(a) as (keyof EditPolicy)[]).every((k) => a[k] === b[k])
}

/**
 * 起訖日期選擇器的說明行：對準開始日或結束日時，哪條規則讓某些格子停用、或選了有後果（null＝沒有）。
 * 畫面（DatePicker）與開浮層時的估高（useMenus）用同一個判斷。
 */
export function taskPickerNote(p: EditPolicy, target: 'start' | 'end'): EditNote | null {
  const block = p.startBlock ?? p.durationBlock
  if (block) return block
  if (target === 'start' && p.startMaxIdx !== null) return 'startAfterToday'
  if (target === 'end' && p.overdue) return 'overdueShrink'
  // 未開始的根任務：選了開始日、選擇器換到結束日時，說明也要留著
  return p.warnPastStart ? 'pastStartLate' : null
}

/** 工期 ±1（卡片 ▲▼、列選單 +1／−1）的說明行：不能改工期的兩顆都停、逾期只停 −1（null＝沒有）。 */
export function durationNote(p: EditPolicy): EditNote | null {
  if (p.durationBlock) return p.durationBlock
  return p.overdue ? 'overdueShrink' : null
}

/**
 * 套用使用者的編輯到原始輸入（規則見 docs/reference/scheduling.md〈狀態改變時寫入的值〉
 * 〈不會生效的輸入不寫進資料〉）。沒有變動回原陣列；變動的那筆是新物件，其他保留原物件。
 * 能不能改、開始日的上限都問 `editPolicy`（看套用後的狀態），跟畫面上的入口同一份規則；
 * 只看「有沒有擋」、不比對原因碼：EditBlock 加新原因時，開始日與工期這兩欄會自動跟著擋。
 * 狀態、完成日還不歸 policy 管（見檔頭），三層任務要擋上層時另外處理。
 *
 * - 狀態改變：未開始 → 已開始時開始日記成今天（patch 同時帶 start 就用 patch 的）；
 *   進完成補完成日（已有值不覆蓋）；離開完成清完成日。
 * - 開始日不能改的（有前置、未開始）：start 丟掉。
 * - 沒有前置、未開始的任務：start 同時寫進 `baselineStart`（計畫開始日，見〈計畫與延遲〉）；今天以前也照設。
 * - 夾值：工期 1–3650（NaN 丟掉）；開始日不晚於上限（進行中／暫停：今天；完成：完成日）；完成日不早於開始日。
 * - 工期不能改的（已完成）：工期丟掉；完成日不能清掉。
 */
export function applyTaskEdit(
  tasks: Task[],
  ctx: EditCtx,
  id: string,
  patch: Partial<Task>,
): Task[] {
  const target = tasks.find((x) => x.id === id)
  if (!target) return tasks
  const todayIso = isoFromIndex(ctx.todayIdx)
  const clean: Partial<Task> = { ...patch }
  if ('duration' in clean) {
    if (!Number.isFinite(clean.duration)) delete clean.duration
    else clean.duration = clampDuration(clean.duration!)
  }
  // id 不跟著 patch 改：編輯限制要用任務本身的 id 查前置
  const next: Task = { ...target, ...clean, id: target.id }

  if (clean.status && clean.status !== target.status) {
    if (!isStarted(target) && isStarted(next) && !('start' in clean)) next.start = todayIso
    if (next.status === 'done') {
      if (!next.done) next.done = todayIso
    } else next.done = ''
  }
  // 已完成：完成日不能清掉（缺的舊資料補上今天）；先補，下面的開始日上限才算得出來
  if (next.status === 'done' && !next.done)
    next.done = target.status === 'done' && target.done ? target.done : todayIso

  const p = editPolicy(next, ctx)
  // 開始日不能改（有前置、未開始：由前置決定），存了也不會生效
  if ('start' in clean && p.startBlock) next.start = target.start
  // 未開始根任務的開始日就是計畫開始日：PM 改了就是新計畫（已開始的開始日是實際值，改它不動計畫）
  else if ('start' in clean && next.status === 'todo') next.baselineStart = next.start
  // 工期不能改（已完成：結束日就是完成日）
  if (p.durationBlock) next.duration = target.duration
  // 完成的起訖：改的是完成日就把完成日夾到開始日以後；其他情況開始日不晚於上限
  if (next.status === 'done' && 'done' in clean && next.done < next.start) next.done = next.start
  else if (p.startMaxIdx !== null && dayIndex(next.start) > p.startMaxIdx)
    next.start = isoFromIndex(p.startMaxIdx)

  if (sameTask(next, target)) return tasks
  return tasks.map((x) => (x.id === id ? next : x))
}
