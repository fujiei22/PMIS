import { expect, test, type Page } from '@playwright/test'
import { setFixedTime } from './helpers/clock'
import { DashboardPage } from './helpers/dashboardPage'
import { OverviewPage } from './helpers/overviewPage'

/**
 * 登入（F3）：
 * - 沒登入就開頁 → 導到登入頁（`?redirect=` 帶原路徑）→ 登入後回到原頁。
 * - 登入中被撤銷（401，例：session 過期）→ 下一個請求導到登入頁 → 登入後回原頁。
 * - 登出 → 登入頁；回上一頁看不到舊資料；再登入時上一位的篩選已經清掉。
 * 都靠 `window.__mockApi.setSession` 換登入狀態，接上真後端時跳過。
 */

/**
 * 讓頁面從「沒登入」開始：`__mockApi` 掛上的當下就登出（寫法同 interactions.spec 的載入失敗）。
 * 登入守衛在第一次導航就會問 getSession，等頁面載完再 `page.evaluate` 來不及。
 */
async function startLoggedOut(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__mockApi', {
      configurable: true,
      set(value: Window['__mockApi']) {
        delete window.__mockApi
        window.__mockApi = value
        value?.setSession(null)
      },
      get() {
        return undefined
      },
    })
  })
}

/** 在登入頁填帳密按登入（mock：格式正確的帳號、不空的密碼就登得進去）。 */
async function login(page: Page, account = 'chen_daming'): Promise<void> {
  await page.getByLabel('帳號').fill(account)
  await page.getByLabel('密碼').fill('pw')
  await page.getByRole('button', { name: '登入', exact: true }).click()
}

/** 登入頁網址上的 redirect（沒有就是 null）。 */
function redirectOf(page: Page): string | null {
  return new URL(page.url()).searchParams.get('redirect')
}

test.describe('登入', () => {
  test('沒登入開 Dashboard：導到登入頁、帶原路徑；登入失敗顯示原因，登入後回到原頁', async ({ page }) => {
    await startLoggedOut(page)
    await setFixedTime(page)
    await page.goto('/projects/pmis')
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))

    await expect(page.locator('[data-view="login"]')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/login')
    expect(redirectOf(page)).toBe('/projects/pmis')
    await expect(page.locator('[data-rowtask]')).toHaveCount(0)

    // 通過驗證但不在可登入名單（mock 固定失敗的帳號）
    await login(page, 'outsider')
    await expect(page.getByTestId('login-error')).toHaveText('沒有 PMIS 使用權限')
    expect(new URL(page.url()).pathname).toBe('/login')

    await login(page)
    await expect(page.locator('[data-rowtask]')).toHaveCount(30)
    expect(new URL(page.url()).pathname).toBe('/projects/pmis')
  })

  test('登入中被撤銷（401）：下一個請求導到登入頁並帶原路徑，登入後回原頁，那次修改沒存到', async ({ page }) => {
    const app = new DashboardPage(page)
    await app.goto()
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))

    await page.evaluate(() => window.__mockApi!.setSession(null))
    // 改名送出 → updateTask 回 401 → 導到登入頁
    await app.row('t3').locator('.name').dblclick()
    const input = app.row('t3').locator('input')
    await input.pressSequentially('X')
    await input.press('Enter')

    await expect(page.locator('[data-view="login"]')).toBeVisible()
    expect(redirectOf(page)).toBe('/projects/pmis')

    await login(page)
    await expect(app.row('t3').locator('.name')).toHaveText('前端框架建置')
    expect(new URL(page.url()).pathname).toBe('/projects/pmis')
  })

  test('登出：回登入頁；回上一頁看不到舊資料；再登入時上一位的篩選已經清掉', async ({ page }) => {
    const ov = new OverviewPage(page)
    await ov.goto()
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))

    await ov.pick('status', '進行中')
    await expect(page.getByTestId('overview-clear')).toBeEnabled()

    await page.getByTestId('user-menu').click()
    await page.getByRole('menuitem', { name: '登出' }).click()
    await expect(page.locator('[data-view="login"]')).toBeVisible()
    await expect(page.locator('[data-view="overview"]')).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe('/login')

    // 回上一頁（總覽）：還是沒登入，登入守衛擋在登入頁，總覽不會出現
    await page.goBack()
    await expect(page.locator('[data-view="login"]')).toBeVisible()
    await expect(page.locator('[data-view="overview"]')).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe('/login')

    await login(page)
    await expect(ov.card('pmis')).toBeVisible()
    await expect(page.getByTestId('overview-clear')).toBeDisabled()
    // 觸發鈕沒有勾選數（「狀態 1」→「狀態」）
    await expect(ov.dropdown('status').locator('button.dd-trigger')).toHaveText(/^狀態\s*▼$/)
  })
})
