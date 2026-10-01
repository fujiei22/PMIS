import { expect, test, type Page } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'
import { pause } from './helpers/motion'
import { OverviewPage } from './helpers/overviewPage'

/**
 * 切頁與載入的銜接（動畫稽核批次 E，docs/incidents/2026-09-30-motion-audit）。
 * - G8：已經載過的 Dashboard 再進入，不顯示「載入中」、內容不卸掉再掛；重載在背景。
 * - G16 / C13：直接開 Dashboard 後回總覽，不閃「載入中」（資料在舊頁淡出期間就載好）。
 * - 每次進頁仍只打一次 load（failNext 類測試的語意靠這個）。
 */

/** 頁面裡記錄的結果（MutationObserver 寫入）。 */
interface LoadWatch {
  /** 是否出現過 `[data-loadstate]`（載入中 / 失敗佔位）。 */
  sawLoading: boolean
  /** 甘特第一列的選擇器。 */
  rowSel: string
  /** 出現過的甘特第一列元素（新增或移除的子樹裡找到的），重複的只記一次。 */
  firstRows: Set<Element>
}

/**
 * 開始記錄：之後新增的節點裡有沒有 `[data-loadstate]`、甘特第一列換過幾個元素。
 * 看的是 mutation 紀錄裡新增 / 移除的子樹，不是回呼當下的畫面——
 * 同一個 task 裡掛上又卸掉的元素，回呼時已經不在畫面上，用 querySelector 抓不到。
 * @param scope 只看這個選擇器底下的載入佔位（例：只看總覽頁的）；省略則整頁都算。
 * @param rowId 甘特第一列的任務 id；只記這一列，別列的增減不算。
 */
async function watchLoad(page: Page, scope = '', rowId = ''): Promise<void> {
  await page.evaluate(([scope, rowId]) => {
    const rowSel = rowId ? `[data-rowtask="${rowId}"]` : '[data-rowtask]'
    const watch: LoadWatch = { sawLoading: false, rowSel, firstRows: new Set() }
    ;(window as unknown as { __loadWatch: LoadWatch }).__loadWatch = watch
    /** 移除的子樹已經脫離文件，範圍改看它原本的父層（mutation 的 target，還在文件裡）。 */
    function inspect(n: Node, parent: Node): void {
      if (!(n instanceof Element)) return
      const inScope = !scope || n.closest(scope) || (parent instanceof Element && parent.closest(scope))
      if (inScope && (n.matches('[data-loadstate]') || n.querySelector('[data-loadstate]'))) watch.sawLoading = true
      const row = n.matches(rowSel) ? n : n.querySelector(rowSel)
      if (row) watch.firstRows.add(row)
    }
    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => inspect(n, r.target))
        r.removedNodes.forEach((n) => inspect(n, r.target))
      }
    }).observe(document.body, { subtree: true, childList: true })
  }, [scope, rowId])
}

/** 讀回記錄：有沒有出現載入佔位、第一列換過幾個元素、記到的那個是不是現在畫面上的第一列。 */
async function readWatch(page: Page): Promise<{ sawLoading: boolean; rows: number; same: boolean }> {
  return page.evaluate(() => {
    const w = (window as unknown as { __loadWatch: LoadWatch }).__loadWatch
    const [first] = w.firstRows
    return {
      sawLoading: w.sawLoading,
      rows: w.firstRows.size,
      same: !!first && first === document.querySelector(w.rowSel),
    }
  })
}

test.describe('切頁與載入的銜接', () => {
  test('G8 已載過的 Dashboard 再進入：不出現載入中、甘特列沒有卸掉再掛，背景重載帶進新資料', async ({ page }) => {
    const app = new DashboardPage(page)
    await app.goto()
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))
    const firstId = (await page.locator('[data-rowtask]').first().getAttribute('data-rowtask'))!
    const done = app.summary('tasks').locator('.legend-row', { hasText: '已完成' }).locator('.legend-count')
    const doneBefore = Number(await done.textContent())

    // 接有延遲的後端：之後每一發都要 300ms 才回來
    await page.evaluate(() => window.__mockApi!.setLatency(300))
    await page.getByRole('link', { name: '所有專案' }).click()
    const ov = new OverviewPage(page)
    await expect(ov.card('pmis')).toBeVisible()
    await expect(page.locator('[data-rowtask]')).toHaveCount(0)

    // 離開期間資料被改了（等同別人改的）：回來後背景重載要把它帶進來，也用它確認背景重載跑完
    await page.evaluate(async () => {
      const api = window.__mockApi!
      const t = (await api.loadProject()).tasks.find((x) => x.status !== 'done')!
      await api.updateTask(t.id, { status: 'done', done: '2026-09-18' })
    })

    await watchLoad(page, '', firstId)
    await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
    await expect(app.row(firstId)).toBeVisible()
    await expect(done).toHaveText(String(doneBefore + 1))

    const w = await readWatch(page)
    expect(w.sawLoading).toBe(false)
    // 第一列從掛上到背景重載完都是同一個元素
    expect(w.rows).toBe(1)
    expect(w.same).toBe(true)
  })

  test('G16 直接開 Dashboard 再回總覽：總覽不閃載入中（資料在 Dashboard 淡出期間就載好）', async ({ page }) => {
    const app = new DashboardPage(page)
    await app.goto()
    await watchLoad(page, '[data-view="overview"]')
    await page.getByRole('link', { name: '所有專案' }).click()
    const ov = new OverviewPage(page)
    await expect(ov.card('pmis')).toBeVisible()
    expect((await readWatch(page)).sawLoading).toBe(false)
  })

  test('每次進頁只打一次 load：直接開、切頁、上一頁各一發（切頁先載與掛載不重複打）', async ({ page }) => {
    // 攔截 __mockApi 的賦值（寫法照 interactions.spec 的載入失敗測試），把兩支載入包一層計數
    await page.addInitScript(() => {
      const calls: Record<string, number> = { loadProject: 0, listProjects: 0 }
      ;(window as unknown as { __loadCalls: Record<string, number> }).__loadCalls = calls
      Object.defineProperty(window, '__mockApi', {
        configurable: true,
        set(value: Window['__mockApi']) {
          delete window.__mockApi
          window.__mockApi = value
          if (!value) return
          const api = value as unknown as Record<string, (...args: unknown[]) => unknown>
          for (const k of Object.keys(calls)) {
            const orig = api[k]!
            api[k] = (...args) => {
              calls[k]!++
              return orig(...args)
            }
          }
        },
        get() {
          return undefined
        },
      })
    })
    const app = new DashboardPage(page)
    await app.goto()
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))
    const calls = () => page.evaluate(() => ({ ...(window as unknown as { __loadCalls: Record<string, number> }).__loadCalls }))
    const ov = new OverviewPage(page)

    await expect.poll(calls).toEqual({ loadProject: 1, listProjects: 0 })
    await page.getByRole('link', { name: '所有專案' }).click()
    await expect(ov.card('pmis')).toBeVisible()
    await expect.poll(calls).toEqual({ loadProject: 1, listProjects: 1 })
    await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
    await expect(page.locator('[data-rowtask]').first()).toBeVisible()
    await expect.poll(calls).toEqual({ loadProject: 2, listProjects: 1 })
    await page.goBack()
    await expect(ov.card('pmis')).toBeVisible()
    await expect.poll(calls).toEqual({ loadProject: 2, listProjects: 2 })
    // 再等一下，確認沒有晚到的第二發
    await pause(page, 300)
    expect(await calls()).toEqual({ loadProject: 2, listProjects: 2 })
  })
})
