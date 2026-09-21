import { expect, test, type Page } from '@playwright/test'
import { stepDrag } from './helpers/dashboardPage'
import {
  DD,
  clickRow,
  compareScenario,
  freezeGantt,
  markFloating,
  openDashboard,
  pickDropdownOption,
  settle,
  toggleDropdown,
  type Scenario,
} from './helpers/compare'

/**
 * 新舊對照（S7）。
 *
 * spec §目標 的 8 項行為，每項一組操作，**同一段操作分別在 `/legacy/Dashboard.html`
 * 與 `/` 執行**，再比對兩邊的文字、結構與幾何量測。選擇器只用契約 E 標「legacy 也有」
 * 的 `data-*` 鉤子與畫面上的文字，兩頁共用。
 *
 * legacy 要先讓 @babel/standalone 編模板，加上每個情境跑兩遍，逾時放寬到 3 分鐘。
 */
test.describe.configure({ timeout: 180_000 })

/** 浮層（選單 / 對話框 / 詳細視窗）裡的文字。 */
function float(page: Page) {
  return page.locator('[data-e2e-float]')
}

/** 點浮層裡的一個文字項；點之前先重新打標記。 */
async function clickFloat(page: Page, label: string | RegExp): Promise<void> {
  await markFloating(page)
  await float(page).getByText(label, { exact: true }).first().click()
  await settle(page, 350)
}

// ── spec §目標 的 8 項行為 ─────────────────────────────────────────────────

/** 1. 點任務 → 三面板同步高亮、前置 / 後續標示、其餘淡化。 */
const selection: Scenario = async (page, capture) => {
  await clickRow(page, 't3')
  await capture('選取 t3')
  await clickRow(page, 't3')
  await capture('再點一次取消選取')
}

/** 2. 頂部篩選（狀態、日期模式）與「只顯示篩選結果」開關。 */
const filtering: Scenario = async (page, capture) => {
  await toggleDropdown(page, DD.status)
  await pickDropdownOption(page, DD.status, '執行中')
  await toggleDropdown(page, DD.status)
  await capture('狀態篩選 = 執行中')

  await page.getByText('只顯示篩選結果', { exact: true }).click()
  await settle(page)
  await capture('關閉只顯示篩選結果')

  await toggleDropdown(page, DD.prio)
  await pickDropdownOption(page, DD.prio, '高')
  await toggleDropdown(page, DD.prio)
  await capture('再加優先度 = 高')

  await toggleDropdown(page, DD.fmode)
  await pickDropdownOption(page, DD.fmode, '介於')
  // 選了模式日曆會自動打開；兩頁的日曆本體都是「‹ / ›」那一列的上一層。
  const calendar = page.getByText('‹', { exact: true }).locator('xpath=../..')
  await calendar.getByText('20', { exact: true }).first().click()
  await settle(page, 300)
  await calendar.getByText('25', { exact: true }).first().click()
  await settle(page, 300)
  await page.mouse.click(8, 400)
  await settle(page)
  await capture('日期介於 09/20 ～ 09/25')

  await page.getByText('清除篩選', { exact: true }).click()
  await settle(page)
  await capture('清除篩選')
}

/** 3. 看板 / Issue 看板多鍵排序、Issue 看板依等級分組。 */
const sorting: Scenario = async (page, capture) => {
  await toggleDropdown(page, DD.ksort)
  await pickDropdownOption(page, DD.ksort, '優先度')
  await pickDropdownOption(page, DD.ksort, '工期')
  await toggleDropdown(page, DD.ksort)
  await capture('看板排序：優先度 → 工期')

  await toggleDropdown(page, DD.isort)
  await pickDropdownOption(page, DD.isort, '等級')
  await toggleDropdown(page, DD.isort)
  await capture('Issue 排序：等級')

  await toggleDropdown(page, DD.igroup)
  await pickDropdownOption(page, DD.igroup, '等級')
  await capture('Issue 依等級分組')
}

