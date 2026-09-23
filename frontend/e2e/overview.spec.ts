import { expect, test } from '@playwright/test'
import { setFixedTime } from './helpers/clock'
import { OverviewPage } from './helpers/overviewPage'

test.describe('總覽 頂欄', () => {
  test('成員選項顯示進行中 / 未開始數，有需注意的 PM 有紅點', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.openDropdown('pm')
    const opt = (id: string) => ov.dropdown('pm').locator(`[data-pm-option="${id}"]`)
    await expect(opt('m5')).toContainText('進行中 2')
    await expect(opt('m9')).toContainText('未開始 1')
    await expect(opt('m5').locator('.alert-dot')).toBeVisible()
    await expect(opt('m9').locator('.alert-dot')).toHaveCount(0)
  })

  test('篩成員5、成員8 → 計數與卡片跟著變；清除篩選回全部', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await expect(ov.count()).toHaveText('7 個專案 · 3 個需要注意 · 4 位 PM')
    await ov.pickPm('m5', 'm8')
    await expect(ov.count()).toHaveText('4 個專案 · 2 個需要注意 · 2 位 PM')
    await expect.poll(() => ov.cardIds()).toEqual(['portal', 'app', 'pmis', 'payment'])
    await page.getByTestId('overview-clear').click()
    await expect(ov.count()).toHaveText('7 個專案 · 3 個需要注意 · 4 位 PM')
  })

  test('狀態篩「未開始」只剩供應商入口', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.pick('status', '未開始')
    await expect.poll(() => ov.cardIds()).toEqual(['vendor'])
  })

  test('Esc 關閉下拉後焦點回到觸發鈕', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.openDropdown('status')
    await page.keyboard.press('Escape')
    await expect(ov.dropdown('status').locator('.dd-menu')).toHaveCount(0)
    await expect(ov.dropdown('status').locator('button.dd-trigger')).toBeFocused()
  })
})

test.describe('總覽 卡片檢視', () => {
  test('預設欄序與欄內順序依排序', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await expect.poll(() => ov.columnIds()).toEqual(['m10', 'm8', 'm5', 'm9'])
    await expect.poll(() => ov.cardIds()).toEqual(['wiki', 'portal', 'app', 'pmis', 'payment', 'dw', 'vendor'])
  })

  test('移掉「落後」排序、只剩到期日 → 欄序跟著變', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await page.locator('[data-view-panel="cards"] .chip-x').first().click()
    // 到期日最早的是 dw（09-12，成員9），其次 wiki（09-30，成員10）、portal（10-16，成員8）、payment（10-31，成員5）
    await expect.poll(() => ov.columnIds()).toEqual(['m9', 'm10', 'm8', 'm5'])
  })

  test('點卡片展開速覽四組；再點收合；點進入到 Dashboard', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.card('pmis').click()
    await expect(ov.card('pmis')).toHaveAttribute('aria-expanded', 'true')
    await expect(ov.card('pmis').locator('.qb-title')).toHaveText(['進度與任務數', '時程', '風險項目', '成員與近期任務'])
    await ov.card('pmis').locator('.card-name').click()
    await expect(ov.card('pmis')).toHaveAttribute('aria-expanded', 'false')
    await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
    await expect(page).toHaveURL(/\/projects\/pmis$/)
    await expect(page.locator('[data-panel="gantt"]')).toBeVisible()
  })

  test('鍵盤：卡片上按 Enter 展開；在「進入」上按 Enter 只導頁', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.card('wiki').focus()
    await page.keyboard.press('Enter')
    await expect(ov.card('wiki')).toHaveAttribute('aria-expanded', 'true')
    await ov.card('portal').getByRole('link', { name: /進入/ }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/projects\/portal$/)
  })
})

