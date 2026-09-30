import { expect, test, type Page } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'

/**
 * Dashboard 在平板直向（768×1024、觸控）的版面與手指操作。
 *
 * 版面：頂欄不再擠成好幾列、整頁沒有橫向捲動、摘要卡與兩個看板改 2 欄，卡片底部的按鈕都在外框內；
 * 甘特左欄縮成 250px，日期膠囊只寫工期（點了照樣開日期選擇器）；欄頭右端的展開鈕切回完整左欄、不清選取，欄頭不跑版。
 * 手指點任務只標記（日期照樣看得到）；動作收在列尾「⋮」開的選單，工期寫成「−1天 N 天 +1天」。
 * 手指操作：甘特選取後快捷鈕與相依圓點出現、手指拖得動條、滑動空白處是原生捲動且不清選取。
 * 手指拖曳用 CDP 送觸控事件（Playwright 的 touchscreen 只有 tap）。
 */

test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true })

/** 等甘特的水平捲動停下來（進頁捲到今天、選取任務捲到條，都是平滑捲動）：scrollLeft 連續幾幀不變才回傳。 */
function scrollIdle(page: Page): Promise<number> {
  return page.locator('.gantt-scroller').evaluate(
    (el) =>
      new Promise<number>((resolve) => {
        let last = -1
        let same = 0
        const tick = () => {
          same = el.scrollLeft === last ? same + 1 : 0
          last = el.scrollLeft
          if (same >= 5) resolve(last)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
}

/** 手指從 (x0, y0) 滑到 (x1, y1)，分 steps 步。 */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

test('版面：頂欄兩列內、沒有橫向捲動、摘要卡與看板改兩欄、卡片按鈕都在外框內', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()

  expect((await app.topBar.boundingBox())!.height).toBeLessThan(140)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)

  // 摘要卡 2×2：第三張（Issue 統計）換到第二列、和第一張同一欄
  const d = (await app.summary('progress').boundingBox())!
  const t = (await app.summary('issues').boundingBox())!
  expect(t.x).toBeCloseTo(d.x, 0)
  expect(t.y).toBeGreaterThan(d.y + d.height)

  // 看板兩欄：第三欄與第一欄左緣對齊
  const cols = page.locator('[data-panel="kanban"] .col')
  expect((await cols.nth(2).boundingBox())!.x).toBeCloseTo((await cols.nth(0).boundingBox())!.x, 0)
  expect(await cardControlsInside(page)).toBe(true)
})

/** 每張卡片底部的按鈕都在外框內、工期 ▲▼ 都在日期膠囊內（沒被擠出去或裁掉）。 */
function cardControlsInside(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-card], [data-issuerow]')].every((card) => {
      const r = card.getBoundingClientRect()
      const footOk = [...card.querySelectorAll('.foot > *')].every((el) => el.getBoundingClientRect().right <= r.right + 0.5)
      const pill = card.querySelector('.range-pill')?.getBoundingClientRect()
      const stepsOk = !pill || [...card.querySelectorAll('.step')].every((s) => {
        const b = s.getBoundingClientRect()
        return b.width > 0 && b.right <= pill.right + 0.5
      })
      return footOk && stepsOk
    }),
  )
}

test.describe('平板橫向（1024×768）', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('看板維持四欄；卡片按鈕與工期 ▲▼ 都放得下、沒有橫向捲動', async ({ page }) => {
    const app = new DashboardPage(page)
    await app.goto()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024)
    const cols = page.locator('[data-panel="kanban"] .col')
    expect((await cols.nth(3).boundingBox())!.y).toBeCloseTo((await cols.nth(0).boundingBox())!.y, 0)
    expect(await cardControlsInside(page)).toBe(true)
  })
})

test('看板卡片的「開啟詳細」點得到，✕ 用手指關閉', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await app.card('t3').locator('.caret').tap()
  await expect(page.locator('.detail-layer')).toBeVisible()
  await expect(page.locator('.draft-input')).toHaveAttribute('placeholder', '留言，或按「附件」加入檔案')
  await page.locator('.detail-close').tap()
  await expect(page.locator('.detail-layer')).toHaveCount(0)
})

test('甘特：左欄 250px，日期膠囊只寫工期，點了一樣開日期選擇器', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  expect((await page.locator('.gantt-left').boundingBox())!.width).toBe(250)
  const pill = app.row('t3').locator('.date-range')
  await expect(pill).toHaveText(/^\d+ 天$/)
  await expect(app.row('t3').locator('.date-days')).toHaveCount(0)
  await pill.tap()
  await expect(app.taskDatePicker).toBeVisible()
})

