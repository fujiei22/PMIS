import { dayIndex, lengthOf, todayIndex } from '@/lib/date'
import type { Issue, Member, Task } from '@/types/models'

/** 一個排序鍵；多鍵排序就是一組 SortKey，依序比到分出高下為止。 */
export interface SortKey {
  k: string
  dir: 'asc' | 'desc'
}

/** sortValue 需要但物件身上沒有的關聯資料。 */
export interface SortCtx {
  taskById: (id: string) => Task | undefined
  memberById: (id: string) => Member | undefined
  openIssueCount: (taskId: string) => number
}

/** 優先度 / 等級 / 分類的比較權重，值大的排前面（desc 時）。legacy `sortVal` 內的 PO / CO / IO :2060 */
const PRIORITY_ORDER: Record<string, number> = { high: 3, mid: 2, low: 1 }
const LEVEL_ORDER: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 }
const ITEM_ORDER: Record<string, number> = { C: 4, R: 3, F: 2, O: 1 }
const ISSUE_STATUS_ORDER = ['open', 'doing', 'paused', 'closed']

/** 建立日期；沒填就退而求其次拿 start / due，都沒有才用今天。legacy `createdOf` :2275 */
function createdIndex(o: Task | Issue): number {
  const iso = o.created || (o as Task).start || (o as Issue).due || ''
  return iso ? dayIndex(iso) : todayIndex(Date.now())
}

/**
 * 取某個排序鍵在該物件上的比較值。legacy `sortVal` :2060。
 * 注意 kind='issue' 的 'priority' 讀的是 `Issue.level`——排序鍵名沿用 legacy，
 * 欄位名在契約 A 改成 level（見 constants/dashboard.ts 的 ISSUE_SORT_KEYS 註解）。
 */
export function sortValue(
  kind: 'task' | 'issue',
  key: string,
  o: Task | Issue,
  ctx: SortCtx,
): number | string {
  if (kind === 'task') {
    const t = o as Task
    if (key === 'start') return dayIndex(t.start)
    if (key === 'days') return lengthOf(t)
    if (key === 'priority') return PRIORITY_ORDER[t.priority]
    if (key === 'issue') return ctx.openIssueCount(t.id)
    if (key === 'created') return createdIndex(t)
    if (key === 'name') return t.name
    return 0
  }

  const i = o as Issue
  if (key === 'priority') return LEVEL_ORDER[i.level] ?? 0
  if (key === 'item') return ITEM_ORDER[i.item] ?? 0
  if (key === 'due') return i.due ? dayIndex(i.due) : 9e9
  if (key === 'status') return ISSUE_STATUS_ORDER.indexOf(i.status)
  if (key === 'task') {
    const t = ctx.taskById(i.taskId)
    return t ? dayIndex(t.start) : 0
  }
  if (key === 'created') return createdIndex(i)
  if (key === 'creator') return ctx.memberById(i.creatorId)?.name ?? ''
  return 0
}

/**
 * 多鍵排序，回傳新陣列。legacy `applySort` :2082。
 * 每個鍵的值只算一次存進快取；字串用 localeCompare(zh-Hant)，數字直接相減。
 */
export function applySort<T extends { id: string }>(
  list: T[],
  sorts: SortKey[],
  kind: 'task' | 'issue',
  ctx: SortCtx,
): T[] {
  if (!sorts.length) return list
  const cache = new Map<string, Map<string, number | string>>()
  const valueOf = (s: SortKey, o: T): number | string => {
    let m = cache.get(s.k)
    if (!m) {
      m = new Map()
      cache.set(s.k, m)
    }
    let v = m.get(o.id)
    if (v === undefined) {
      v = sortValue(kind, s.k, o as unknown as Task | Issue, ctx)
      m.set(o.id, v)
    }
    return v
  }

  return list.slice().sort((a, b) => {
    for (const s of sorts) {
      const va = valueOf(s, a)
      const vb = valueOf(s, b)
      const c =
        typeof va === 'string'
          ? va.localeCompare(String(vb), 'zh-Hant')
          : (va as number) - (vb as number)
      if (c) return s.dir === 'desc' ? -c : c
    }
    return 0
  })
}

/**
 * 點一次排序鍵：沒在清單裡就加到最後，已經在就翻轉方向。legacy `bumpSort` :2104。
 * 日期類的鍵預設由早到晚，其餘預設由大到小。
 */
export function bumpSort(sorts: SortKey[], k: string): SortKey[] {
  const out = sorts.slice()
  const i = out.findIndex((x) => x.k === k)
  if (i < 0) out.push({ k, dir: ['start', 'due', 'created'].includes(k) ? 'asc' : 'desc' })
  else out[i] = { k, dir: out[i].dir === 'asc' ? 'desc' : 'asc' }
  return out
}

/** 任務看板的預設排序：時程由早到晚。legacy state `kSort` :1580 */
export const DEFAULT_TASK_SORT: SortKey[] = [{ k: 'start', dir: 'asc' }]

/** Issue 看板的預設排序：期限由近到遠。legacy state `iSort` :1581 */
export const DEFAULT_ISSUE_SORT: SortKey[] = [{ k: 'due', dir: 'asc' }]
