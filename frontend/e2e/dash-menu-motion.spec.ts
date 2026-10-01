import { expect, test, type Locator, type Page } from '@playwright/test'
import { clickInPage, openDashboard, pause, series, trace, type Trace } from './helpers/motion'

/**
 * Dashboard 頂欄的浮層（動畫稽核批次 C 的 Dashboard 部分，docs/incidents/2026-09-30-motion-audit）。
 * G19：日曆開著時點頂欄其他下拉，第一下不被吃掉；點日期膠囊切換端點時日曆不關不閃。
 * G7：下拉 / 成員面板開著勾選項讓觸發鈕變寬時，選單不被帶著跑；一行時某項變寬，左邊的項目滑過去。
 */
test.use({ viewport: { width: 1920, height: 1080 } })

/**
 * 速度不連續的幀數：單幀位移 > 8px，而且速度（位移 / 間隔）比前後兩幀都大 2.5 倍以上。
 * 用速度不用「單幀位移佔總位移幾成」：跑全套 e2e 時 CPU 忙、一幀可能隔 50ms 以上，
 * 補間照實際時間走，那一幀位移本來就大，但速度跟前後幀接得上；瞬移是前後都不動、只有那一幀動。
 */
function speedJumps(pts: { t: number; v: number }[]): number {
  const sp = pts.map((p, i) => (i === 0 ? 0 : Math.abs(p.v - pts[i - 1]!.v) / Math.max(1, p.t - pts[i - 1]!.t)))
  let n = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.abs(pts[i]!.v - pts[i - 1]!.v)
    if (d > 8 && sp[i]! > 2.5 * (sp[i - 1] ?? 0) && sp[i]! > 2.5 * (sp[i + 1] ?? 0)) n++
  }
  return n
}

/** 朝終點走的途中往回超過 tol（px）：方向不單調。 */
function reverses(vs: number[], tol = 1): boolean {
  if (vs.length < 2) return false
  const dir = Math.sign(vs[vs.length - 1]! - vs[0]!)
  return vs.some((v, i) => i > 0 && (v - vs[i - 1]!) * dir < -tol)
}

/** 某個元素逐幀的 x：總位移、速度不連續的幀數、方向是否單調。 */
function slideX(tr: Trace, name: string): { moved: number; jumps: number; monotonic: boolean } {
  const pts = series(tr, name).map((b) => ({ t: b.t, v: b.x }))
  const vs = pts.map((p) => p.v)
  return {
    moved: Math.abs(vs[vs.length - 1]! - vs[0]!),
    jumps: speedJumps(pts),
    monotonic: !reverses(vs),
  }
}

/** 用真的滑鼠點元素（照實際的命中測試：被遮罩蓋住就點到遮罩；locator.click() 會一直等到點得到）。 */
async function mouseClick(
  page: Page,
  target: Locator,
  at?: { x: number; y: number },
): Promise<void> {
  const b = await target.boundingBox()
  if (!b) throw new Error('找不到要點的元素')
  await page.mouse.click(b.x + (at?.x ?? b.width / 2), b.y + (at?.y ?? b.height / 2))
}

const calendar = (page: Page): Locator => page.locator('.top-row .cal')

/** 等日曆進場過渡跑完（pop-enter-* 的 class 拿掉）。 */
async function calendarSettled(page: Page): Promise<void> {
  await calendar(page).waitFor()
  await expect(calendar(page)).not.toHaveClass(/pop-enter/)
}

/** 從「日期」下拉選日期模式；選完日曆會自動打開。 */
async function openCalendar(page: Page, mode: '大於' | '介於'): Promise<void> {
  await page.locator('.top-row .dd-trigger', { hasText: '日期' }).click()
  await page.locator('.top-row .dd-item', { hasText: mode }).click()
  await calendarSettled(page)
}

/** 開始數日曆「離場」的次數：.cal 被加上 pop-leave-* 或被移除（關了又重開也算）。 */
async function countCalendarLeaves(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __calLeaves: number }
    w.__calLeaves = 0
    const isCal = (n: Node): boolean => n instanceof Element && n.classList.contains('cal')
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (
          r.type === 'attributes' &&
          isCal(r.target) &&
          (r.target as Element).className.includes('pop-leave')
        )
          w.__calLeaves++
        if (r.type === 'childList') for (const n of r.removedNodes) if (isCal(n)) w.__calLeaves++
      }
    }).observe(document.querySelector('.top-row')!, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  })
  return () => page.evaluate(() => (window as unknown as { __calLeaves: number }).__calLeaves)
}

