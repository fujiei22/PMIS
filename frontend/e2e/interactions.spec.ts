import { expect, test, type Locator } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'

/**
 * S4 的驗收：選取連動、篩選、排序、就地編輯、選單 / 對話框、選取後自動捲動。
 * 對應 spec §目標 行為 1、2、3、6、8 的非拖曳部分；拖曳（4、5）在 S5、詳細視窗（7）在 S6。
 */

/** 讀出一排排序 chip 的「層級 標籤 方向」，用來比對多鍵排序狀態。 */
async function chipTexts(chips: Locator): Promise<string[]> {
  return chips.evaluateAll((els) =>
    els.map((el) =>
      ['.chip-level', '.chip-label', '.chip-arrow']
        .map((s) => el.querySelector(s)?.textContent?.trim() ?? '')
        .join(' '),
    ),
  )
}

test('點任務後三面板同步高亮並在卡片標前置/後續', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  // 點列上的任務名（列右半是日期膠囊，點它是開日期選擇器）
  await app.row('t3').locator('.name').click()

  await expect(app.card('t3')).toHaveAttribute('data-selected', 'true')
  await expect(app.row('t3')).toHaveAttribute('data-selected', 'true')
  // t3 的相依：d2 t2→t3（前置）、d3 t3→t4（後續）
  await expect(app.card('t2')).toHaveAttribute('data-rel', 'up')
  await expect(app.card('t4')).toHaveAttribute('data-rel', 'down')
  await expect(app.row('t2')).toHaveAttribute('data-rel', 'up')
  // i1 掛在 t3 底下，Issue 卡片跟著亮
  await expect(app.issueCard('i1')).toHaveAttribute('data-selected', 'true')
  // 不相關的任務淡化
  await expect(app.card('t9')).toHaveAttribute('data-rel', '')
  await expect(app.card('t9')).toHaveCSS('opacity', '0.45')

  // 再點一次同一列 → 取消選取，淡化解除
  await app.row('t3').locator('.name').click()
  await expect(app.card('t3')).toHaveAttribute('data-selected', 'false')
  await expect(app.card('t2')).toHaveAttribute('data-rel', '')
  await expect(app.card('t9')).toHaveCSS('opacity', '1')
})

test('下拉互斥：開狀態再開優先度，狀態自動關；點外面全關', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  const status = app.topFilter(0)
  const prio = app.topFilter(1)

  await status.locator('.dd-trigger').click()
  await expect(status.locator('.dd-menu')).toBeVisible()
  await expect(prio.locator('.dd-menu')).toHaveCount(0)

  await prio.locator('.dd-trigger').click()
  await expect(status.locator('.dd-menu')).toHaveCount(0)
  await expect(prio.locator('.dd-menu')).toBeVisible()

  // 點面板空白處（不在 [data-dd] 內）→ 全部關掉
  await app.panelHead('gantt').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.top-bar .dd-menu')).toHaveCount(0)
})

test('狀態篩選 + 關閉只顯示篩選結果 → 不符者淡化不隱藏、Issue 面板仍只顯示符合者、計數改「已篩選」', async ({
  page,
}) => {
  const app = new DashboardPage(page)
  await app.goto()

  // 只留「已完成」：t1 / t2 / t7 / t28 共 4 個，底下只有 i7 一筆 Issue
  await app.topFilter(0).locator('.dd-trigger').click()
  await app.topFilter(0).locator('.dd-item', { hasText: '已完成' }).click()

  await expect(page.locator('[data-rowtask]')).toHaveCount(4)
  await expect(page.locator('[data-card]')).toHaveCount(4)
  await expect(app.taskCount).toHaveText('已篩選 4/30 個任務')
  await expect(app.issueCount).toHaveText('已篩選 1/12 筆 Issue')
  await expect(page.locator('[data-issuerow]')).toHaveCount(1)

  // 關掉「只顯示篩選結果」→ 全部列回來，不符的只是淡化
  await app.onlyFiltered.click()
  await expect(page.locator('[data-rowtask]')).toHaveCount(30)
  await expect(page.locator('[data-card]')).toHaveCount(30)
  await expect(app.card('t1')).toHaveAttribute('data-rel', 'group')
  await expect(app.card('t1')).toHaveCSS('opacity', '1')
  await expect(app.card('t3')).toHaveCSS('opacity', '0.45')

  // 計數與 Issue 面板不受「只顯示篩選結果」影響
  await expect(app.taskCount).toHaveText('已篩選 4/30 個任務')
  await expect(app.issueCount).toHaveText('已篩選 1/12 筆 Issue')
  await expect(page.locator('[data-issuerow]')).toHaveCount(1)
})

