import { sampleProject } from '@/mocks/sampleProject'
import type { Member, ProjectStatus, ProjectSummary } from '@/types/models'

/**
 * 多專案總覽的範例資料（設計稿 `content.md` 第三輪）。
 *
 * PMIS 不在這裡寫死：mock 每次 `listProjects()` 都從 mock store 裡那份完整專案資料
 * 即時彙整（`api/mock/portfolio.ts` 的 `summarizeProject`），在 Dashboard 改了任務，
 * 回到總覽就看得到（spec 7b）。其餘 6 個專案沒有完整資料，只有這份靜態摘要。
 *
 * 靜態專案的任務數經過調整，讓 `Math.round` 算出的實際 / 理論 % 與設計稿一致；
 * `mocks/__tests__/portfolio.spec.ts` 守著這組數字。
 */

/** PMIS 的摘要中，不能從任務資料推出來的欄位。 */
export const PMIS_META: { id: string; name: string; pmId: string; status: ProjectStatus } = {
  id: 'pmis',
  name: 'PMIS 專案管理系統',
  pmId: 'm5',
  status: 'doing',
}

/** 總覽的成員名錄：m1–m7 直接引用範例專案的成員（同一份，不會走樣），再加上三位 PM 與 PM 主管。 */
export const PORTFOLIO_MEMBERS: Member[] = [
  ...sampleProject.members,
  { id: 'm8', name: '成員8', role: '專案經理', color: '#7c3aed' },
  { id: 'm9', name: '成員9', role: '專案經理', color: '#0891b2' },
  { id: 'm10', name: '成員10', role: '專案經理', color: '#db2777' },
  { id: 'm11', name: '成員11', role: 'PM 主管', color: '#475569' },
]

/** 登入者：PM 主管。 */
export const PORTFOLIO_CURRENT_USER = 'm11'

/** 其餘 6 個專案的靜態摘要。 */
export const STATIC_PROJECTS: ProjectSummary[] = [
  {
    id: 'portal',
    name: '客戶入口網站改版',
    pmId: 'm8',
    status: 'doing',
    startDate: '2026-07-06',
    dueDate: '2026-10-16',
    taskTotal: 52,
    taskDone: 32,
    taskPlanned: 39,
    taskCounts: { done: 32, doing: 11, paused: 0, todo: 9 },
    delayedTasks: 1,
    openIssues: { A: 1, B: 0, C: 2, D: 0 },
    closedIssues: 8,
    memberIds: ['m1', 'm3', 'm4', 'm7', 'm8'],
    upcoming: [
      { name: '無障礙檢測修正', due: '2026-09-23', memberId: 'm1' },
      { name: 'UAT 第二輪', due: '2026-09-26', memberId: 'm4' },
      { name: '上線前效能壓測', due: '2026-09-30', memberId: 'm7' },
    ],
  },
  {
    id: 'payment',
    name: '金流介接',
    pmId: 'm5',
    status: 'doing',
    startDate: '2026-09-01',
    dueDate: '2026-10-31',
    taskTotal: 25,
    taskDone: 7,
    taskPlanned: 8,
    taskCounts: { done: 7, doing: 5, paused: 0, todo: 13 },
    delayedTasks: 0,
    openIssues: { A: 0, B: 0, C: 1, D: 1 },
    closedIssues: 1,
    memberIds: ['m2', 'm5', 'm6'],
    upcoming: [
      { name: '交易對帳批次', due: '2026-09-25', memberId: 'm6' },
      { name: '退款流程', due: '2026-09-29', memberId: 'm2' },
      { name: '沙盒環境驗證', due: '2026-10-02', memberId: 'm2' },
    ],
  },
  {
    id: 'dw',
    name: '報表資料倉儲',
    pmId: 'm9',
    status: 'done',
    startDate: '2026-06-15',
    dueDate: '2026-09-12',
    taskTotal: 24,
    taskDone: 24,
    taskPlanned: 24,
    taskCounts: { done: 24, doing: 0, paused: 0, todo: 0 },
    delayedTasks: 0,
    openIssues: { A: 0, B: 0, C: 0, D: 0 },
    closedIssues: 11,
    memberIds: ['m2', 'm6', 'm7', 'm9'],
    upcoming: [],
  },
  {
    id: 'app',
    name: '行動 App v2',
    pmId: 'm8',
    status: 'doing',
    startDate: '2026-09-15',
    dueDate: '2027-01-20',
    taskTotal: 80,
    taskDone: 3,
    taskPlanned: 4,
    taskCounts: { done: 3, doing: 6, paused: 0, todo: 71 },
    delayedTasks: 0,
    openIssues: { A: 0, B: 0, C: 0, D: 1 },
    closedIssues: 0,
    memberIds: ['m1', 'm3', 'm4', 'm6', 'm7', 'm8'],
    upcoming: [
      { name: '資訊架構定稿', due: '2026-09-26', memberId: 'm3' },
      { name: '開發環境建置', due: '2026-09-30', memberId: 'm7' },
      { name: '登入流程原型', due: '2026-10-03', memberId: 'm1' },
    ],
  },
  {
    id: 'wiki',
    name: '內部知識庫',
    pmId: 'm10',
    status: 'doing',
    startDate: '2026-08-03',
    dueDate: '2026-09-30',
    taskTotal: 25,
    taskDone: 15,
    taskPlanned: 22,
    taskCounts: { done: 15, doing: 3, paused: 3, todo: 4 },
    delayedTasks: 4,
    openIssues: { A: 0, B: 2, C: 2, D: 0 },
    closedIssues: 3,
    memberIds: ['m1', 'm2', 'm10'],
    upcoming: [
      { name: '全文檢索', due: '2026-09-23', memberId: 'm2' },
      { name: '權限分級', due: '2026-09-26', memberId: 'm2' },
      { name: '匯入舊文件', due: '2026-09-29', memberId: 'm1' },
    ],
  },
  {
    id: 'vendor',
    name: '供應商入口 v1',
    pmId: 'm9',
    status: 'todo',
    startDate: '2026-10-12',
    dueDate: '2027-01-08',
    taskTotal: 22,
    taskDone: 0,
    taskPlanned: 0,
    taskCounts: { done: 0, doing: 0, paused: 0, todo: 22 },
    delayedTasks: 0,
    openIssues: { A: 0, B: 0, C: 0, D: 0 },
    closedIssues: 0,
    memberIds: ['m2', 'm6', 'm9'],
    upcoming: [],
  },
]
