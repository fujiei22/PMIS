import { expect, test, type Locator, type Page } from '@playwright/test'
import { DashboardPage, html5Drag } from './helpers/dashboardPage'
import { OverviewPage } from './helpers/overviewPage'

/**
 * 唯讀模式（F2）：不是這個專案的 PM 時，Dashboard 整頁唯讀。
 *
 * 做法：先開總覽、讓 mock 之後的 loadProject 回 `canEdit: false`，再從總覽點進 Dashboard
 * （切頁先載拿到的就是唯讀；`window.__mockApi` 要等 app 載入才有，趕不及在直接開 Dashboard 之前設定）。
 * 逐一嘗試會改資料的入口：入口不存在或點了沒反應，而且 mock 裡的資料一個字都沒變；看的操作照常。
 *
 * 注意：e2e 的時鐘是凍住的（`setFixedTime`），同一次點擊路徑上第二個 Vue listener 會被略過
 * （README〈安裝與指令〉）。唯讀時點日期膠囊等「只是顯示」的元素，真實瀏覽器會往上傳去選取列 / 卡片，
 * 這裡不驗那段，只驗「沒有打開浮層、資料沒變」。選取一律點任務名。
 */

/** 從總覽點進唯讀的 Dashboard（PMIS 範例專案）。接上真後端之後沒有 `__mockApi`，整支跳過。 */
async function openReadonly(page: Page): Promise<DashboardPage> {
  const ov = new OverviewPage(page)
  await ov.goto()
  // eslint-disable-next-line playwright/no-skipped-test -- 接上真後端時沒有 __mockApi（同 interactions.spec）
  test.skip(!(await page.evaluate(() => !!window.__mockApi)))
  await page.evaluate(() => window.__mockApi!.setCanEdit(false))
  await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
  await page.waitForURL('**/projects/pmis')
  await page.locator('[data-rowtask]').first().waitFor()
  return new DashboardPage(page)
}

/** mock 裡目前的整包專案資料（序列化後比對，確認唯讀時沒有任何寫入到「伺服器」）。 */
function serverData(page: Page): Promise<string> {
  return page.evaluate(async () => JSON.stringify(await window.__mockApi!.loadProject('pmis')))
}

/**
 * 捲到視窗中間、滑鼠先停在上面，等 hover 的浮起過渡跑完再點裡面的東西：
 * 卡片浮起途中 Playwright 判定「不穩定」，會改用別的捲動方式重試，捲到 sticky 頂欄底下又被擋住。
 */
async function centerOf(target: Locator): Promise<void> {
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await target.hover()
  await target.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))),
  )
}

/** 詳細視窗本體。 */
function modal(page: Page) {
  return page.locator('.detail-modal')
}

