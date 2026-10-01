import { expect, test, type Page } from '@playwright/test'
import { gotoOverview, idle, reverses, series, trace } from './helpers/ovMotion'

/** 速覽抽屜與卡片的銜接（動畫稽核 C5、C7 B、C8、C11、C12、C14）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

const P = '[data-view-panel="cards"]'
const cardMain = (id: string): string => `${P} [data-project="${id}"] .card-main`

interface ArrowFrame {
  t: number
  /** 每張卡下緣箭頭看得到的程度：沒有 ::after（content none）算 0，否則是它的透明度。 */
  arrows: Record<string, number>
  /** 泳道抽屜的高度。 */
  h: number
  /** 抽屜目前在哪張卡下方（data-drawer）。 */
  on: string | null
}

/** 點 click（選擇器），之後 ms 毫秒逐幀記錄 ids 每張卡的箭頭、pm 泳道抽屜的高度與它在哪張卡下方；卡片或抽屜還不在的幀略過。 */
async function recordArrows(page: Page, pm: string, ids: string[], click: string, ms: number): Promise<ArrowFrame[]> {
  return page.evaluate(
    async ({ P, pm, ids, click, ms }) => {
      const arrowOf = (card: Element): number => {
        const a = getComputedStyle(card, '::after')
        return a.content === 'none' || a.content === 'normal' ? 0 : parseFloat(a.opacity)
      }
      const out: ArrowFrame[] = []
      ;(document.querySelector(click) as HTMLElement).click()
      const t0 = performance.now()
      await new Promise<void>((done) => {
        const tick = (): void => {
          const drawer = document.querySelector<HTMLElement>(`${P} [data-pm-col="${pm}"] .drawer`)
          const cards = ids.map((id) => document.querySelector(`${P} [data-project="${id}"]`))
          if (drawer && cards.every((c) => c)) {
            out.push({
              t: performance.now() - t0,
              arrows: Object.fromEntries(ids.map((id, i) => [id, arrowOf(cards[i]!)])),
              h: drawer.getBoundingClientRect().height,
              on: drawer.dataset.drawer ?? null,
            })
          }
          if (performance.now() - t0 < ms) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      return out
    },
    { P, pm, ids, click, ms },
  )
}

test('展開箭頭與抽屜同步：長出、收起的每一幀，箭頭透明度與抽屜高度進度相差 ≤ 0.35（C11）', async ({ page }) => {
  await gotoOverview(page)
  const opening = await recordArrows(page, 'm5', ['pmis'], cardMain('pmis'), 600)
  const full = opening.at(-1)!.h
  expect(full).toBeGreaterThan(100)
  expect(opening.every((f) => Math.abs(f.arrows.pmis! - f.h / full) <= 0.35), '長出時箭頭與抽屜不同步').toBe(true)
  await idle(page)
  const closing = await recordArrows(page, 'm5', ['pmis'], cardMain('pmis'), 600)
  expect(closing.at(-1)!.h).toBe(0)
  expect(closing.every((f) => Math.abs(f.arrows.pmis! - f.h / full) <= 0.35), '收起時箭頭與抽屜不同步').toBe(true)
})

test('切回卡片檢視：展開中那張的箭頭和抽屜一起在，不會在已全開的抽屜上方重新淡入（C11）', async ({ page }) => {
  await gotoOverview(page)
  await page.locator(cardMain('pmis')).click()
  await idle(page)
  await page.locator('[data-view-switch="timeline"]').click()
  await idle(page)
  const frames = await recordArrows(page, 'm5', ['pmis'], '[data-view-switch="cards"]', 600)
  expect(frames.length).toBeGreaterThan(5)
  const full = frames.at(-1)!.h
  expect(full).toBeGreaterThan(100)
  expect(frames.every((f) => Math.abs(f.arrows.pmis! - f.h / full) <= 0.35), '箭頭與抽屜不同步').toBe(true)
})

test.describe('一欄寬（換列）', () => {
  test.use({ viewport: { width: 640, height: 900 } })

  test('同泳道換到下一列的卡（m8：portal → app）：箭頭跟著抽屜走，舊卡的隨舊抽屜收起、新卡的等抽屜到新列才長出（C11）', async ({ page }) => {
    await gotoOverview(page)
    const portal = (await page.locator(`${P} [data-project="portal"]`).boundingBox())!
    const app = (await page.locator(`${P} [data-project="app"]`).boundingBox())!
    expect(app.y, 'portal 與 app 要在不同列').toBeGreaterThan(portal.y + portal.height)
    await page.locator(cardMain('portal')).click()
    await idle(page)
    const portalFull = (await page.locator(`${P} [data-pm-col="m8"] .drawer`).boundingBox())!.height
    const frames = await recordArrows(page, 'm8', ['portal', 'app'], cardMain('app'), 1000)
    const full: Record<string, number> = { portal: portalFull, app: frames.at(-1)!.h }
    expect(Math.min(portalFull, full.app!)).toBeGreaterThan(100)
    // 確實先在舊列收起、再到新列長出
    expect(frames.some((f) => f.on === 'portal' && f.h < portalFull - 1), '抽屜先在舊列收起').toBe(true)
    expect(frames.at(-1)!.on, '抽屜最後在 app 下方').toBe('app')
    const stray = frames.filter((f) => Object.entries(f.arrows).some(([id, o]) => id !== f.on && o > 0.1))
    expect(stray, '抽屜不在下方的卡亮著箭頭').toHaveLength(0)
    const lag = frames.filter((f) => Math.abs((f.arrows[f.on ?? ''] ?? 0) - f.h / (full[f.on ?? ''] ?? 1)) > 0.35)
    expect(lag, '箭頭與抽屜不同步').toHaveLength(0)
  })
})

test.describe('平板橫向 1024×768 觸控', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })

  test('泳道標頭黏住時收合面板：標頭逐幀連續，不先彈一下（C7 B）', async ({ page }) => {
    await gotoOverview(page)
    await page.locator(cardMain('pmis')).tap()
    await idle(page)
    const head = `${P} [data-pm-col="m5"] .lane-head`
    await page.locator(head).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => scrollBy(0, 120))
    await idle(page)
    const stuck = await page.locator(head).evaluate((el) => el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top)
    expect(stuck, '標頭要先黏住（離泳道頂有一段距離）').toBeGreaterThan(50)
    const tr = await trace(page, { head }, () => page.locator(`${P} .panel-toggle`).tap())
    const hs = series(tr, 'head', tr.at)
    expect(hs.length).toBeGreaterThan(3)
    // 頁面還沒被夾（scrollY 沒變）的幀，黏住的標頭不該動：過渡中 overflow hidden 時第一幀就彈回泳道頂（約 −220px）
    const unscrolled = hs.filter((b) => Math.abs(b.sy - hs[0]!.sy) < 0.5)
    expect(unscrolled.length).toBeGreaterThan(1)
    expect(unscrolled.every((b) => Math.abs(b.y - hs[0]!.y) <= 1), '頁面沒捲動時標頭先彈走').toBe(true)
    // 之後頁面變短、捲動被夾，只會把標頭往下帶，途中不往回
    expect(reverses(hs.map((b) => b.y)), '標頭先往上彈再被拉下').toBe(false)
  })
})
