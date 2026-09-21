import { ApiError, type ApiErrorCode } from '@/api/types'
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

/**
 * api 錯誤碼對應的固定中文（review M2）。
 * server 原文（`ApiError.message`）只進 console，畫面只給這一句 + 操作名稱。
 */
export const API_ERROR_TEXT = {
  network: '連線失敗',
  validation: '資料不合法',
  not_found: '資料已不存在',
  conflict: '與伺服器狀態衝突',
  unknown: '發生錯誤',
} as const satisfies Record<ApiErrorCode, string>

/** 任何例外 → 錯誤碼；不是 ApiError 的一律 unknown。 */
export function apiErrorCode(error: unknown): ApiErrorCode {
  return error instanceof ApiError ? error.code : 'unknown'
}