test.describe('唯讀模式（F2）', () => {
  test('專案名旁有灰色「唯讀」tag，滑過說明是誰在管', async ({ page }) => {
    const app = await openReadonly(page)
    const tag = page.getByTestId('readonly-tag')
    await expect(tag).toHaveText('唯讀')
    // 範例專案的 PM 是 m5（成員5）
    await expect(tag).toHaveAttribute('title', '此專案由 成員5 管理')
    // 緊接在專案名後面
    const name = (await app.topBar.locator('.project').boundingBox())!
    const box = (await tag.boundingBox())!
    expect(box.x).toBeGreaterThan(name.x + name.width - 1)
    expect(Math.abs(box.y + box.height / 2 - (name.y + name.height / 2))).toBeLessThan(4)
  })

  test('甘特：新增、把手、⋮、改名、刪分類、日期、拖曳、相依線都沒有作用', async ({ page }) => {
    const app = await openReadonly(page)
    const before = await serverData(page)
    const order = await app.rowOrder()

    // 面板頭只剩「全部收合」
    const head = page.locator('.gantt-left-head')
    await expect(head.getByRole('button', { name: '＋ 分類' })).toHaveCount(0)
    await expect(head.getByRole('button', { name: '＋ 任務' })).toHaveCount(0)
    await expect(head.getByRole('button', { name: '全部收合' })).toBeVisible()
    // 排序把手、列尾「⋮」、分類的刪除鈕都不在
    await expect(page.locator('[data-rowtask] .grip, [data-rowgroup] .grip')).toHaveCount(0)
    await expect(page.locator('[data-rowmore]')).toHaveCount(0)
    await expect(page.locator('[data-rowgroup] .del')).toHaveCount(0)

    // 雙擊任務名 / 分類名不進就地編輯
    await app.row('t2').locator('.name').dblclick()
    await app.groupRow('g1').locator('.name').dblclick()
    await expect(page.locator('.name-input')).toHaveCount(0)

    // 日期膠囊點了不開日期選擇器
    await app.row('t2').locator('.date-range').click()
    await expect(app.taskDatePicker).toHaveCount(0)

    // 選取中的條：沒有左右把手與連線圓點；按住拖曳不改日期（落到畫布去平移）
    await app.row('t2').locator('.name').click()
    await expect(app.row('t2')).toHaveAttribute('data-selected', 'true')
    await expect(app.bar('t2').locator('.handle')).toHaveCount(0)
    await expect(page.locator('[data-linkfor]')).toHaveCount(0)
    const bar = (await app.bar('t2').boundingBox())!
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2)
    await page.mouse.down()
    await page.mouse.move(bar.x + bar.width / 2 + 96, bar.y + bar.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect(app.row('t2').locator('.date-range')).toHaveText('2026/09/02 → 2026/09/08')

    // 相依線點了不開刪除確認
    await page.locator('.dep-hit').first().dispatchEvent('click')
    await expect(app.confirmDialog).toHaveCount(0)

    // 看板卡片拖到甘特列：卡片本身不能拖；硬送一次拖放事件，資料層也擋下來
    await expect(app.card('t9')).toHaveAttribute('draggable', 'false')
    await html5Drag(page, '[data-card="t9"]', '[data-rowtask="t2"]')

    expect(await app.rowOrder()).toEqual(order)
    expect(await serverData(page)).toBe(before)
  })

  test('看板與 Issue：新增、刪除、工期、狀態與日期、改名、展開表單都沒有作用', async ({ page }) => {
    const app = await openReadonly(page)
    const before = await serverData(page)

    // 看板
    await expect(app.panelHead('kanban').getByRole('button', { name: /新增/ })).toHaveCount(0)
    const card = app.card('t3')
    await centerOf(card)
    await expect(card.locator('.del')).toHaveCount(0)
    await expect(card.locator('.days-step')).toHaveCount(0)
    await expect(card.locator('.st-caret')).toHaveCount(0)
    await expect(card).toHaveAttribute('draggable', 'false')
    await card.locator('.st').click()
    await expect(app.optionMenu).toHaveCount(0)
    await card.locator('.range-main').click()
    await expect(app.taskDatePicker).toHaveCount(0)
    await card.locator('.pill', { hasText: '完成日期' }).click()
    await expect(app.issueDatePicker).toHaveCount(0)

    // Issue 看板
    await expect(app.panelHead('issues').getByRole('button', { name: /新增/ })).toHaveCount(0)
    const issue = app.issueCard('i1')
    await centerOf(issue)
    await expect(issue.locator('.del')).toHaveCount(0)
    await issue.locator('.title').dblclick()
    await expect(issue.locator('.title-input')).toHaveCount(0)
    // 點卡片會選取它，甘特與看板跟著捲動：再捲回中間
    await centerOf(issue)
    await issue.locator('.cls').click()
    await issue.locator('.st').click()
    await expect(app.optionMenu).toHaveCount(0)
    await issue.locator('.pill', { hasText: '期限' }).click()
    await expect(app.issueDatePicker).toHaveCount(0)

    // 展開表單看得到內容，但下拉不開、輸入框不能打字
    await issue.locator('.act.caret').click()
    const body = issue.locator('.exp-body')
    await expect(body).toBeVisible()
    await centerOf(body)
    await body.locator('.field-pill').first().click()
    await expect(app.optionMenu).toHaveCount(0)
    await expect(body.locator('.text-input').first()).toHaveValue('UI Function')
    for (const input of await body.locator('.text-input').all())
      await expect(input).not.toBeEditable()

    expect(await serverData(page)).toBe(before)
  })

  test('詳細視窗：改名、指派、相依、開立 Issue、刪除、留言都沒有作用；可以切頁籤、看 Issue', async ({
    page,
  }) => {
    const app = await openReadonly(page)
    const before = await serverData(page)

    await app.card('t3').locator('.caret').click()
    await expect(modal(page)).toBeVisible()

    // 標題雙擊不進編輯
    await modal(page).locator('.detail-title').dblclick()
    await expect(modal(page).locator('.detail-title-input')).toHaveCount(0)
    // 指派、移除負責人、編輯相依、開立 Issue、刪除都不在
    for (const sel of ['.chip-x', '.chip-add', '.dep-edit-link', '.add-issue', '.delete-task'])
      await expect(modal(page).locator(sel)).toHaveCount(0)
    // 分類 / 時程 / 完成日 / 優先度 / 狀態的膠囊點了不開選單
    for (const pill of await modal(page).locator('.task-props .pill').all()) await pill.click()
    await expect(app.optionMenu).toHaveCount(0)
    await expect(app.taskDatePicker).toHaveCount(0)
    await expect(app.issueDatePicker).toHaveCount(0)
    // 留言：看得到，沒有草稿區、沒有刪除
    await expect(modal(page).locator('.comment-row').first()).toBeVisible()
    await expect(modal(page).locator('.draft-input')).toHaveCount(0)
    await expect(modal(page).locator('.comment-del')).toHaveCount(0)
    // 檔案頁籤照常
    await modal(page).locator('.tab-files').click()
    await expect(modal(page).locator('.files-tab')).toBeVisible()
    await modal(page).locator('.tab-comments').click()

    // Issue 詳情：欄位不能改、沒有刪除
    await modal(page).getByText('路由切換時狀態遺失').click()
    await expect(modal(page)).toContainText('等級 Class')
    await expect(modal(page).locator('.delete-issue')).toHaveCount(0)
    for (const input of await modal(page)
      .locator('.issue-props input, .issue-props textarea')
      .all())
      await expect(input).not.toBeEditable()
    await modal(page).locator('.issue-props .pill').first().click()
    await expect(app.optionMenu).toHaveCount(0)

    expect(await serverData(page)).toBe(before)
  })

  test('看的操作照常：選取連動、篩選、收合、縮放', async ({ page }) => {
    const app = await openReadonly(page)

    // 選取連動
    await app.row('t3').locator('.name').click()
    await expect(app.card('t3')).toHaveAttribute('data-selected', 'true')
    await expect(app.card('t2')).toHaveAttribute('data-rel', 'up')
    await expect(app.issueCard('i1')).toHaveAttribute('data-selected', 'true')
    await app.row('t3').locator('.name').click()

    // 篩選：只看執行中
    await app.topFilter(0).locator('.dd-trigger').click()
    await app.topFilter(0).locator('.dd-item', { hasText: '執行中' }).click()
    await expect(app.taskCount).toHaveText('已篩選 8/30 個任務')
    await app.filterClear.click()
    await expect(app.taskCount).toHaveText('共 30 個任務')

    // 收合分類
    await app.groupRow('g1').locator('.caret').click()
    await expect(app.row('t1')).toHaveCount(0)
    await app.groupRow('g1').locator('.caret').click()
    await expect(app.row('t1')).toBeVisible()

    // 縮放
    const width = (await app.ganttChart.boundingBox())!.width
    await app.zoomSlider.fill('20')
    await expect.poll(async () => (await app.ganttChart.boundingBox())!.width).toBeLessThan(width)
  })

  test('預設（可編輯）沒有唯讀 tag，入口都在', async ({ page }) => {
    const app = new DashboardPage(page)
    await app.goto()
    await expect(page.getByTestId('readonly-tag')).toHaveCount(0)
    await expect(app.rowMore('t2')).toBeVisible()
    await expect(app.card('t3')).toHaveAttribute('draggable', 'true')
  })
})
