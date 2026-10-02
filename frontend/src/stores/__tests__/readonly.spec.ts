import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, mockApi as maybeMockApi } from '@/api'
import { ApiError } from '@/api/types'
import { useProjectBoot } from '@/composables/useProjectBoot'
import { API_ERROR_TEXT } from '@/constants/api'
import { sampleProject } from '@/mocks/sampleProject'
import { useBudgetStore } from '@/stores/budget'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useProjectStore } from '@/stores/project'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * ===== 唯讀守衛（F2）=====
 *
 * 不是這個專案的 PM 時（`project.canEdit` 是 false），Dashboard 整頁唯讀。畫面藏掉入口之外，
 * 資料層再擋一次：task / issue / comment 每個寫入 action 第一行 `if (!useProjectStore().canEdit) return`。
 * 這支測試守兩件事：
 *
 * 1. **分類**：Dashboard 資料層 store 回傳的每個函式都要列在下面四張表之一。
 *    新增 action 沒分類就紅——不會默默變成「唯讀也能改」。
 *    - `WRITE_ACTIONS`：改專案資料（含只改本地、之後才送出的 `*Local` / `applyLocalPatch`、草稿附件），唯讀時要擋。
 *    - `READ_ACTIONS`：只讀。
 *    - `INTERNAL_ACTIONS`：載入、後端事件、跟 server 對齊、清理——不是使用者發起的寫入，唯讀時照常。
 *    - `ANY_USER_ACTIONS`：不受唯讀擋的寫入。目前沒有；F8 的「改專案擁有者」（任何登入者都能做）會加在這裡。
 * 2. **擋得住**：`canEdit=false` 時逐一呼叫 `WRITE_ACTIONS`，api 一次都沒被呼叫、store 狀態跟呼叫前一樣。
 *    另有對照組：可編輯時同一個呼叫一定會打 api 或改狀態，確保上面擋下來的是唯讀，不是參數無效。
 */

/** 固定時鐘：2026-09-18，與 e2e 的 clock helper 同一天。 */
const NOW = Date.parse('2026-09-18T10:00:00Z')

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/** 受檢查的 store：Dashboard 的資料層（總覽的 portfolio 沒有寫入、也不分唯讀）。 */
function dataStores() {
  return {
    task: useTaskStore(),
    issue: useIssueStore(),
    comment: useCommentStore(),
    member: useMemberStore(),
    budget: useBudgetStore(),
    project: useProjectStore(),
  }
}
type Stores = ReturnType<typeof dataStores>
type StoreKey = keyof Stores

/** 一個寫入 action 怎麼呼叫：參數都指向範例資料裡真的存在的東西，不擋的話一定會打 api 或改到狀態。 */
type WriteCall = (s: Stores) => unknown

