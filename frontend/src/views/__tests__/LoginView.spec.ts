// 登入頁：沒填、四種失敗原因、連不上的文案；成功後回 ?redirect= 的原路徑（只接受站內路徑）；
// 登入中防重按；掛上時把前端整個重置。完整流程（導到登入頁 → 登入 → 回原頁、登出）在 e2e/login.spec.ts。
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { api, mockApi as maybeMockApi } from '@/api'
import { ApiError, type LoginResult } from '@/api/types'
import { LOGIN_EMPTY_TEXT, LOGIN_FAIL_TEXT } from '@/constants/api'
import { sampleProject } from '@/mocks/sampleProject'
import { useSessionStore } from '@/stores/session'
import { useTaskStore } from '@/stores/task'
import LoginView from '@/views/LoginView.vue'

/** 測試一定走 mock 實作（mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

const Stub = { template: '<div />' }

async function setup(path = '/login?redirect=/projects/pmis') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: Stub },
      { path: '/login', name: 'login', component: Stub, meta: { public: true } },
      { path: '/projects/:id', name: 'dashboard', component: Stub },
    ],
  })
  await router.push(path)
  const w = mount(LoginView, { global: { plugins: [router] }, attachTo: document.body })
  return { w, router }
}

async function submit(
  w: Awaited<ReturnType<typeof setup>>['w'],
  account: string,
  password: string,
): Promise<void> {
  await w.find('input[name="username"]').setValue(account)
  await w.find('input[name="password"]').setValue(password)
  await w.find('form').trigger('submit')
  await flushPromises()
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.reset()
    mockApi.setSession(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockApi.reset()
    document.body.innerHTML = ''
  })

  it('掛上時游標在帳號欄；帳號或密碼沒填就按登入：提示、不打 api', async () => {
    const { w } = await setup()
    expect(document.activeElement).toBe(w.find('input[name="username"]').element)
    const spy = vi.spyOn(api, 'login')

    await submit(w, '  ', 'pw')
    expect(w.find('[data-testid="login-error"]').text()).toBe(LOGIN_EMPTY_TEXT)
    expect(document.activeElement).toBe(w.find('input[name="username"]').element)

    await submit(w, 'chen_daming', '')
    expect(document.activeElement).toBe(w.find('input[name="password"]').element)
    expect(spy).not.toHaveBeenCalled()
    w.unmount()
  })

  it.each([
    ['wrong_password', 'invalid'],
    ['outsider', 'forbidden'],
    ['locked_out', 'locked'],
    ['ad_down', 'unavailable'],
  ] as const)('%s → %s 的文案，留在登入頁', async (account, reason) => {
    const { w, router } = await setup()
    await submit(w, account, 'pw')
    const msg = w.find('[data-testid="login-error"]')
    expect(msg.text()).toBe(LOGIN_FAIL_TEXT[reason])
    expect(msg.attributes('role')).toBe('alert')
    expect(router.currentRoute.value.name).toBe('login')
    expect(useSessionStore().info).toBeNull()
    w.unmount()
  })

  it('帳號或密碼錯：清掉密碼、游標移到密碼欄，帳號留著', async () => {
    const { w } = await setup()
    await submit(w, 'wrong_password', 'secret')
    const pw = w.find<HTMLInputElement>('input[name="password"]')
    expect(pw.element.value).toBe('')
    expect(document.activeElement).toBe(pw.element)
    expect(w.find<HTMLInputElement>('input[name="username"]').element.value).toBe('wrong_password')
    w.unmount()
  })

  it('其他失敗原因不清密碼', async () => {
    const { w } = await setup()
    await submit(w, 'outsider', 'secret')
    expect(w.find<HTMLInputElement>('input[name="password"]').element.value).toBe('secret')
    w.unmount()
  })

  it('連不上（login 拋 ApiError）：顯示「連線失敗」', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi.failNext('login', new ApiError('network', 'x'))
    const { w } = await setup()
    await submit(w, 'chen_daming', 'pw')
    expect(w.find('[data-testid="login-error"]').text()).toBe('連線失敗')
    w.unmount()
  })

  it('成功：記下登入者、回到 ?redirect= 的原路徑（帳號去掉前後空白再送）', async () => {
    const spy = vi.spyOn(api, 'login')
    const { w, router } = await setup('/login?redirect=/projects/pmis%3Fx%3D1')
    await submit(w, ' chen_daming ', 'pw')
    expect(spy).toHaveBeenCalledWith('chen_daming', 'pw')
    expect(useSessionStore().info?.memberId).toBe('m11')
    expect(router.currentRoute.value.fullPath).toBe('/projects/pmis?x=1')
    w.unmount()
  })

  it.each([
    ['沒有 redirect', '/login'],
    ['redirect 是外站', '/login?redirect=//evil.example'],
  ])('成功但%s：回首頁', async (_name, path) => {
    const { w, router } = await setup(path)
    await submit(w, 'chen_daming', 'pw')
    expect(router.currentRoute.value.fullPath).toBe('/')
    w.unmount()
  })

  it('登入中：按鈕停用、顯示「登入中…」，再按一次不會送第二次', async () => {
    let release!: (r: LoginResult) => void
    const spy = vi.spyOn(api, 'login').mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    const { w } = await setup()
    await w.find('input[name="username"]').setValue('outsider')
    await w.find('input[name="password"]').setValue('pw')
    await w.find('form').trigger('submit')
    const btn = w.find('button[type="submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toBe('登入中…')

    await w.find('form').trigger('submit')
    expect(spy).toHaveBeenCalledTimes(1)

    release({ ok: false, reason: 'forbidden' })
    await flushPromises()
    expect(btn.attributes('disabled')).toBeUndefined()
    expect(btn.text()).toBe('登入')
    w.unmount()
  })

  it('掛上時把前端整個重置：上一位的資料與登入狀態都清掉', async () => {
    await useTaskStore().load(structuredClone(sampleProject))
    await mockApi.login('chen_daming', 'pw')
    await useSessionStore().load()
    expect(useTaskStore().tasks).toHaveLength(30)

    const { w } = await setup()
    expect(useTaskStore().tasks).toEqual([])
    expect(useSessionStore().info).toBeNull()
    expect(useSessionStore().checked).toBe(false)
    w.unmount()
  })
})
