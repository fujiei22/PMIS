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

/** 甘特圖左欄的任務分類 */
export interface Group {
  id: string
  name: string
  collapsed: boolean
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

/** 留言附件；mocks 無 url，送出留言時圖片才有 blob url */
export interface Attachment {
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

export interface ProjectData {
  groups: Group[]
  members: Member[]
  tasks: Task[]
  deps: Dependency[]
  issues: Issue[]
  comments: Comment[]
  currentUserId: string
}
