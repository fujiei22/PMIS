import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, isRef, toRaw } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { api, mockApi as maybeMockApi } from '@/api'
import { buildPortfolio } from '@/api/mock/portfolio'
import { preloadPortfolio, usePortfolioBoot } from '@/composables/usePortfolioBoot'
import { preloadProject, useProjectBoot } from '@/composables/useProjectBoot'
import {
  expireSession,
  loginLocation,
  resetSession,
  useSession,
  type Session,
} from '@/composables/useSession'
import { sampleProject } from '@/mocks/sampleProject'
import { setErrorSink } from '@/stores/_optimistic'
import { useCommentStore } from '@/stores/comment'
import { useFilterStore } from '@/stores/filter'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSelectionStore } from '@/stores/selection'
import { useSessionStore } from '@/stores/session'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 測試一定走 mock 實作（mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/**
 * `src/stores/` 底下每一支 store（`_` 開頭的是共用機制，不是 store）。
 * 用 glob 列舉：新增 store 不必改這支測試，它自動被檢查到。
 */
const storeModules = import.meta.glob<Record<string, unknown>>('../../stores/*.ts', { eager: true })

interface StoreDef {
  (pinia?: Pinia): { $id: string; $state: Record<string, unknown> }
  $id: string
}

const STORE_DEFS: StoreDef[] = Object.entries(storeModules)
  .filter(([path]) => !/\/_[^/]*$/.test(path))
  .flatMap(([, mod]) =>
    Object.values(mod).filter(
      (v): v is StoreDef =>
        typeof v === 'function' && typeof (v as { $id?: unknown }).$id === 'string',
    ),
  )

/** 不重置的 store：時鐘層（時間跟誰登入無關）。 */
const EXEMPT = new Set(['clock'])

/**
 * 把 store 的 state 轉成能直接比對的純資料（Set / Map 轉成標記過的陣列）。
 * setup store 的 `$state` 拆掉 reactive 之後，每個欄位是 ref 本身，要先解開。
 */
function plain(value: unknown): unknown {
  if (isRef(value)) return plain(value.value)
  const raw = toRaw(value)
  if (raw instanceof Set) return { $set: [...raw].map(plain) }
  if (raw instanceof Map) return { $map: [...raw].map(([k, v]) => [k, plain(v)]) }
  if (Array.isArray(raw)) return raw.map(plain)
  if (raw && typeof raw === 'object')
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, plain(v)]))
  return raw
}

/** 全新 pinia 裡每個 store 的初始 state；之後切回原本的 pinia。 */
function freshStates(back: Pinia): Map<string, unknown> {
  const fresh = createPinia()
  setActivePinia(fresh)
  const out = new Map(STORE_DEFS.map((def) => [def.$id, plain(def(fresh).$state)]))
  setActivePinia(back)
  return out
}

/**
 * 把每個 store 的基本型別欄位都改掉（字串加字、數字加 7、布林反過來、Set 加一筆）。
 * 照實際操作改不到的欄位（例：之後新增、還沒有操作會改到的）也會被弄髒，漏重置就比對得出來。
 * 被 store 自己的 watch 立刻清回去的（例：選取指到不存在的 id）沒關係，本來就會回到初始值。
 */
function perturb(state: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'string') state[key] = `${value}·`
    else if (typeof value === 'number') state[key] = value + 7
    else if (typeof value === 'boolean') state[key] = !value
    else if (value instanceof Set) value.add('perturbed')
  }
}

/** 照實際使用把各層弄髒：載入資料、篩選、選取、開浮層、調版面、總覽的篩選與檢視。 */
async function useEverything(): Promise<void> {
  await useTaskStore().load(structuredClone(sampleProject))
  await usePortfolioStore().load(buildPortfolio(sampleProject, '2026-09-22'))
  await useSessionStore().load()

  useSelectionStore().selectTask('t3')
  const filter = useFilterStore()
  filter.statuses = ['doing']
  filter.bumpTaskSort('name')
  filter.issueGroupBy = 'level'

  const ui = useUiStore()
  ui.loadState = 'ready'
  ui.openDetail('t3', 'task')
  ui.setDayWidth(20)
  ui.toggleGroup('g1')
  ui.panelOff.gantt = true
  ui.expandedIssues = { i1: true }
  ui.pushError({ label: '更新任務', error: new Error('x') })

  const comment = useCommentStore()
  comment.tab = 'files'
  comment.fileView = 'list'
  comment.draft = '打到一半'

  const ov = useOverviewStore()
  ov.loadState = 'ready'
  ov.toggleStatus('doing')
  ov.setQuery('入口')
  ov.bumpSort('due')
  ov.setView('timeline')
  ov.toggleExpanded('pmis')
  ov.toggleGroup('m5')
}

