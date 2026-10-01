import { expect, test, type Page } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'

/**
 * Dashboard 頂欄：篩選器在標題與右端之間一行放不下時，整排移到滿寬的第二列（同平板版）。
 * user 回報 1200～1470px（15.6 吋筆電常見寬度）時篩選器在中間自己換行，標籤和它的下拉被拆開。
 * 量的是版型本身：篩選項全在標題列下方、全部同一行、靠左；放得下時維持跟標題同一行。
 */

interface Box {
  cls: string
  top: number
  bottom: number
  left: number
  /** 垂直中心：標籤文字與膠囊高度不同，比同一行要比中心。 */
  cy: number
}

/** 頂欄標題與篩選列裡每個看得到的項目（標籤、下拉觸發器、成員、日期膠囊、清除）。 */
async function layout(page: Page): Promise<{ title: Box; burgerLeft: number; items: Box[] }> {
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { cls: el.className.toString(), top: r.top, bottom: r.bottom, left: r.left, cy: r.top + r.height / 2 }
    }
    const items = [
      ...document.querySelectorAll(
        '.top-row .filters .section, .top-row .filters [data-dd][role="button"], .top-row .filters .date-pill, .top-row .filters .clear',
      ),
    ]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map(box)
    return {
      title: box(document.querySelector('.top-row .project')!),
      burgerLeft: document.querySelector('.top-row .burger')!.getBoundingClientRect().left,
      items,
    }
  })
}

/** 篩選列整排在標題列下方、全部同一行、從左邊開始。 */
async function expectStacked(page: Page, label: string): Promise<void> {
  const { title, burgerLeft, items } = await layout(page)
  expect(items.length, `${label} 有篩選項`).toBeGreaterThan(8)
  for (const it of items) expect(it.top, `${label}：${it.cls} 在標題列下方`).toBeGreaterThanOrEqual(title.bottom)
  const cys = items.map((i) => i.cy)
  expect(Math.max(...cys) - Math.min(...cys), `${label}：篩選項全在同一行（中心落差）`).toBeLessThanOrEqual(3)
  expect(Math.abs(Math.min(...items.map((i) => i.left)) - burgerLeft), `${label}：從左邊開始`).toBeLessThanOrEqual(2)
}

/** 篩選項跟標題在同一行（一行放得下的寬度維持現狀）。 */
async function expectOneRow(page: Page, label: string): Promise<void> {
  const { title, items } = await layout(page)
  for (const it of items) expect(Math.abs(it.cy - title.cy), `${label}：${it.cls} 跟標題同一行`).toBeLessThanOrEqual(6)
}

/** 直接寫 filter store（日期範圍要經過兩次日曆選擇，與版型無關）。 */
async function setDateRange(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as unknown as {
      __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, Record<string, unknown>> } } } }
    }).__vue_app__
    const f = app.config.globalProperties.$pinia._s.get('filter')!
    f.dateMode = 'between'
    f.d1 = '2026-09-01'
    f.d2 = '2026-09-30'
  })
}

test('1200～1470px：篩選器整排移到第二列，標籤不和下拉分開', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  const app = new DashboardPage(page)
  await app.goto()
  for (const width of [1200, 1280, 1366, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    // 換寬度後等版型穩定（ResizeObserver 在下一次繪製前切換）
    await expect
      .poll(async () => {
        const { title, items } = await layout(page)
        return items.every((i) => i.top >= title.bottom)
      })
      .toBe(true)
    await expectStacked(page, `${width}px`)
  }
  // 1470 離門檻（本機 Noto Sans TC 要 1471px 才放得下一行）只差 1px，字型沒載到、換了版本就可能剛好放得下：
  // 這裡只驗 user 在意的那件事——不會在中間自己換行（一行或整排兩列都算對）
  await page.setViewportSize({ width: 1470, height: 900 })
  await expect.poll(() => mode(page), '1470px 不在中間亂排').not.toBe('wrapped')
})