test('甘特：欄頭的展開鈕切回完整左欄（起訖日＋工期），再按一次收回；不清掉選取、欄頭不換行', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  const left = page.locator('.gantt-left')
  const btn = page.getByTestId('gantt-left-toggle')
  await app.row('t3').locator('.name').tap()
  await expect(app.row('t3')).toHaveAttribute('data-selected', 'true')

  // 寬度過渡途中逐幀量：欄頭標題維持一行（沒被擠成一字一行）、展開鈕沒被擠出欄頭；
  // 列裡的日期膠囊要等寬度撐開才換成起訖日：途中不能超出左欄，任務名也不能比展開前還窄（日期先出現就會把名字擠成「需求確…」）
  const nameBefore = await page.evaluate(() =>
    Math.min(...[...document.querySelectorAll('[data-rowtask]:not([data-selected="true"]) .name')].map((n) => n.getBoundingClientRect().width)),
  )
  const frames = page.evaluate(
    () =>
      new Promise<{ titleH: number; toggleOut: boolean; pillOut: number; minName: number }>((resolve) => {
        const left = document.querySelector('.gantt-left')!
        const head = document.querySelector('.gantt-left-head')!
        const title = head.querySelector('.left-title')!
        const toggle = head.querySelector('[data-testid="gantt-left-toggle"]')!
        const f = { titleH: 0, toggleOut: false, pillOut: -Infinity, minName: Infinity }
        const t0 = performance.now()
        const tick = () => {
          f.titleH = Math.max(f.titleH, title.getBoundingClientRect().height)
          if (toggle.getBoundingClientRect().right > head.getBoundingClientRect().right + 0.5) f.toggleOut = true
          const edge = left.getBoundingClientRect().right
          for (const row of document.querySelectorAll('[data-rowtask]:not([data-selected="true"])')) {
            f.pillOut = Math.max(f.pillOut, row.querySelector('.date')!.getBoundingClientRect().right - edge)
            f.minName = Math.min(f.minName, row.querySelector('.name')!.getBoundingClientRect().width)
          }
          if (performance.now() - t0 < 600) requestAnimationFrame(tick)
          else resolve(f)
        }
        requestAnimationFrame(tick)
      }),
  )
  await btn.tap()
  const f = await frames
  expect(f.titleH).toBeLessThan(20)
  expect(f.toggleOut).toBe(false)
  expect(f.pillOut).toBeLessThanOrEqual(0)
  expect(f.minName).toBeGreaterThanOrEqual(nameBefore - 0.5)
  await expect(btn).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => (await left.boundingBox())!.width).toBe(366)
  await expect(app.row('t4').locator('.date-range')).toHaveText(/^\d\d\/\d\d → \d\d\/\d\d$/)
  await expect(app.row('t4').locator('.date-days')).toBeVisible()
  await expect(app.row('t3')).toHaveAttribute('data-selected', 'true')

  await btn.tap()
  await expect(btn).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await left.boundingBox())!.width).toBe(250)
})

test('甘特：點任務只標記（日期還在）、相依圓點出現；手指拖得動條', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  // 條完整落在可見範圍：把條的左緣捲到畫布左邊 40px
  await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[data-taskid="t3"]')!
    document.querySelector('.gantt-scroller')!.scrollLeft = bar.offsetLeft - 40
  })
  await expect(app.rowMore('t3')).toBeVisible()
  await app.row('t3').locator('.name').tap()
  await expect(app.row('t3').locator('.date')).toBeVisible()
  await expect(app.rowMenu).toHaveCount(0)
  await expect(page.locator('[data-linkfor="t3"]').first()).toHaveClass(/shown/)
  // 選取會把條平滑捲到畫面左側：等捲完再量條的位置
  await scrollIdle(page)

  const before = await app.bar('t3').getAttribute('title')
  const b = (await app.bar('t3').boundingBox())!
  // 從條的左段往右拖 2 天（左段一定在畫面內；避開左右把手）
  const x = b.x + Math.min(b.width / 2, 60)
  await swipe(page, { x, y: b.y + b.height / 2 }, { x: x + 64, y: b.y + b.height / 2 })
  await expect.poll(() => app.bar('t3').getAttribute('title')).not.toBe(before)
})

test('甘特：「⋮」選單改工期（選單不關可連點）；點外面只關選單、不清標記', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  const pill = app.row('t3').locator('.date-range')
  await app.row('t3').locator('.name').tap()
  const days = Number((await pill.innerText()).match(/\d+/)![0])

  await app.rowMore('t3').tap()
  const menu = app.rowMenu
  await expect(menu.locator('.rm-days')).toHaveText(`${days} 天`)
  await menu.getByRole('button', { name: '+1天' }).tap()
  await menu.getByRole('button', { name: '+1天' }).tap()
  await expect(menu.locator('.rm-days')).toHaveText(`${days + 2} 天`)
  await menu.getByRole('button', { name: '−1天' }).tap()
  await expect(pill).toHaveText(`${days + 1} 天`)

  // 點選單外面：選單關掉，任務仍是標記狀態
  await page.touchscreen.tap(700, 40)
  await expect(menu).toHaveCount(0)
  await expect(app.row('t3')).toHaveAttribute('data-selected', 'true')
})

test('甘特：手指滑動空白處是原生捲動、不取消選取；點一下空白處才取消', async ({ page }) => {
  const app = new DashboardPage(page)
  await app.goto()
  await app.row('t3').locator('.name').tap()
  await expect(app.row('t3')).toHaveAttribute('data-selected', 'true')

  // 分類列那一行的畫布沒有條
  const g = (await app.groupRow('g1').boundingBox())!
  const y = g.y + g.height / 2
  const scroller = page.locator('.gantt-scroller')
  // 進頁會自動捲到今天：等捲動停下來才記起點
  const sl0 = await scrollIdle(page)
  await swipe(page, { x: 650, y }, { x: 450, y })
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(sl0 + 50)
  await expect(app.row('t3')).toHaveAttribute('data-selected', 'true')

  await page.touchscreen.tap(650, y)
  await expect(app.row('t3')).toHaveAttribute('data-selected', 'false')
})