test('看板多鍵排序 chip 與 reset 回時程 asc', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  const chips = app.sortChips('kanban')
  expect(await chipTexts(chips)).toEqual(['1 時程 ↑'])

  // 加第二層：工期（預設 desc）
  await app.sortTrigger('kanban').click()
  await app.sortMenu('kanban').locator('.sort-option', { hasText: '工期' }).click()
  expect(await chipTexts(chips)).toEqual(['1 時程 ↑', '2 工期 ↓'])

  // 點 chip 本身翻方向
  await chips.nth(0).click()
  expect(await chipTexts(chips)).toEqual(['1 時程 ↓', '2 工期 ↓'])

  // ✕ 移掉第一層後只剩工期，卡片依工期由大到小
  await chips.nth(0).locator('.chip-x').click()
  expect(await chipTexts(chips)).toEqual(['1 工期 ↓'])
  const days = await page
    .locator('[data-col="todo"] [data-card] .days-num')
    .evaluateAll((els) => els.map((el) => Number(el.textContent)))
  expect(days.length).toBeGreaterThan(1)
  expect(days).toEqual([...days].sort((a, b) => b - a))

  // 清除排序回預設（時程 asc）
  await app.sortTrigger('kanban').click()
  await app.sortMenu('kanban').locator('.sort-clear').click()
  await expect(app.sortMenu('kanban')).toHaveCount(0)
  expect(await chipTexts(chips)).toEqual(['1 時程 ↑'])
})

test('雙擊改名逐鍵即時寫入，Esc 只關框不還原', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  await app.row('t3').locator('.name').dblclick()
  const input = app.row('t3').locator('input')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('前端框架建置')

  // 每一鍵就寫進 store：還在編輯中，看板卡片的標題已經跟著變
  await input.pressSequentially('（改）')
  await expect(app.card('t3').locator('.title')).toHaveText('前端框架建置（改）')

  // Esc 只結束編輯，不還原
  await input.press('Escape')
  await expect(app.row('t3').locator('input')).toHaveCount(0)
  await expect(app.row('t3').locator('.name')).toHaveText('前端框架建置（改）')
  await expect(app.card('t3').locator('.title')).toHaveText('前端框架建置（改）')
})

test('刪除任務兩步確認後任務、其 Issue、相依都消失且選取清空', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  await expect(page.locator('polyline.dep')).toHaveCount(27)
  await app.row('t3').locator('.name').click()
  await expect(app.card('t3')).toHaveAttribute('data-selected', 'true')

  // 列上的快捷鈕要 hover 才撐開
  await app.row('t3').hover()
  await app.row('t3').locator('.act-del').click()

  await expect(app.confirmDialog).toContainText('刪除任務？')
  await app.confirmDialog.getByRole('button', { name: '繼續刪除' }).click()
  await expect(app.confirmDialog).toContainText('再次確認')
  await app.confirmDialog.getByRole('button', { name: '確認刪除' }).click()

  await expect(app.confirmDialog).toHaveCount(0)
  await expect(app.row('t3')).toHaveCount(0)
  await expect(app.card('t3')).toHaveCount(0)
  // t3 底下的 i1 / i2 一起消失
  await expect(app.issueCard('i1')).toHaveCount(0)
  await expect(app.issueCard('i2')).toHaveCount(0)
  await expect(app.taskCount).toHaveText('共 29 個任務')
  await expect(app.issueCount).toHaveText('共 10 筆 Issue')
  // d2（t2→t3）與 d3（t3→t4）兩條相依也沒了
  await expect(page.locator('polyline.dep')).toHaveCount(25)
  // 選取清空 → 沒有任何卡片被淡化或標記
  await expect(app.card('t2')).toHaveAttribute('data-rel', '')
  await expect(app.card('t2')).toHaveCSS('opacity', '1')
})

test('卡片狀態膠囊開選項選單，改狀態後卡片換欄並補完成日', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  await app.card('t3').locator('.st').click()
  await expect(app.optionMenu).toBeVisible()
  await expect(app.optionMenu.locator('.opt-item')).toHaveCount(4)

  await app.optionMenu.locator('.opt-item', { hasText: '已完成' }).click()
  await expect(app.optionMenu).toHaveCount(0)
  await expect(app.card('t3')).toHaveAttribute('data-status', 'done')
  await expect(page.locator('[data-col="done"] [data-card="t3"]')).toBeVisible()
  // 進 done 會補上今天（固定時鐘 2026-09-18）
  await expect(app.card('t3')).toContainText('2026/09/18')
})