test('一行放得下（1536 / 1920 預設篩選）：維持跟標題同一行', async ({ page }) => {
  const app = new DashboardPage(page)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await app.goto()
  await expectOneRow(page, '1920px')
  await page.setViewportSize({ width: 1536, height: 900 })
  await expect.poll(async () => {
    const { title, items } = await layout(page)
    return items.every((i) => Math.abs(i.cy - title.cy) <= 6)
  }).toBe(true)
  await expectOneRow(page, '1536px')
})

test('1600px 啟用日期範圍（多兩顆日期膠囊）一行放不下：改兩列；清掉後回一行', async ({ page }) => {
  const app = new DashboardPage(page)
  await page.setViewportSize({ width: 1600, height: 900 })
  await app.goto()
  await expectOneRow(page, '1600px 預設')
  await setDateRange(page)
  await expect(page.locator('.top-row .filters .date-pill')).toHaveCount(2)
  await expect.poll(async () => {
    const { title, items } = await layout(page)
    return items.every((i) => i.top >= title.bottom)
  }).toBe(true)
  await expectStacked(page, '1600px 日期範圍')
  await page.getByTestId('filter-clear').click()
  await expect(page.locator('.top-row .filters .date-pill')).toHaveCount(0)
  await expect.poll(async () => {
    const { title, items } = await layout(page)
    return items.every((i) => Math.abs(i.cy - title.cy) <= 6)
  }).toBe(true)
})

/** 現在是哪一種版型：'one'＝篩選項全跟標題同一行；'stacked'＝全在標題列下方而且同一行；其他（在中間自己換行）＝'wrapped'。 */
async function mode(page: Page): Promise<'one' | 'stacked' | 'wrapped'> {
  const { title, items } = await layout(page)
  if (items.every((i) => Math.abs(i.cy - title.cy) <= 6)) return 'one'
  const cys = items.map((i) => i.cy)
  if (items.every((i) => i.top >= title.bottom) && Math.max(...cys) - Math.min(...cys) <= 3) return 'stacked'
  return 'wrapped'
}

/** 等 n 幀（頁內 rAF，不是固定毫秒）。 */
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n
        const tick = (): void => (--left <= 0 ? resolve() : void requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
    n,
  )
}

const RESIZES = [
  { width: 1366, oneRow: false },
  { width: 1600, oneRow: true },
  { width: 1366, oneRow: false },
  { width: 1920, oneRow: true },
  { width: 1280, oneRow: false },
]

test('視窗來回拉寬拉窄：每個寬度的版型都對、停下來之後不再變（不抖）', async ({ page }) => {
  const app = new DashboardPage(page)
  await page.setViewportSize({ width: 1366, height: 900 })
  await app.goto()
  for (const r of RESIZES) {
    await page.setViewportSize({ width: r.width, height: 900 })
    // 縮放當幀就切好（resize 事件在繪製前量），不會先出現在中間自己換行的舊版型
    await expect.poll(() => mode(page), `${r.width}px 的版型`).toBe(r.oneRow ? 'one' : 'stacked')
    const a = (await layout(page)).items.map((i) => Math.round(i.top))
    await frames(page, 10)
    const b = (await layout(page)).items.map((i) => Math.round(i.top))
    // 沒有在兩種版型之間來回切
    expect(b, `${r.width}px 穩定`).toEqual(a)
  }
})

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

interface CalendarLayout {
  cal: Rect
  /** 「日期」標籤。 */
  label: Rect
  /** 日期那一組（`.fgroup`）；一行時是 display: contents，量到的是 0。 */
  group: Rect
  pills: Rect[]
  filters: Rect
  /** 頂欄列的右側留白（px）。 */
  padRight: number
  /** 視窗寬（不含捲軸）。 */
  vw: number
}

/**
 * 從「日期」那一組的下拉選日期模式；選完日曆會自動打開。等日曆進場過渡跑完（過渡中的 transform 會讓位置不準）再量。
 */
