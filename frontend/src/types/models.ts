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
  /**
   * 沒停用。停用的人不能再被加進負責人、提出人、Issue 負責人，
   * 但原本就指派給他的照樣顯示（指派類下拉只列 active，見 `memberStore.assignable`）。
   */
  active: boolean
}

/**
 * 任務。起訖由排程推算（規則見 docs/reference/scheduling.md），store 對外的 `tasks` 是推算後的結果。
 *
 * 存的 `start` 的語意：已開始（進行中／暫停／完成）＝實際開始日；未開始的根任務＝設定的開始日；
 * 未開始、有前置的任務＝上次推算並寫回的快照。`end` 一律是上次推算並寫回的快照。
 */
export interface Task {
  id: string
  groupId: string
  name: string
  created: ISODate
  start: ISODate
  end: ISODate
  status: TaskStatus
  /** 完成日（實際結束日）；status 不是 done 時為 '' */
  done: ISODate | ''
  priority: Priority
  assigneeIds: string[]
  /** 工期（工作天，1–3650）。這是輸入值；結束日由排程推算。 */
  duration: number
  /** 計畫基準的開始日；'' 表示沒有基準（不算延遲、不算計畫完成）。 */
  baselineStart: ISODate | ''
  /** 計畫基準的結束日；'' 表示沒有基準。 */
  baselineEnd: ISODate | ''
}

/** 相依：from 先完成、to 後開始 */
export interface Dependency {
  id: string
  from: string
  to: string
}

/** 工作日曆的一天（`GET /api/calendar`）：跟預設週末不同、或有名稱的日子。 */
export interface CalendarDay {
  date: ISODate
  isWorkday: boolean
  /** 只供顯示（中秋節、補假、颱風假…），不可拿來判斷邏輯 */
  name: string
  /** official：官方辦公日曆；override：管理員的例外日 */
  source: 'official' | 'override'
}

/** 工作日曆：預設週末（ISO 星期，1 = 週一）、官方資料完整的年份、特殊日（依日期遞增）。 */
export interface WorkCalendar {
  weekendDays: number[]
  coveredYears: number[]
  days: CalendarDay[]
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

/** 專案本身的資料（頂欄顯示的名稱、擁有者）；`id` 就是 `/projects/:id` 的路由參數。 */
export interface ProjectMeta {
  id: string
  name: string
  /** 專案經理（擁有者）的成員 id */
  pmId: string
  /**
   * 計畫基準的鎖定日；'' 表示解鎖（規劃中：不顯示延遲，存的基準保留，上鎖時決定更新或沿用）。
   * 規則見 docs/reference/scheduling.md〈基準與基準鎖〉。
   */
  baselineLockedOn: ISODate | ''
}

export interface ProjectData {
  project: ProjectMeta
  /**
   * 登入者能不能改這個專案（後端算：是不是這個專案的 PM）。
   * 前端不自己拿 `project.pmId` 比對登入者：權限規則只留在後端一處。
   */
  canEdit: boolean
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
  /** 專案整體狀態；後端依任務算（規則見 `api/types.ts` 檔頭，參考實作 `projectStatusOf`），不存欄位 */
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

/* ── 登入 ─────────────────────────────────────────── */

/**
 * 登入中的使用者（`api.getSession()` / 登入成功的回傳）。登入的人一定是成員，`memberId` 就是成員 id。
 * 只給畫面顯示與導頁用；權限一律由後端判斷（每支端點自己驗 session），前端不拿它做授權。
 */
export interface SessionInfo {
  /** 成員 id */
  memberId: string
  /** 姓名 */
  name: string
  /** 角色：後端填部門 */
  role: string
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
