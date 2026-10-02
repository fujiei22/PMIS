/**
 * Dashboard 的資料模型。
 * 元件與 store 一律引用這裡的型別，不各自重寫。
 */

/** 'YYYY-MM-DD'；空值用 ''（沿用 legacy；接後端時在 src/api 轉換層把 null 正規化成 ''） */
export type ISODate = string

export type TaskStatus = 'todo' | 'doing' | 'paused' | 'done'
export type Priority = 'high' | 'mid' | 'low'
export type IssueLevel = 'A' | 'B' | 'C' | 'D'
export type IssueItem = 'C' | 'R' | 'F' | 'O'
export type IssueStatus = 'open' | 'doing' | 'paused' | 'closed'

/** 甘特圖左欄的任務分類；收合與否是畫面狀態，放在 `useUiStore().collapsedGroups`（契約 A） */
export interface Group {
  id: string
  name: string
}

export interface Member {
  id: string
  name: string
  role: string
  /** 頭像與標籤用的色碼；成員色由資料提供，不走 token */
  color: string
}

export interface Task {
  id: string
  groupId: string
  name: string
  created: ISODate
  start: ISODate
  end: ISODate
  status: TaskStatus
  /** 完成日；status 不是 done 時為 '' */
  done: ISODate | ''
  priority: Priority
  assigneeIds: string[]
}

/** 相依：from 先完成、to 後開始 */
export interface Dependency {
  id: string
  from: string
  to: string
}

export interface Issue {
  id: string
  taskId: string
  created: ISODate
  title: string
  item: IssueItem
  level: IssueLevel
  creatorId: string
  ownerIds: string[]
  status: IssueStatus
  due: ISODate | ''
  done: ISODate | ''
  ptype: string
  pcb: string
  bios: string
  os: string
  desc: string
  solution: string
  solvedBios: string
}

/**
 * 留言附件；mocks 無 url，送出留言時圖片才有 blob url。
 * `id` 是 `api.downloadAttachment(attachmentId)` 的鍵，格式 `<commentId>:<index>`（契約 A）。
 */
export interface Attachment {
  id: string
  name: string
  size: number
  at: ISODate
  url?: string
}

export interface Comment {
  id: string
  /** 留言掛的對象 id（任務或 Issue） */
  targetId: string
  targetKind: 'task' | 'issue'
  memberId: string
  /** 'YYYY-MM-DDTHH:mm' 本地時間 */
  at: string
  text: string
  files: Attachment[]
}

/**
 * 拖曳 / 放置的落點：分類（可分上下半）或某個任務。
 * 放在 models 而不是 ui store：`taskStore.moveTaskTo` 的參數型別，資料層不該 import 派生層（契約 E）。
 */
export type DropTarget = { kind: 'g'; id: string; dir?: 'up' | 'down' } | { kind: 't'; id: string }

/** 專案預算與已支出，金額單位由畫面決定（目前顯示為 $）；剩餘是算出來的，不存。 */
export interface Budget {
  total: number
  actual: number
}

export interface ProjectData {
  groups: Group[]
  members: Member[]
  tasks: Task[]
  deps: Dependency[]
  issues: Issue[]
  comments: Comment[]
  budget: Budget
  currentUserId: string
}

/* ── 多專案總覽 ─────────────────────────────────────────── */

/** 專案整體狀態：未開始 / 進行中 / 已完成 */
export type ProjectStatus = 'todo' | 'doing' | 'done'

/** 專案需注意程度：落後 / 需注意 / 無；由前端依摘要數字派生（lib/portfolio.ts 的 alertOf） */
export type ProjectAlert = 'late' | 'watch' | 'none'

/** 專案速覽裡的一筆近期到期任務 */
export interface UpcomingTask {
  /** 任務名稱 */
  name: string
  /** 到期日 */
  due: ISODate
  /** 負責成員 id */
  memberId: string
}

/** 總覽頁用的單一專案摘要；由後端彙整（mock 端見 api/mock/portfolio.ts） */
export interface ProjectSummary {
  /** 專案 id，也是 `/projects/:id` 的路由參數 */
  id: string
  /** 專案名稱 */
  name: string
  /** 專案經理的成員 id */
  pmId: string
  /** 專案整體狀態 */
  status: ProjectStatus
  /** 專案開始日 */
  startDate: ISODate
  /** 專案到期日 */
  dueDate: ISODate
  /** 任務總數 */
  taskTotal: number
  /** 已完成任務數 */
  taskDone: number
  /** 依排程此刻應完成的任務數（後端算）。 */
  taskPlanned: number
  /** 各任務狀態的數量 */
  taskCounts: { done: number; doing: number; paused: number; todo: number }
  /** 已逾期但未完成的任務數 */
  delayedTasks: number
  /** 各等級未結 Issue 數 */
  openIssues: Record<IssueLevel, number>
  /** 已結 Issue 數 */
  closedIssues: number
  /** 參與成員 id（速覽的頭像疊） */
  memberIds: string[]
  /** 近期到期任務，後端已依到期日排序、最多 3 筆。 */
  upcoming: UpcomingTask[]
}

/** `api.listProjects()` 的回傳：專案摘要清單、成員名錄、登入者 */
export interface PortfolioData {
  /** 所有專案摘要 */
  projects: ProjectSummary[]
  /** 成員名錄（含 PM） */
  members: Member[]
  /** 登入者的成員 id */
  currentUserId: string
}
