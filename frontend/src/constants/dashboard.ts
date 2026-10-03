import type { IssueItem, IssueLevel, IssueStatus, Priority, TaskStatus } from '@/types/models'

/**
 * Dashboard 的顯示常數。
 * 值逐字取自 legacy/Dashboard.html 的 DCLogic 欄位（括號內是原始欄位名與行號）。
 * 顏色同時存在於 tokens.css，各項標了對應的變數名；改色要兩邊一起改。
 */

/** 甘特圖每一列的高度（px）。legacy `ROW` :1705；同 tokens.css `--gantt-row` */
export const ROW_HEIGHT = 34

/** 任務優先度。legacy `PR` :1706 */
export const PRIORITY = {
  high: { label: '高', color: '#dc2626' }, // --pr-high
  mid: { label: '中', color: '#d97706' }, // --pr-mid
  low: { label: '低', color: '#0891b2' }, // --pr-low
} as const satisfies Record<Priority, { label: string; color: string }>

/** 任務狀態。color 用於文字、bar 用於甘特條、dot 用於小圓點。legacy `ST` :1707 */
export const TASK_STATUS = {
  todo: { label: '待辦', color: '#64748b', bar: '#64748b', dot: '#94a3b8' }, // --st-todo*
  doing: { label: '執行中', color: '#2563eb', bar: '#2563eb', dot: '#3b82f6' }, // --st-doing*
  done: { label: '已完成', color: '#059669', bar: '#047857', dot: '#10b981' }, // --st-done*
  paused: { label: '暫停中', color: '#b45309', bar: '#b45309', dot: '#f59e0b' }, // --st-paused*
} as const satisfies Record<TaskStatus, { label: string; color: string; bar: string; dot: string }>

/** 已延遲：不是真的狀態，是 status 之外疊上去的顯示狀態。legacy `DELAYED` :1713；--st-delayed* */
export const DELAYED = {
  label: '已延遲',
  color: '#dc2626',
  bar: '#dc2626',
  dot: '#ef4444',
} as const

/** Issue 等級。color 用於填色、text 用於白底上的文字。legacy `ICL` :1714 */
export const ISSUE_LEVEL = {
  A: {
    label: 'Critical',
    color: '#b91c1c', // --cls-a
    text: '#b91c1c', // --cls-a-text
    desc: '具危害因子，未解決不得進入下一階段',
  },
  B: {
    label: 'Major',
    color: '#dc2626', // --cls-b
    text: '#dc2626', // --cls-b-text
    desc: '主要功能失效，系統無法運作',
  },
  C: {
    label: 'Minor',
    color: '#d97706', // --cls-c
    text: '#b45309', // --cls-c-text
    desc: '功能異常',
  },
  D: {
    label: 'Limitation',
    color: '#0891b2', // --cls-d
    text: '#0e7490', // --cls-d-text
    desc: '功能性限制',
  },
} as const satisfies Record<
  IssueLevel,
  { label: string; color: string; text: string; desc: string }
>

/** Issue 分類。legacy `IITEM` :1720 */
export const ISSUE_ITEM = {
  C: { label: 'Compatibility', zh: '相容性' },
  R: { label: 'Reliability', zh: '可靠性' },
  F: { label: 'Function', zh: '功能' },
  O: { label: 'Other', zh: '其他' },
} as const satisfies Record<IssueItem, { label: string; zh: string }>

/**
 * Issue 處理狀態。legacy `IST` :1726。
 *
 * review m2：`dot`（狀態小圓點的顏色）原本在 SummaryCards / IssuePanel / TopBar /
 * TaskProperties 各自抄一份 `{open:'todo',doing:'doing',paused:'paused',closed:'done'}`
 * 再去查 `TASK_STATUS[...].dot`（legacy :3563 / :3632 / :3750）。值攤平放這裡，四處改讀常數。
 */
export const ISSUE_STATUS = {
  // dot 取自 TASK_STATUS.todo / doing / paused / done 的 dot（legacy ST :1707）
  open: { label: '待處理', bg: '#f1f5f9', fg: '#64748b', bd: '#e2e8f0', dot: '#94a3b8' }, // --ist-open-*
  doing: { label: '處理中', bg: '#eff6ff', fg: '#2563eb', bd: '#bfdbfe', dot: '#3b82f6' }, // --ist-doing-*
  paused: { label: '暫停中', bg: '#fffbeb', fg: '#b45309', bd: '#fde68a', dot: '#f59e0b' }, // --ist-paused-*
  closed: { label: '已解決', bg: '#ecfdf5', fg: '#059669', bd: '#a7f3d0', dot: '#10b981' }, // --ist-closed-*
} as const satisfies Record<
  IssueStatus,
  { label: string; bg: string; fg: string; bd: string; dot: string }