const WRITE_ACTIONS: Record<StoreKey, Record<string, WriteCall>> = {
  task: {
    addGroup: ({ task }) => task.addGroup(),
    renameGroupLocal: ({ task }) => task.renameGroupLocal('g1', '唯讀改名'),
    commitGroupPatch: ({ task }) => task.commitGroupPatch('g1', { name: '唯讀改名' }),
    renameGroup: ({ task }) => task.renameGroup('g1', '唯讀改名'),
    removeGroup: ({ task }) => task.removeGroup('g6'),
    moveGroupLocal: ({ task }) => task.moveGroupLocal('g3', -1),
    moveGroup: ({ task }) => task.moveGroup('g3', -1),
    commitGroupOrder: ({ task }) => task.commitGroupOrder(),
    addTask: ({ task }) =>
      task.addTask({ groupId: 'g1', assigneeIds: [], start: '2026-09-18', duration: 5 }),
    applyLocalPatch: ({ task }) => task.applyLocalPatch('t1', { name: '唯讀改名' }),
    updateTask: ({ task }) => task.updateTask('t1', { name: '唯讀改名' }),
    commitTaskPatch: ({ task }) => task.commitTaskPatch('t1', { name: '唯讀改名' }),
    // t1 在 loadEditable 被搬到 g2（本地、還沒送），寫回時一定有東西要送
    commitSchedule: ({ task }) => task.commitSchedule(['t1']),
    commitTaskOrder: ({ task }) => task.commitTaskOrder(),
    setTaskDoneDirect: ({ task }) => task.setTaskDoneDirect('t1', '2020-01-01'),
    removeTask: ({ task }) => task.removeTask('t5'),
    moveTaskToLocal: ({ task }) => task.moveTaskToLocal('t3', { kind: 'g', id: 'g3' }),
    moveTaskTo: ({ task }) => task.moveTaskTo('t3', { kind: 'g', id: 'g3' }),
    addDep: ({ task }) => task.addDep('t1', 't30'),
    removeDep: ({ task }) => task.removeDep('d1'),
    // 範例已上鎖；上鎖的對照組先在 PREP 解鎖（只改本地，不算這個呼叫的變動）
    lockBaseline: ({ task }) => task.lockBaseline(),
    unlockBaseline: ({ task }) => task.unlockBaseline(),
  },
  issue: {
    addIssue: ({ task, issue }) => issue.addIssue(task.taskById('t3')!, 'm1'),
    applyLocalPatch: ({ issue }) => issue.applyLocalPatch('i1', { title: '唯讀改名' }),
    commitIssuePatch: ({ issue }) => issue.commitIssuePatch('i1', { title: '唯讀改名' }),
    updateIssue: ({ issue }) => issue.updateIssue('i1', { title: '唯讀改名' }),
    removeIssue: ({ issue }) => issue.removeIssue('i1'),
  },
  comment: {
    send: ({ comment }) => comment.send('t1', 'task'),
    addDraftFiles: ({ comment }) => comment.addDraftFiles([textFile('b.txt')]),
    removeDraft: ({ comment }) => comment.removeDraft(0),
    remove: ({ comment }) => comment.remove('c1'),
  },
  member: {},
  budget: {},
  project: {},
}

/**
 * 呼叫前的準備：讓這個 action 在可編輯時一定有事可做（`before` 在準備之後才取，準備本身不算變動）。
 * 例：範例專案已上鎖，`lockBaseline` 要先解鎖才有東西可鎖。
 */
const PREP: Record<string, (s: Stores) => void> = {
  'task.lockBaseline': ({ project }) => project.setMeta({ ...project.meta, baselineLockedOn: '' }),
}

const READ_ACTIONS: Record<StoreKey, string[]> = {
  task: ['taskById', 'groupById', 'predecessors', 'successors', 'explain'],
  issue: ['byId', 'byTask', 'openCount'],
  comment: ['forTarget', 'filesForTarget', 'commenterIds'],
  member: ['byId', 'assignable'],
  budget: [],
  project: [],
}

const INTERNAL_ACTIONS: Record<StoreKey, string[]> = {
  task: [
    'load',
    'reset',
    'applyEvent',
    'reconcileGroupsFromServer',
    'reconcileTasksFromServer',
    'discardTaskDrag',
    'discardGroupDrag',
  ],
  issue: ['setAll', 'reset', 'dropLocal', 'restoreFromServer', 'dropServer', 'applyEvent'],
  comment: [
    'setAll',
    'reset',
    'dropLocal',
    'restoreFromServer',
    'dropServer',
    'resetDraft',
    'applyEvent',
  ],
  member: ['setAll', 'reset'],
  budget: ['setAll', 'reset'],
  project: ['setAll', 'reset', 'setMeta'],
}

/** 不受唯讀擋的寫入。F8 的 `project.changeOwner`（任何登入者都能改擁有者）會列在這裡。 */
const ANY_USER_ACTIONS: Record<StoreKey, string[]> = {
  task: [],
  issue: [],
  comment: [],
  member: [],
  budget: [],
  project: [],
}

function textFile(name: string): File {
  return new File(['x'], name, { type: 'text/plain' })
}

/** store 實體上的函式（Pinia 自己的 `$patch` / `_p` 這類不算）。 */
function functionsOf(store: object): string[] {
  return Object.keys(store)
    .filter((k) => !k.startsWith('$') && !k.startsWith('_'))
    .filter((k) => typeof (store as Record<string, unknown>)[k] === 'function')
    .sort()
}

