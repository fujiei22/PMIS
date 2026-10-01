import { expect, test, type Page } from '@playwright/test'
import {
  endSnap,
  gotoOverview,
  idle,
  jumpCount,
  pause,
  reverses,
  scrollSeries,
  series,
  settledFor,
  speedJumps,
  trace,
  type Box,
  type Trace,
} from './helpers/ovMotion'

/** 泳道 / 時間軸群組 / 列的原地收合（動畫稽核 R2：C1、C3、T1、T2、C2 c、T3）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

const P = '[data-view-panel="cards"]'
/** samplePortfolio 的 PM（當過專案 PM 的成員）；泳道照卡片的排序排，不固定。 */
const PMS = ['m5', 'm8', 'm9', 'm10']

/**
 * 每條泳道的外層（看板的直接子元素）。用 PM id 對應、不用開始時 probe 到的元素：進場的泳道開始時還不在畫面上，也要量。
 * 原地收合前外層就是 .lane（data-pm-col），之後是 .lane-wrap（data-lane-wrap）；兩種都認，修正前後量的是同一個東西。
 */
const laneOf = (pm: string): string => `${P} .board > :is([data-pm-col="${pm}"], [data-lane-wrap="${pm}"])`

/** 面板與每條泳道外層的逐幀量測。 */
function traceLanes(page: Page, action: () => Promise<unknown>, ms = 900): Promise<Trace> {
  return trace(page, { panel: P, ...Object.fromEntries(PMS.map((pm) => [pm, laneOf(pm)])) }, action, { ms })
}

/** 某一幀看得到的泳道（照 PMS 順序）；預設最後一幀。用來確認情境真的有泳道進出（有鑑別力）。 */
function lanesIn(tr: Trace, frame = tr.frames.length - 1): string[] {
  const f = tr.frames[frame]
  return PMS.filter((pm) => {
    const b = f?.boxes[pm]
    return !!b && b.h > 0.5 && b.o > 0.05
  })
}

const bottoms = (tr: Trace, name: string) => series(tr, name).map((b) => ({ t: b.t, dt: b.dt, v: b.y + b.h }))

/**
 * 落在全距中段（離最高、最低都超過一成）的幀數：一路連續變化的過渡有很多幀，一幀到位的是 0。
 * jumpCount 不看長幀（dt ≥ 25ms），而篩選更新那一幀要重新渲染整個看板，常常就是長幀——
 * 修正前清除篩選時面板一幀長高 516px，剛好落在 31–53ms 的那一幀，jumpCount 抓不到（實測），所以另外數中段幀。
 */
function midFrames(vs: number[]): number {
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  return vs.filter((v) => v > lo + 0.1 * (hi - lo) && v < hi - 0.1 * (hi - lo)).length
}

/** 面板底邊現在（靜止時）的位置。 */
const panelBottom = (page: Page): Promise<number> => page.locator(P).evaluate((el) => el.getBoundingClientRect().bottom)

/** 反悔情境：篩選前、篩完（靜止）時的面板底邊。 */
interface Reversal {
  full: number
  filtered: number
}

/**
 * @param reversal 收到一半就反悔（打了又刪、勾了又取消）時給：
 *   - 全距只有半途那一段，收合最陡那一幀本來就走全距四五成（實測 44.8 / 86.7px），jumpCount 的全距比例會誤判，
 *     改看速度突變（speedJumps：同一幀速度大於前後兩幀各 2.5 倍，長幀也照算）。
 *   - 同 key 回來若從 0 重長，面板底邊會先一路掉到「篩完」的靜止高度再長回（那一幀常是長幀、又正好在收合最快的時候，
 *     速度判斷不一定抓得到，實測 2.38 倍）；從當下高度接續的話只掉到反悔那一刻收到的地方。所以另外量掉了多深。
 */
function expectLanesContinuous(tr: Trace, reversal?: Reversal): void {
  const panel = bottoms(tr, 'panel')
  const pv = panel.map((p) => p.v)
  if (!reversal) expect(jumpCount(panel), '面板底邊單幀跳').toBe(0)
  expect(speedJumps(panel), '面板底邊速度突變').toBe(0)
  expect(endSnap(pv), '面板底邊結尾跳').toBe(false)
  if (Math.max(...pv) - Math.min(...pv) > 20) expect(midFrames(pv), '面板底邊一路連續變化，不是一幀到位').toBeGreaterThanOrEqual(3)
  if (reversal) {
    // 0 = 沒掉、1 = 掉到篩完的高度
    const dip = (reversal.full - Math.min(...pv)) / (reversal.full - reversal.filtered)
    expect(dip, '有在收合途中反悔（有鑑別力）').toBeGreaterThan(0.05)
    expect(dip, '反悔時面板底邊先掉到篩完的高度（同 key 回來從 0 重長）').toBeLessThan(0.9)
  }
  for (const pm of PMS) {
    const ys = series(tr, pm).map((b) => ({ t: b.t, dt: b.dt, v: b.y }))
    if (!reversal) expect(jumpCount(ys), `${pm} 單幀瞬移`).toBe(0)
    expect(speedJumps(ys), `${pm} 速度突變`).toBe(0)
    expect(endSnap(ys.map((p) => p.v)), `${pm} 結尾跳`).toBe(false)
  }
  // 每一幀：看得見的泳道（由上往下）互不重疊、不畫到面板外（容 2px）。
  // 兩條都留下的泳道在重排時交錯而過是 move 的本意（例：打 p 時 m5 / m8 換順序），不算；
  // 有一條正在收起 / 長出（淡入淡出中）就不能和別條疊在一起（修正前離場的泳道釘在原位，下面的泳道滑上來疊住它）
  for (const f of tr.frames) {
    const vis = PMS.map((pm) => f.boxes[pm])
      .filter((b): b is Box => !!b && b.h > 0.5 && b.o > 0.05)
      .sort((a, b) => a.y - b.y)
    vis.forEach((b, k) => {
      const a = vis[k - 1]
      if (a && (a.o < 0.99 || b.o < 0.99)) expect(b.y, '泳道重疊').toBeGreaterThanOrEqual(a.y + a.h - 2)
    })
    const panelBox = f.boxes.panel
    if (panelBox) vis.forEach((b) => expect(b.y + b.h, '泳道畫到面板外').toBeLessThanOrEqual(panelBox.y + panelBox.h + 2))
  }
}