describe('resetSession：登出後每個 store 都等於全新的初始狀態', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    mockApi.reset(structuredClone(sampleProject))
    resetSession()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setErrorSink(null)
    mockApi.reset()
  })

  it('列舉得到 src/stores/ 底下的 store，豁免的只有時鐘層', () => {
    const ids = STORE_DEFS.map((d) => d.$id)
    expect(ids.length).toBeGreaterThanOrEqual(14)
    for (const id of EXEMPT) expect(ids).toContain(id)
    expect([...EXEMPT]).toEqual(['clock'])
  })

  it('照實際使用弄髒、再把每個欄位改掉 → resetSession() → 每個 store 等於全新 pinia 的初始狀態', async () => {
    const stores = STORE_DEFS.map((def) => def(pinia))
    await useEverything()
    for (const s of stores) if (!EXEMPT.has(s.$id)) perturb(s.$state)

    const fresh = freshStates(pinia)
    // 前提：真的弄髒了（有 state 的 store 都跟初始狀態不同），不然下面的比對沒有意義
    for (const s of stores) {
      if (EXEMPT.has(s.$id) || Object.keys(s.$state).length === 0) continue
      expect(plain(s.$state), `${s.$id} 沒被弄髒`).not.toEqual(fresh.get(s.$id))
    }

    resetSession()

    for (const s of stores) {
      if (EXEMPT.has(s.$id)) continue
      expect(plain(s.$state), `${s.$id} 沒有重置乾淨`).toEqual(fresh.get(s.$id))
    }
  })

  it('還在飛的載入（總覽、Dashboard）在重置後才回來：不灌進 store、載入狀態維持 idle', async () => {
    mockApi.setLatency(20)
    preloadPortfolio()
    preloadProject('pmis')
    expect(useOverviewStore().loadState).toBe('loading')
    expect(useUiStore().loadState).toBe('loading')

    resetSession()
    await new Promise((r) => setTimeout(r, 40))
    await flushPromises()

    expect(usePortfolioStore().projects).toEqual([])
    expect(useTaskStore().tasks).toEqual([])
    expect(useOverviewStore().loadState).toBe('idle')
    expect(useUiStore().loadState).toBe('idle')
  })

  it('重置後先載的那一發不留給下一位：掛載時的 reload 自己重打', async () => {
    preloadPortfolio()
    resetSession()
    const spy = vi.spyOn(api, 'listProjects')
    await usePortfolioBoot().reload()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(useOverviewStore().loadState).toBe('ready')
  })

  it('重置後再進 Dashboard 是「載入中」，不是背景重載（不會先秀上一位的資料）', async () => {
    await useProjectBoot('pmis').reload()
    expect(useUiStore().loadState).toBe('ready')

    resetSession()
    const p = useProjectBoot('pmis').reload()
    expect(useUiStore().loadState).toBe('loading')
    expect(useTaskStore().tasks).toEqual([])
    await p
    expect(useUiStore().loadState).toBe('ready')
  })

  it('錯誤條的出口拿掉：上一位還在飛的寫入失敗只進 console，不出現在錯誤條', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await useProjectBoot('pmis').reload()
    mockApi.setLatency(10)
    mockApi.failNext('updateTask')
    const pending = useTaskStore().updateTask('t3', { name: '上一位改的' })

    resetSession()
    await pending

    expect(useUiStore().errors).toEqual([])
    expect(err).toHaveBeenCalledWith('[api]', '更新任務', expect.anything())
  })
})

describe('登入頁位置與 401', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    mockApi.reset()
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'overview', component: { template: '<div />' } },
        {
          path: '/login',
          name: 'login',
          component: { template: '<div />' },
          meta: { public: true },
        },
        { path: '/projects/:id', name: 'dashboard', component: { template: '<div />' } },
      ],
    })
    await router.push('/projects/pmis?tab=x')
    await useSessionStore().load()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockApi.reset()
  })

  it('loginLocation：原路徑是首頁或沒有就不帶 redirect', () => {
    expect(loginLocation()).toEqual({ name: 'login' })
    expect(loginLocation('/')).toEqual({ name: 'login' })
    expect(loginLocation('/projects/pmis')).toEqual({
      name: 'login',
      query: { redirect: '/projects/pmis' },
    })
  })

  it('expireSession：記成沒登入、導到登入頁並帶原路徑（含 query）', async () => {
    expireSession(router)
    await flushPromises()
    const session = useSessionStore()
    expect(session.info).toBeNull()
    expect(session.checked).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/projects/pmis?tab=x')
  })

  it('已經在登入頁：只記成沒登入，不再導（不會把 redirect 換成登入頁自己）', async () => {
    await router.replace('/login?redirect=/projects/pmis')
    const replace = vi.spyOn(router, 'replace')
    expireSession(router)
    await flushPromises()
    expect(replace).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe('/login?redirect=/projects/pmis')
  })

  it('useSession().logout：通知後端、記成沒登入、導到登入頁（不帶 redirect）', async () => {
    let session!: Session
    const Host = defineComponent({
      setup() {
        session = useSession()
        return () => null
      },
    })
    const w = mount(Host, { global: { plugins: [router] } })
    const spy = vi.spyOn(api, 'logout')

    await session.logout()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(useSessionStore().info).toBeNull()
    expect(await api.getSession()).toBeNull()
    expect(router.currentRoute.value.fullPath).toBe('/login')
    w.unmount()
  })
})