/**
 * 載入範例專案（可編輯），再先做幾件只改本地的事，讓 commit 類的 action 有東西可送：
 * 不擋的話 `commitGroupOrder` / `commitTaskOrder` 一定會打 api、`send` / `removeDraft` 一定會改到草稿。
 */
async function loadEditable(): Promise<Stores> {
  setActivePinia(createPinia())
  mockApi.reset(structuredClone(sampleProject))
  useClockStore().now = NOW
  // boot 負責 error sink 與派生層的清理 watch（契約 E）
  await useProjectBoot('pmis').reload()
  const s = dataStores()
  s.task.moveGroupLocal('g2', -1)
  s.task.moveTaskToLocal('t1', { kind: 'g', id: 'g2' })
  s.comment.draft = '還沒送出的留言'
  s.comment.addDraftFiles([textFile('a.txt')])
  return s
}

/** 所有 store 的狀態（JSON 化後比對；草稿附件裡的 File 會變成 `{}`，比的是其他欄位與筆數）。 */
function stateOf(s: Stores): string {
  return JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, st]) => [k, st.$state])))
}

/** 監看 api 每一支方法，回傳「到目前為止被呼叫過的方法名」。 */
function watchApi(): () => string[] {
  const target = api as unknown as Record<string, (...args: unknown[]) => unknown>
  const spies = Object.keys(target)
    .filter((k) => typeof target[k] === 'function')
    .map((k) => [k, vi.spyOn(target, k)] as const)
  return () => spies.filter(([, spy]) => spy.mock.calls.length > 0).map(([k]) => k)
}

/** 等樂觀更新的 promise 與 mock 的回應都跑完（mock 延遲為 0）。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
}

const WRITE_CASES = (Object.keys(WRITE_ACTIONS) as StoreKey[]).flatMap((store) =>
  Object.entries(WRITE_ACTIONS[store]).map(([name, call]) => [`${store}.${name}`, call] as const),
)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('唯讀守衛：資料層 store 的每個函式都要分類（F2）', () => {
  it.each(Object.keys(WRITE_ACTIONS) as StoreKey[])('%s store', (key) => {
    setActivePinia(createPinia())
    const store = dataStores()[key]
    const listed = [
      ...Object.keys(WRITE_ACTIONS[key]),
      ...READ_ACTIONS[key],
      ...INTERNAL_ACTIONS[key],
      ...ANY_USER_ACTIONS[key],
    ]
    // 每個名字只能出現在一張表
    expect(listed.length, '同一個名字列在兩張表').toBe(new Set(listed).size)
    // 實際的函式與表上的名字一模一樣：少了＝新 action 沒分類；多了＝表上留著已經刪掉的名字
    expect(functionsOf(store)).toEqual([...listed].sort())
  })
})

describe('唯讀守衛：canEdit=false 時寫入 action 不打 api、不改狀態（F2）', () => {
  it.each(WRITE_CASES)('%s', async (name, call) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = await loadEditable()
    PREP[name]?.(s)
    s.project.setAll(s.project.meta, false)
    const called = watchApi()
    const before = stateOf(s)

    await call(s)
    await settle()

    expect(called()).toEqual([])
    expect(stateOf(s)).toBe(before)
  })
})

describe('對照組：可編輯時同一個呼叫一定會打 api 或改狀態', () => {
  it.each(WRITE_CASES)('%s', async (name, call) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = await loadEditable()
    PREP[name]?.(s)
    const called = watchApi()
    const before = stateOf(s)

    await call(s)
    await settle()

    expect(called().length > 0 || stateOf(s) !== before).toBe(true)
  })
})

describe('伺服器回 403（例如 PM 中途換人）', () => {
  it('照一般失敗還原，錯誤條文案是「沒有權限」', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = await loadEditable()
    const name = s.task.taskById('t2')!.name
    mockApi.failNext(
      'updateTask',
      new ApiError('forbidden', '不是這個專案的 PM', 403, 'updateTask'),
    )

    await s.task.updateTask('t2', { name: '別人的專案' })
    await settle()

    expect(s.task.taskById('t2')!.name).toBe(name)
    const err = useUiStore().errors[0]!
    expect(err.label).toBe('更新任務')
    expect(API_ERROR_TEXT[err.code]).toBe('沒有權限')
  })
})