test('Issue 卡片展開表單可逐鍵編輯，期限選擇器可清除', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  const card = app.issueCard('i1')
  await card.locator('.act.caret').click()
  await expect(card.locator('.exp-body')).toContainText('測試環境')

  const ptype = card.locator('.exp-body input').first()
  await ptype.fill('I/O Function')
  // 收合再展開，值仍在（逐鍵就寫進 store，不是暫存在 DOM）
  await card.locator('.act.caret').click()
  await expect(card.locator('.exp-body')).toBeHidden()
  await card.locator('.act.caret').click()
  await expect(card.locator('.exp-body input').first()).toHaveValue('I/O Function')

  // 卡片上的「期限」膠囊 → 日期選擇器 → 清除
  await expect(card.locator('.pill').first()).toContainText('2026/09/18')
  await card.locator('.pill').first().click()
  await expect(app.issueDatePicker).toBeVisible()
  await app.issueDatePicker.locator('.cal-clear').click()
  await expect(app.issueDatePicker).toHaveCount(0)
  await expect(card.locator('.pill').first()).toContainText('—')
})

test('選取任務後甘特捲到 bar 附近', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  // 先等載入後自動捲到今天那一下跑完，再歸零，免得量到它
  await expect.poll(() => app.scrollLeftOf(app.ganttScroller)).toBeGreaterThan(0)
  await app.ganttScroller.evaluate((el) => {
    el.scrollLeft = 0
  })
  await expect.poll(() => app.scrollLeftOf(app.ganttScroller)).toBe(0)

  // t27 在 2026-11-04，位在畫布最右側；從看板點它（src='card'）甘特仍要捲過去
  // 點卡片標題（卡片中央是狀態 / 時程膠囊，點它們是開選單）
  await app.card('t27').locator('.title').click()
  await expect
    .poll(() => app.scrollLeftOf(app.ganttScroller), { timeout: 5000 })
    .toBeGreaterThan(500)

  // 捲完之後 t27 的甘特條要落在可視範圍內
  await expect
    .poll(
      async () => {
        const bar = await app.bar('t27').boundingBox()
        const view = await app.ganttScroller.boundingBox()
        if (!bar || !view) return false
        return bar.x >= view.x - 1 && bar.x + bar.width <= view.x + view.width + 1
      },
      { timeout: 5000 },
    )
    .toBe(true)
})

// ── R2：樂觀更新失敗與載入錯誤（只有 mock api 才注入得了失敗）────────────────

test('api 失敗時改名還原並顯示錯誤條', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  // 接上真後端之後沒有 __mockApi，這條就跳過（review M8）
  // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
  test.skip(!(await page.evaluate(() => !!window.__mockApi)))

  await page.evaluate(() => window.__mockApi!.failNext('updateTask'))

  await app.row('t3').locator('.name').dblclick()
  const input = app.row('t3').locator('input')
  await expect(input).toBeVisible()
  await input.pressSequentially('X')
  // 逐鍵是本地即時的，畫面先變
  await expect(app.card('t3').locator('.title')).toHaveText('前端框架建置X')

  // 離開編輯 → flush → api 失敗 → 還原成 server 值 + 錯誤條
  await input.press('Enter')
  const bar = page.locator('[data-errorbar]')
  await expect(bar).toHaveAttribute('role', 'alert')
  await expect(bar).toContainText('更新任務')
  await expect(app.row('t3').locator('.name')).toHaveText('前端框架建置')
  await expect(app.card('t3').locator('.title')).toHaveText('前端框架建置')

  // ✕ 關掉錯誤條
  await bar.locator('.error-x').first().click()
  await expect(bar).toHaveCount(0)
})

test('載入失敗顯示重試，按下後載入成功', async ({ page }) => {
  // `window.__mockApi` 是 api 模組載入時才掛上去的，趕不及在 goto 之前注入失敗；
  // 改成先攔截那次賦值：setter 一被呼叫就把 loadProject 設成失敗一次。
  await page.addInitScript(() => {
    Object.defineProperty(window, '__mockApi', {
      configurable: true,
      set(value: Window['__mockApi']) {
        delete window.__mockApi
        window.__mockApi = value
        value?.failNext('loadProject')
      },
      get() {
        return undefined
      },
    })
  })

  await page.goto('/')
  // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
  test.skip(!(await page.evaluate(() => !!window.__mockApi)))

  const retry = page.getByRole('button', { name: '重試' })
  await expect(retry).toBeVisible()
  await expect(page.locator('[data-load-error]')).toHaveText('連線失敗')
  await expect(page.locator('[data-rowtask]')).toHaveCount(0)

  await retry.click()
  await expect(page.locator('[data-rowtask]')).toHaveCount(30)
  await expect(page.locator('[data-loadstate]')).toHaveCount(0)
})