async function openCalendar(page: Page, dateMode: '大於' | '介於'): Promise<CalendarLayout> {
  const group = page.locator('.top-row .fgroup').filter({ has: page.getByText('日期', { exact: true }) })
  await group.locator('[data-dd][role="button"]').first().click()
  await group.getByText(dateMode, { exact: true }).click()
  const cal = page.locator('.top-row .cal')
  await cal.waitFor()
  // 進場是 <Transition name="pop">：剛插入的一兩幀過渡還沒開始（getAnimations() 是空的、pop-enter-from 的 transform 還在），
  // 等 pop-enter-* 的 class 拿掉才算跑完
  await expect(cal).not.toHaveClass(/pop-enter/)
  return page.evaluate(() => {
    const rect = (el: Element): Rect => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    const label = [...document.querySelectorAll('.top-row .filters .section')].find(
      (el) => el.textContent?.trim() === '日期',
    )!
    return {
      cal: rect(document.querySelector('.top-row .cal')!),
      label: rect(label),
      group: rect(label.closest('.fgroup')!),
      pills: [...document.querySelectorAll('.top-row .date-pill')].map(rect),
      filters: rect(document.querySelector('.top-row .filters')!),
      padRight: parseFloat(getComputedStyle(document.querySelector('.top-row')!).paddingRight),
      vw: document.documentElement.clientWidth,
    }
  })
}

/** 日曆在膠囊下方、貼著膠囊、在視窗內。 */
function expectBelowPillsInView(r: CalendarLayout, label: string): void {
  const pillBottom = Math.max(...r.pills.map((p) => p.bottom))
  expect(r.cal.top, `${label}：日曆在膠囊下方`).toBeGreaterThanOrEqual(pillBottom)
  expect(r.cal.top - pillBottom, `${label}：日曆貼著膠囊`).toBeLessThanOrEqual(20)
  expect(r.cal.left, `${label}：日曆不超出左緣`).toBeGreaterThanOrEqual(0)
  expect(r.cal.right, `${label}：日曆不超出右緣`).toBeLessThanOrEqual(r.vw)
}

test('兩列時日期日曆貼著日期那一組打開：左緣對齊「日期」、在膠囊下方、不超出視窗', async ({ page }) => {
  // 篩選器滿寬時，日曆若照一行時對齊篩選器右緣，會離日期膠囊很遠（1600 約 300px，user 決定一併修）
  const app = new DashboardPage(page)
  for (const width of [1024, 1366, 1600]) {
    await page.setViewportSize({ width, height: 900 })
    await app.goto()
    const r = await openCalendar(page, '介於')
    await expect(page.locator('.top-row.stacked'), `${width}px 是兩列`).toHaveCount(1)
    expect(Math.abs(r.cal.left - r.label.left), `${width}px：日曆左緣對齊「日期」`).toBeLessThanOrEqual(1)
    expectBelowPillsInView(r, `${width}px`)
  }
})

test('兩列時日期那一組比日曆窄（大於，只有一顆膠囊）：日曆超出這一組右緣不超過列的右側留白，排在哪裡都不會超出視窗', async ({
  page,
}) => {
  // 這一組排在一列最尾、貼著右緣時，照樣左緣對齊會超出視窗（review 指出）；這個不變量讓它排在哪裡都不會超出
  const app = new DashboardPage(page)
  await page.setViewportSize({ width: 768, height: 900 })
  await app.goto()
  const r = await openCalendar(page, '大於')
  await expect(page.locator('.top-row.stacked')).toHaveCount(1)
  expect(r.group.right - r.group.left, '前提：這一組比日曆窄').toBeLessThan(r.cal.right - r.cal.left)
  expect(r.cal.right - r.group.right, '日曆超出這一組右緣的量 ≤ 列的右側留白').toBeLessThanOrEqual(r.padRight + 0.5)
  expect(r.cal.left, '日曆不會跑到「日期」右邊').toBeLessThanOrEqual(r.label.left + 1)
  expectBelowPillsInView(r, '768px')
})

test('一行時（1920）日期日曆仍對齊篩選器右緣（同 legacy）', async ({ page }) => {
  const app = new DashboardPage(page)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await app.goto()
  const { cal, filters } = await openCalendar(page, '介於')
  await expect(page.locator('.top-row.stacked')).toHaveCount(0)
  expect(Math.abs(cal.right - filters.right), '日曆右緣對齊篩選器右緣').toBeLessThanOrEqual(1)
})