test('勾「已完成」：多條泳道同時原地收合，面板與泳道一路平順、結尾不跳（C1 / T1）', async ({ page }) => {
  await gotoOverview(page)
  await page.locator('[data-ov-dd="status"] button.dd-trigger').click()
  await idle(page)
  const tr = await traceLanes(page, () =>
    page.locator('[data-ov-dd="status"]').getByRole('button', { name: '已完成', exact: true }).click(),
  )
  expect([lanesIn(tr, 0), lanesIn(tr)], '四條泳道收到只剩已完成專案（報表資料倉儲）的 m9').toEqual([PMS, ['m9']])
  expectLanesContinuous(tr)
})

test('清除篩選：泳道原地長出，面板底邊一路長高、結尾不跳', async ({ page }) => {
  await gotoOverview(page)
  await page.getByTestId('overview-search').fill('pmis')
  await idle(page)
  const tr = await traceLanes(page, () => page.getByTestId('overview-clear').click())
  expect([lanesIn(tr, 0), lanesIn(tr)], '從 m5 一條長回四條').toEqual([['m5'], PMS])
  expectLanesContinuous(tr)
})

test('打 p 80ms 內刪掉：離場中又回來的泳道從當下高度接續，面板底邊不上跳再推回（C2 c / T3）', async ({ page }) => {
  await gotoOverview(page)
  const search = page.getByTestId('overview-search')
  const full = await panelBottom(page)
  await search.fill('p')
  await idle(page)
  const filtered = await panelBottom(page)
  await search.fill('')
  await idle(page)
  await search.focus()
  const tr = await traceLanes(page, async () => {
    await page.keyboard.type('p')
    await pause(page, 80)
    await page.keyboard.press('Backspace')
  })
  expect(lanesIn(tr), '反悔後四條泳道都在').toEqual(PMS)
  expectLanesContinuous(tr, { full, filtered })
})

test('逐字打 app（每字 80ms）再逐字刪；100ms 內勾了狀態又取消：泳道不瞬移', async ({ page }) => {
  await gotoOverview(page)
  await page.getByTestId('overview-search').focus()
  const a = await traceLanes(
    page,
    async () => {
      for (const ch of 'app') {
        await page.keyboard.type(ch)
        await pause(page, 80)
      }
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Backspace')
        await pause(page, 80)
      }
    },
    1200,
  )
  expect(lanesIn(a), '刪完四條泳道都回來').toEqual(PMS)
  expectLanesContinuous(a)

  await gotoOverview(page)
  await page.locator('[data-ov-dd="status"] button.dd-trigger').click()
  await idle(page)
  const opt = page.locator('[data-ov-dd="status"]').getByRole('button', { name: '進行中', exact: true })
  const full = await panelBottom(page)
  await opt.click()
  await idle(page)
  const filtered = await panelBottom(page)
  await opt.click()
  await idle(page)
  const b = await traceLanes(page, async () => {
    await opt.click()
    await pause(page, 100)
    await opt.click()
  })
  expect(lanesIn(b), '取消後四條泳道都在').toEqual(PMS)
  expectLanesContinuous(b, { full, filtered })
})

test('PR #22 回歸：搜尋「入口」→ 清空，泳道與面板不瞬移', async ({ page }) => {
  await gotoOverview(page)
  const search = page.getByTestId('overview-search')
  await search.fill('入口')
  await idle(page)
  const tr = await traceLanes(page, () => search.fill(''))
  expect([lanesIn(tr, 0), lanesIn(tr)], '入口只剩 m8、m9，清空後四條').toEqual([['m8', 'm9'], PMS])
  expectLanesContinuous(tr)
})

test.describe('平板橫向 1024×768 觸控', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })

  test('捲到底再篩選：捲動速度連續、不反向、結束後不再跳（C3）', async ({ page }) => {
    await gotoOverview(page)
    await page.locator('[data-ov-dd="status"] button.dd-trigger').click()
    await idle(page)
    await page.evaluate(() => scrollTo(0, 99999))
    await idle(page)
    const tr = await trace(
      page,
      {},
      () => page.locator('[data-ov-dd="status"]').getByRole('button', { name: '進行中', exact: true }).click(),
      { ms: 1100 },
    )
    const sy = scrollSeries(tr, tr.at)
    expect(Math.abs(sy[sy.length - 1]!.v - sy[0]!.v), '捲動確實被夾（有鑑別力）').toBeGreaterThan(40)
    expect(speedJumps(sy), '捲動速度跳').toBe(0)
    expect(reverses(sy.map((p) => p.v)), '捲動反向').toBe(false)
    expect(settledFor(sy, 150), '結束後不再變').toBe(true)
  })
})