test('G19 日曆開著時點頂欄「狀態」下拉：第一下就打開，日曆收起', async ({ page }) => {
  await openDashboard(page)
  await openCalendar(page, '大於')
  await mouseClick(page, page.locator('.top-row .dd-trigger').first())
  await expect(
    page.locator('.top-row .dd').first().locator('.dd-menu'),
    '狀態下拉打開了',
  ).toBeVisible()
  await expect(calendar(page), '日曆收起').toHaveCount(0)
})

test('G19 「介於」日曆開著時點另一顆日期膠囊：日曆不關不閃，改填另一端', async ({ page }) => {
  await openDashboard(page)
  await openCalendar(page, '介於')
  const ends = calendar(page).locator('.cal-end')
  await expect(ends.nth(0)).toHaveClass(/aimed/)

  const leaves = await countCalendarLeaves(page)
  await mouseClick(page, page.locator('.top-row .date-pill').nth(1))
  await pause(page, 300)
  expect(await leaves(), '日曆沒有開始離場、也沒有關掉重開').toBe(0)
  await expect(ends.nth(1), '改填結束日').toHaveClass(/aimed/)
})

test('G19 日曆開著時點頁面空白處：日曆收起', async ({ page }) => {
  await openDashboard(page)
  await openCalendar(page, '大於')
  await mouseClick(page, page.locator('[data-panel="gantt"] .panel-head'), { x: 5, y: 5 })
  await expect(calendar(page), '點面板標題列空白處').toHaveCount(0)

  // 頂欄裡的空白處（專案名稱）也一樣
  await mouseClick(page, page.locator('.top-row .date-pill'))
  await calendarSettled(page)
  await mouseClick(page, page.locator('.top-row .project'))
  await expect(calendar(page), '點頂欄的專案名稱').toHaveCount(0)
})

/**
 * G7 錨點：頂欄一行時篩選器靠右排（flex-end），觸發鈕變寬是左緣往左長、右緣不動；兩列時靠左排，左緣不動。
 * 下拉 / 成員面板開著勾選項讓觸發鈕變寬，選單要錨在不動的那一側，不能被帶著跑。
 */
for (const vp of [
  { width: 1920, stacked: false },
  { width: 1366, stacked: true },
]) {
  test.describe(`${vp.width}px（${vp.stacked ? '兩列' : '一行'}）`, () => {
    test.use({ viewport: { width: vp.width, height: 900 } })

    for (const m of [
      {
        name: '狀態下拉開著勾第一項',
        open: '.top-row .dd-trigger',
        sel: '.top-row .dd-menu',
        pick: '.top-row .dd-menu .dd-item',
      },
      {
        name: '成員面板開著勾一位',
        open: '.mp-trigger',
        sel: '.mp-panel',
        pick: '.mp-panel .mp-row',
      },
    ]) {
      test(`G7 ${m.name}：選單位置不動`, async ({ page }) => {
        await openDashboard(page)
        await expect(page.locator('.top-row.stacked'), '前提：版型').toHaveCount(vp.stacked ? 1 : 0)
        await page.locator(m.open).first().click()
        await expect(page.locator(m.sel)).not.toHaveClass(/pop-enter/)
        const trigger = await page.locator(m.open).first().boundingBox()

        const tr = await trace(page, { menu: m.sel }, () => clickInPage(page, m.pick))
        const after = await page.locator(m.open).first().boundingBox()
        expect(Math.abs(after!.width - trigger!.width), '前提：觸發鈕寬度變了').toBeGreaterThan(2)

        const xs = series(tr, 'menu').map((b) => b.x)
        const drift = Math.max(...xs.map((x) => Math.abs(x - xs[0]!)))
        expect(drift, '選單左緣的位移（px）').toBeLessThanOrEqual(1)
        expect(Math.min(...xs), '選單不超出視窗左緣').toBeGreaterThanOrEqual(0)
      })
    }
  })
}

/**
 * G7 位移：頂欄一行時篩選器靠右排（flex-end），某一項變寬，它左邊的整排往左移。
 * 選日期「介於」多出兩顆日期膠囊與「～」，1920 時整排左移約 248px——要平滑滑過去，不能一幀跳到位。
 */