/** 4. 甘特條拖曳移動 / 縮放、拖曳建立相依、cascade 連動、防循環。 */
const ganttDrag: Scenario = async (page, capture) => {
  const bar = page.locator('[data-taskid="t3"]')
  await freezeGantt(page, 0)
  await bar.click()
  await settle(page)
  await freezeGantt(page, 0)

  const box = await bar.boundingBox()
  if (!box) throw new Error('找不到 t3 的甘特條')
  const y = box.y + box.height / 2
  await stepDrag(page, { x: box.x + 20, y }, [{ x: box.x + 20 + 32 * 3, y }])
  await settle(page)
  await freezeGantt(page, 0)
  await capture('拖曳 t3 往右 3 天（下游連動）')

  const box2 = await bar.boundingBox()
  if (!box2) throw new Error('找不到 t3 的甘特條')
  const right = box2.x + box2.width - 4
  await stepDrag(page, { x: right, y }, [{ x: right + 32 * 2, y }])
  await settle(page)
  await freezeGantt(page, 0)
  await capture('拉右邊界 +2 天')

  // 連線圓點只在「已選取且指標在條上」時出現（legacy :1876-1883）。
  await bar.hover()
  await settle(page, 350)
  const dot = page.locator('[data-linkfor="t3"]').nth(1)
  const dotBox = await dot.boundingBox()
  const target = await page.locator('[data-taskid="t6"]').boundingBox()
  if (!dotBox || !target) throw new Error('找不到連線圓點或目標條')
  await stepDrag(page, { x: dotBox.x + dotBox.width / 2, y: dotBox.y + dotBox.height / 2 }, [
    { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  ])
  await settle(page)
  await freezeGantt(page, 0)
  await capture('t3 → t6 建立相依')

  // 反向會成環，legacy :2354 直接拒絕。
  const bar6 = page.locator('[data-taskid="t6"]')
  await bar6.click()
  await settle(page)
  await freezeGantt(page, 0)
  await bar6.hover()
  await settle(page, 350)
  const dot6 = page.locator('[data-linkfor="t6"]').nth(1)
  const dot6Box = await dot6.boundingBox()
  const back = await page.locator('[data-taskid="t3"]').boundingBox()
  if (!dot6Box || !back) throw new Error('找不到連線圓點或目標條')
  await stepDrag(page, { x: dot6Box.x + dot6Box.width / 2, y: dot6Box.y + dot6Box.height / 2 }, [
    { x: back.x + back.width / 2, y: back.y + back.height / 2 },
  ])
  await settle(page)
  await freezeGantt(page, 0)
  await capture('反向 t6 → t3 被拒（不成環）')
}

/** 5. 列 / 分類重排、分類收合與摘要條、新增分類 / 任務 / Issue。 */
const structure: Scenario = async (page, capture) => {
  const from = await page.locator('[data-rowtask="t1"]').boundingBox()
  const to = await page.locator('[data-rowtask="t8"]').boundingBox()
  if (!from || !to) throw new Error('找不到要重排的列')
  // 把手 ⠿ 在列左緣往右約 15px（legacy :443 padding 9 + 字寬）。
  // 只送一次 move：legacy 的重排節流用 `Date.now()`，被 `setFixedTime` 凍住後
  // 第一次以外的 dragTick 全部被擋掉（新頁改用 `performance.now()`）。
  // 這是固定時鐘造成的測試環境差異，不是行為差異——所以只比第一次落點。
  await stepDrag(page, { x: from.x + 15, y: from.y + from.height / 2 }, [
    { x: from.x + 15, y: to.y + to.height / 2 },
  ])
  await settle(page)
  await capture('把 t1 拖到 t8 的位置')

  const g1 = page.locator('[data-rowgroup="g1"]')
  await g1.getByText('▼', { exact: true }).click()
  await settle(page)
  await capture('收合 g1（出現摘要條）')

  await g1.getByText('▶', { exact: true }).click()
  await settle(page)
  await capture('展開 g1')

  await page.getByText('＋ 新增分類', { exact: true }).click()
  await settle(page)
  await capture('新增分類')

  await page.getByText('＋ 新增任務', { exact: true }).click()
  await settle(page)
  await capture('新增任務')

  await page.getByText('＋ 新增 Issue', { exact: true }).click()
  await settle(page)
  await capture('新增 Issue')
}

/** 6. 改名、改狀態、改工期、改完成日期。 */
const editing: Scenario = async (page, capture) => {
  const row = page.locator('[data-rowtask="t2"]')
  await row.dblclick({ position: { x: 120, y: 17 } })
  await row.locator('input').fill('對照測試改名')
  await page.keyboard.press('Enter')
  await settle(page)
  await capture('列雙擊改名')

  const card = page.locator('[data-col="todo"] [data-card]').first()
  await card.getByText('待辦', { exact: true }).click()
  await clickFloat(page, '已完成')
  await capture('卡片狀態改為已完成')

  const card2 = page.locator('[data-col="doing"] [data-card]').first()
  await card2.getByText('▲', { exact: true }).click()
  await settle(page)
  await capture('卡片工期 +1 天')

  await card2.getByText('完成日期', { exact: true }).click()
  await clickFloat(page, '18')
  await capture('日期選擇器填完成日期')
}

/** 7. 詳細視窗：任務 ↔ Issue 導覽、留言、檔案頁籤。 */
const detail: Scenario = async (page, capture) => {
  const card = page.locator('[data-col="doing"] [data-card]').first()
  await card.getByText('⤢', { exact: true }).click()
  await settle(page)
  await capture('開啟任務詳細視窗')

  await markFloating(page)
  await float(page).locator('textarea').last().fill('對照測試留言')
  await page.keyboard.press('Enter')
  await settle(page)
  await capture('送出留言')

  await clickFloat(page, /檔案\s*\d/)
  await capture('切到檔案頁籤')

  await clickFloat(page, '✕')
  await capture('關閉詳細視窗')

  await page.locator('[data-issuerow]').first().getByText('⤢', { exact: true }).click()
  await settle(page)
  await capture('開啟 Issue 詳細視窗')

  await clickFloat(page, '✕')
  await capture('關閉 Issue 詳細視窗')
}

/** 8. 四種刪除確認之一（任務）與相依編輯器。 */
const deletion: Scenario = async (page, capture) => {
  const row = page.locator('[data-rowtask="t5"]')
  await row.hover()
  await settle(page, 300)
  await row.getByText('⇄', { exact: true }).click()
  await settle(page)
  await capture('開啟相依編輯器')

  await clickFloat(page, '完成')
  await capture('關閉相依編輯器')

  await row.hover()
  await settle(page, 300)
  await row.getByText('✕', { exact: true }).click()
  await settle(page)
  await capture('刪除任務確認第一步')

  await clickFloat(page, '繼續刪除')
  await capture('刪除任務確認第二步')

  await clickFloat(page, '確認刪除')
  await settle(page, 1500)
  await capture('任務、其 Issue 與相依都消失')
}

const SCENARIOS: { name: string; run: Scenario }[] = [
  { name: '行為 1：點任務後三面板同步高亮與淡化', run: selection },
  { name: '行為 2：頂部篩選與只顯示篩選結果', run: filtering },
  { name: '行為 3：多鍵排序與 Issue 分組', run: sorting },
  { name: '行為 4：甘特拖曳、相依連動與防循環', run: ganttDrag },
  { name: '行為 5：重排、收合摘要條與新增', run: structure },
  { name: '行為 6：改名、改狀態、改日期', run: editing },
  { name: '行為 7：詳細視窗與留言 / 檔案頁籤', run: detail },
  { name: '行為 8：刪除確認與相依編輯器', run: deletion },
]

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    for (const s of SCENARIOS) {
      test(s.name, async ({ page }) => {
        await compareScenario(page, s.run)
      })
    }

    // §不重現的原頁面 bug：這兩處新舊**應該不同**，所以不納入上面的對照，
    // 改成明確斷言「legacy 有這個 bug、新頁已修」。
    test('不重現 bug 1：從詳情刪任務後視窗正常關閉、body 可捲動', async ({ page }) => {
      async function deleteFromDetail(): Promise<{ modal: number; overflow: string }> {
        const card = page.locator('[data-col="doing"] [data-card]').first()
        await card.getByText('⤢', { exact: true }).click()
        await settle(page)
        await clickFloat(page, '刪除')
        await clickFloat(page, '繼續刪除')
        await clickFloat(page, '確認刪除')
        await settle(page, 700)
        await markFloating(page)
        return {
          modal: await float(page).count(),
          overflow: await page.evaluate(() => getComputedStyle(document.body).overflow),
        }
      }

      await openDashboard(page, 'legacy')
      const before = await deleteFromDetail()

      await openDashboard(page, 'vue')
      const after = await deleteFromDetail()

      // legacy :1761：detail 指向已刪 id，視窗留著且 body 捲動被鎖死。
      expect(before.overflow, 'legacy 應該還鎖著 body 捲動').toBe('hidden')
      // 新頁：removeTask 清 ui.detail，走正常關閉動畫。
      expect(after.modal, '新頁應該沒有殘留的浮層').toBe(0)
      expect(after.overflow, '新頁 body 應該可以捲動').not.toBe('hidden')
    })
  })
}