test.describe('總覽 時間軸', () => {
  test('切到時間軸；可同時展開兩列速覽；標頭有專案名、PM、進入', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await page.locator('[data-view-switch="timeline"]').click()
    await expect(page.locator('[data-view-panel="timeline"]')).toBeVisible()
    await ov.row('pmis').locator('.p-row').click()
    await ov.row('portal').locator('.p-row').click()
    await expect(ov.row('pmis').locator('.qv-head')).toContainText('PMIS 專案管理系統')
    await expect(ov.row('pmis').locator('.qv-head')).toContainText('成員5')
    await expect(ov.row('portal').locator('.qv-head')).toBeVisible()
    await expect(ov.row('pmis').locator('.c-pct')).toHaveText('13% / 20%')
    await expect(ov.row('pmis').locator('.c-gap')).toHaveText('7%')
    await ov.row('portal').locator('.qv-head').getByRole('link', { name: /進入/ }).click()
    await expect(page).toHaveURL(/\/projects\/portal$/)
  })

  test('速覽標頭的「收合」收起該列', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    await ov.row('wiki').locator('.p-row').click()
    await ov.row('wiki').locator('.btn-quick').click()
    await expect(ov.row('wiki').locator('.p-row')).toHaveAttribute('aria-expanded', 'false')
  })

  test('群組收合後出現摘要 bar，專案列隱藏', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const g = page.locator('[data-pm-group="m5"]')
    await g.click()
    await expect(g).toHaveAttribute('aria-expanded', 'false')
    await expect(g.locator('.g-sum')).toBeVisible()
    await expect(ov.row('pmis')).toBeHidden()
  })

  test('橫向捲動時左欄固定（sticky 沒被 clip 層弄壞）', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const left = ov.row('pmis').locator('.p-left')
    const body = page.locator('.tl-body')
    await body.evaluate((el) => { el.scrollLeft = 0 })
    const x0 = (await left.boundingBox())!.x
    await body.evaluate((el) => { el.scrollLeft = 400 })
    await expect.poll(async () => (await left.boundingBox())!.x).toBeCloseTo(x0, 0)
  })

  test('今天按鈕把今天線捲進可見範圍', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const body = page.locator('.tl-body')
    await body.evaluate((el) => { el.scrollLeft = 0 })
    await page.getByTestId('overview-today').click()
    await expect.poll(() => body.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await expect(page.locator('.today-tag')).toBeInViewport()
  })
})

test.describe('總覽 頁面', () => {
  test('檢視切換：卡片 ↔ 時間軸', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await page.locator('[data-view-switch="timeline"]').click()
    await expect(page.locator('[data-view-panel="cards"]')).toHaveCount(0)
    await page.locator('[data-view-switch="cards"]').click()
    await expect(page.locator('[data-view-panel="cards"]')).toBeVisible()
  })

  test('空狀態：已完成 + 落後 沒有專案；面板還在；清除篩選回來', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.pick('status', '已完成')
    await ov.pick('alert', '落後')
    await expect(page.getByTestId('overview-empty')).toBeVisible()
    await expect(page.locator('[data-view-panel="cards"] .panel-head')).toBeVisible()
    await page.getByTestId('overview-empty').getByRole('button', { name: '清除篩選' }).click()
    await expect.poll(() => ov.cardIds()).toHaveLength(7)
  })

  test('載入失敗顯示重試，按下後載入成功', async ({ page }) => {
    // 寫法照 interactions.spec.ts 的同名測試：攔截 __mockApi 的賦值，注入一次失敗
    await page.addInitScript(() => {
      Object.defineProperty(window, '__mockApi', {
        configurable: true,
        set(value: Window['__mockApi']) {
          delete window.__mockApi
          window.__mockApi = value
          value?.failNext('listProjects')
        },
        get() {
          return undefined
        },
      })
    })
    const ov = new OverviewPage(page)
    // 不用 ov.goto()：它會等面板出現，這條測試第一次載入失敗，面板不會出現
    await setFixedTime(page)
    await page.goto('/')
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))
    await expect(page.locator('[data-load-error]')).toHaveText('連線失敗')
    await page.getByRole('button', { name: '重試' }).click()
    await expect.poll(() => ov.cardIds()).toHaveLength(7)
  })

  test('Dashboard 改了資料，回總覽就看得到，而且沒有閃出載入中', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await expect(ov.card('pmis').locator('.hero')).toHaveText('13%')
    await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
    await expect(page.locator('[data-panel="gantt"]')).toBeVisible()
    // 直接透過 mock 把一個未完成任務改成完成（等同在 Dashboard 操作），4/30 → 5/30
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))
    await page.evaluate(async () => {
      const api = window.__mockApi!
      const t = (await api.loadProject()).tasks.find((x) => x.status !== 'done')!
      await api.updateTask(t.id, { status: 'done', done: '2026-09-18' })
    })
    // 記錄回總覽過程中有沒有出現過載入畫面
    await page.evaluate(() => {
      ;(window as unknown as { __sawLoading: boolean }).__sawLoading = false
      new MutationObserver(() => {
        if (document.querySelector('[data-view="overview"] [data-loadstate]')) (window as unknown as { __sawLoading: boolean }).__sawLoading = true
      }).observe(document.body, { subtree: true, childList: true })
    })
    await page.getByRole('link', { name: '所有專案' }).click()
    await expect(ov.card('pmis').locator('.hero')).toHaveText('17%')
    expect(await page.evaluate(() => (window as unknown as { __sawLoading: boolean }).__sawLoading)).toBe(false)
  })
})