test.describe('G7 一行時篩選項變寬：左邊的項目滑到新位置', () => {
  /** 狀態觸發鈕：「任務」那一組（第 2 個 .fgroup）的第一個下拉。trace 取最後一個符合的元素，選擇器要唯一。 */
  const STATUS = '.top-row .filters > .fgroup:nth-child(2 of .fgroup) > .dd:nth-child(1 of .dd) > .dd-trigger'

  test('選「介於」：成員 / 狀態觸發鈕逐幀滑過去（無單幀瞬移、方向單調）', async ({ page }) => {
    await openDashboard(page)
    await expect(page.locator('.top-row.stacked'), '前提：一行').toHaveCount(0)
    await expect(page.locator(STATUS), '前提：選到狀態觸發鈕').toHaveText(/狀態/)
    await page.locator('.top-row .dd-trigger', { hasText: '日期' }).click()
    const menu = page.locator('.top-row .dd-menu')
    await expect(menu).not.toHaveClass(/pop-enter/)
    await expect(menu.locator('.dd-item').nth(3), '前提：第 4 項是「介於」').toHaveText(/介於/)

    const tr = await trace(page, { member: '.mp-trigger', status: STATUS }, () =>
      clickInPage(page, '.top-row .dd-menu .dd-item:nth-child(4)'),
    )
    await expect(page.locator('.top-row .date-pill'), '前提：出現兩顆日期膠囊').toHaveCount(2)
    await expect(page.locator('.top-row.stacked'), '前提：還是一行').toHaveCount(0)
    for (const name of ['member', 'status']) {
      const r = slideX(tr, name)
      expect(r.moved, `${name}：前提：整排左移了`).toBeGreaterThan(100)
      expect(r.jumps, `${name}：單幀瞬移的次數（總位移 ${r.moved.toFixed(1)}px）`).toBe(0)
      expect(r.monotonic, `${name}：一路朝新位置走、不回頭`).toBe(true)
    }
  })
})

/**
 * G6：看板 / Issue 看板的排序選單開著時加 / 移除一層排序。chip 插在觸發鈕前面，
 * 原本觸發鈕與選單（錨在觸發鈕）一起一幀橫移約 99px，游標下的選項跑掉。
 * 改成：選單開著時位置固定；chip 原地展開 / 收起，觸發鈕跟著版面連續滑動。
 */
for (const p of [
  // 選項的第 1 個子元素是提示文字，第 n 個選項是 :nth-child(n + 1)
  { panel: 'kanban', name: '看板', add: { nth: 3, label: '工期' } },
  { panel: 'issues', name: 'Issue 看板', add: { nth: 2, label: '等級' } },
]) {
  test(`G6 ${p.name}排序選單開著時加 / 移除一層：選單不動、觸發鈕連續滑動`, async ({ page }) => {
    const head = `[data-panel="${p.panel}"] .panel-head`
    const targets = { menu: `${head} .sort-menu`, trigger: `${head} .sort-trigger` }
    const chips = page.locator(`${head} .sort-chip`)
    await openDashboard(page)
    await page.locator(targets.trigger).scrollIntoViewIfNeeded()
    await page.locator(targets.trigger).click()
    await expect(page.locator(targets.menu)).not.toHaveClass(/pop-enter/)
    await expect(chips, '前提：預設一層排序').toHaveCount(1)
    const option = `${targets.menu} .sort-option:nth-child(${p.add.nth})`
    await expect(page.locator(option), '前提：選到要加的那一層').toHaveText(new RegExp(p.add.label))

    /** 量一次：選單左上角不動（≤ 1px），觸發鈕逐幀連續滑動、一路朝新位置走。 */
    function expectSteady(tr: Trace, label: string): void {
      const t = slideX(tr, 'trigger')
      expect(t.moved, `${label}：前提：觸發鈕的位置變了`).toBeGreaterThan(50)
      expect(t.jumps, `${label}：觸發鈕單幀瞬移的次數（總位移 ${t.moved.toFixed(1)}px）`).toBe(0)
      expect(t.monotonic, `${label}：觸發鈕一路朝新位置走、不回頭`).toBe(true)
      const m = series(tr, 'menu')
      const drift = Math.max(...m.map((b) => Math.max(Math.abs(b.x - m[0]!.x), Math.abs(b.y - m[0]!.y))))
      expect(drift, `${label}：選單的位移（px）`).toBeLessThanOrEqual(1)
      expect(m.every((b) => b.n === 1 && b.o > 0.99), `${label}：選單一直開著`).toBe(true)
    }

    const adding = await trace(page, targets, () => clickInPage(page, option))
    await expect(chips, '前提：多了一層').toHaveCount(2)
    expectSteady(adding, '加一層')

    // 頁內直接 click()：真的滑鼠點 ✕ 時 pointerdown 會先讓 useClickOutside 收起選單，
    // 這裡量的是「選單開著時層數變少」，chip 收起的過渡與選單錨點
    const removing = await trace(page, targets, () => clickInPage(page, `${head} .sort-chip .chip-x`))
    await expect(chips, '前提：少了一層').toHaveCount(1)
    expectSteady(removing, '移除一層')
  })
}