>

/** 任務看板可排序的欄位。legacy `KSORT` :2043 */
export const TASK_SORT_KEYS = [
  { k: 'start', label: '時程' },
  { k: 'days', label: '工期' },
  { k: 'priority', label: '優先度' },
  { k: 'issue', label: 'Issue' },
  { k: 'created', label: '建立日期' },
] as const satisfies readonly { k: string; label: string }[]

/**
 * Issue 看板可排序的欄位。legacy `ISORT` :2048。
 * `priority` 這個 key 沿用 legacy，對到的是 `Issue.level`（契約 A 的欄位改名）。
 */
export const ISSUE_SORT_KEYS = [
  { k: 'priority', label: '等級' },
  { k: 'item', label: '分類' },
  { k: 'due', label: '期限' },
  { k: 'status', label: '處理狀態' },
  { k: 'created', label: '建立日期' },
] as const satisfies readonly { k: string; label: string }[]

/* ── 排程（規則見 docs/reference/scheduling.md）──────────────────────────── */

/** 不能編輯的原因（甘特條的 title、日期選擇器的說明行共用）；key 對到 lib/schedule.ts 的 EditBlock。 */
export const EDIT_BLOCK_TEXT = {
  predecessor: '開始日由前置任務決定，只能調整工期',
  done: '已完成：結束日就是完成日；改完成日請用「完成日」',
} as const

/** 開始日是怎麼來的（explainSchedule 的 startBy）。 */
export const START_REASON_TEXT = {
  actual: '實際開工日',
  root: '設定的開始日',
  pred: (name: string) => `前置「${name}」結束後開始`,
  today: '尚未開始，順延到今天',
} as const

/** 結束日是怎麼來的（explainSchedule 的 endBy）；overdue 帶原定的結束日（已格式化）。 */
export const END_REASON_TEXT = {
  done: '完成日',
  duration: '依工期推算',
  overdue: (planned: string) => `逾期未完成，結束日暫定今天（原定 ${planned}）`,
} as const

/** 延遲 chip 的 title；兩個參數都已格式化（計畫結束日 MM/DD、晚幾個工作天）。 */
export const LATE_TITLE = (planEnd: string, late: string): string =>
  `計畫結束 ${planEnd}，晚 ${late}`

/** 逾期時 −1 停用的說明。 */
export const OVERDUE_SHRINK_TEXT = '逾期中，結束日最早是今天'

/** 甘特標題列的日曆提示；years 是已合併的年份字串（例 2027–2028）。 */
export const CALENDAR_NOTICE = {
  uncovered: (years: string) => `${years} 年假日未公布，只排除週末`,
  error: '假日資料載入失敗，只排除週末；重新整理可重試',
} as const

/**
 * 屬性面板「計畫」列的文案（規則見 docs/reference/scheduling.md〈計畫與延遲〉）。
 * rule：膠囊的 title，說明計畫怎麼來；late 的參數已格式化（例「2 工作天」）。
 */
export const BASELINE_ROW_TEXT = {
  label: '計畫',
  rule: '依開始日、工期、相依排出；PM 改了就是新計畫，實際進度晚於計畫才算延遲',
  late: (n: string) => `晚 ${n}`,
} as const

/**
 * 日期選擇器裡停用格子的說明（EDIT_BLOCK_TEXT、OVERDUE_SHRINK_TEXT 以外的情況）；
 * 顯示成看得見的一行 caption，觸控看不到 title。
 */
export const PICK_LIMIT_TEXT = {
  startAfterToday: '已開始：開始日最晚是今天',
  doneBeforeStart: '完成日不能早於開始日',
  /** 已完成任務的完成日選擇器：「清除」停用的原因。 */
  doneRequired: '已完成的任務一定有完成日；要清掉請先改狀態',
} as const

/** 說明行的文字（key 對到 lib/schedule.ts 的 EditNote）：日期選擇器、列選單共用。 */
export const EDIT_NOTE_TEXT = {
  predecessor: EDIT_BLOCK_TEXT.predecessor,
  done: EDIT_BLOCK_TEXT.done,
  startAfterToday: PICK_LIMIT_TEXT.startAfterToday,
  overdueShrink: OVERDUE_SHRINK_TEXT,
} as const

/** 日期選擇器底部的本月假日；list 是已組好的「M/D 名稱」清單（以頓號連接）。 */
export const MONTH_HOLIDAYS_TEXT = (list: string): string => `本月假日：${list}`
