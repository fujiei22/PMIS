import { expect, test } from '@playwright/test'
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
  type Trace,
} from './helpers/ovMotion'

/** 容器高度的連續性（動畫稽核 R2：C1 泳道層、T16、C9、C6 / T11、M10）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

const P = '[data-view-panel="cards"]'

const bottoms = (tr: Trace, name: string) => series(tr, name).map((b) => ({ t: b.t, dt: b.dt, v: b.y + b.h }))
const heights = (tr: Trace, name: string) => series(tr, name).map((b) => ({ t: b.t, dt: b.dt, v: b.h }))

test.describe('一欄寬（泳道內卡片一列一張）', () => {
  test.use({ viewport: { width: 640, height: 900 } })

  test('搜尋「入口」讓 m8 少一列：泳道框平順變矮、結尾不跳，離場的卡不畫到框外（C1 泳道層）', async ({ page }) => {
    // 資料前提：m8 有 portal、app 兩張（一欄寬時兩列）；「入口」只剩 portal，app 離場、泳道少一列
    await gotoOverview(page)
    const lane = `${P} [data-pm-col="m8"]`
    const app = `${P} [data-project="app"]`
    const tr = await trace(page, { lane, app }, () => page.getByTestId('overview-search').fill('入口'))

    // 泳道高度：上方的泳道離場時整條泳道也在上移，底邊混了上移的量；高度只看這條泳道自己的框
    const h = heights(tr, 'lane')
    const from = h[0]!.v
    const to = h[h.length - 1]!.v
    expect(from - to, '確實少了一列（有鑑別力）').toBeGreaterThan(60)
    // 篩選後第一幀要重排整個看板，常超過 25ms、被 jumpCount 略過；一幀塌掉時沒有任何一幀停在中間高度
    expect(h.filter((p) => p.v < from - 2 && p.v > to + 2).length, '逐幀經過中間高度').toBeGreaterThanOrEqual(3)
    expect(jumpCount(h)).toBe(0)
    expect(endSnap(h.map((p) => p.v))).toBe(false)

    const b = bottoms(tr, 'lane')
    expect(jumpCount(b)).toBe(0)
    expect(endSnap(b.map((p) => p.v))).toBe(false)

    // 離場的 app 還沒開始淡（透明度 ≥ 0.98）時不掛在泳道框外：框一幀縮掉時整張卡（約 150px）實心掛在框外。
    // 框與淡出同時進行，淡出中的卡下緣會超出正在縮的框（淡出由 Vue 晚兩幀才開始，cpu×6 時實心階段最多超出約 1/3 張）
    const out = tr.frames
      .filter((f) => f.t >= tr.at && f.boxes.lane && f.boxes.app && f.boxes.app.o >= 0.98)
      .map((f) => (f.boxes.app!.y + f.boxes.app!.h - (f.boxes.lane!.y + f.boxes.lane!.h)) / f.boxes.app!.h)
    expect(out.length, '有量到離場中的 app').toBeGreaterThan(0)
    expect(Math.max(...out), '實心的離場卡超出泳道框的比例（卡片高度為 1）').toBeLessThan(0.5)
  })

  test('搜尋「入口」讓 m8 少一列：留下的 portal 卡高度全程不變（撐住的網格不把多出來的空間分給卡片）', async ({ page }) => {
    // 卡片網格（grid）的 align-content 預設 normal＝stretch：高度撐在舊值時，剩下的列會被拉高去填滿，留下的卡跟著變高
    await gotoOverview(page)
    const portal = `${P} [data-project="portal"]`
    const before = (await page.locator(portal).boundingBox())!.height
    const tr = await trace(page, { portal, app: `${P} [data-project="app"]` }, () =>
      page.getByTestId('overview-search').fill('入口'),
    )
    expect(series(tr, 'app').some((b) => b.t >= tr.at), 'app 確實在離場（有鑑別力）').toBe(true)
    await expect(page.locator(`${P} [data-project="app"]`)).toHaveCount(0)
    const hs = series(tr, 'portal').map((b) => b.h)
    expect(hs.length).toBeGreaterThan(10)
    expect(Math.max(...hs.map((h) => Math.abs(h - before))), '留下的卡高度變了（px）').toBeLessThanOrEqual(1)
  })

  test('卡片網格補間到一半整條泳道被篩掉（「入口」→「入口x」）：收起中的泳道高度不跳', async ({ page }) => {
    // 泳道卸載時停掉網格的高度補間（heightTween 的 cancelHeight）：高度要停在當下，清掉的話收起中的泳道一幀跳回自然高度
    await gotoOverview(page)
    const search = page.getByTestId('overview-search')
    const lane = `${P} .board > [data-lane-wrap="m8"]`
    const body = `${P} [data-pm-col="m8"] .lane-body`
    const from = (await page.locator(body).boundingBox())!.height
    await search.fill('入口')
    await idle(page)
    const to = (await page.locator(body).boundingBox())!.height
    await search.fill('')
    await idle(page)
    expect(from - to, '「入口」讓 m8 少一列（有鑑別力）').toBeGreaterThan(60)
    await search.focus()
    let xAt = 0
    const tr = await trace(page, { lane, body }, async () => {
      await search.fill('入口')
      await pause(page, 90)
      xAt = await page.evaluate(() => performance.now() - (window as unknown as { __ovTrace: { t0: number } }).__ovTrace.t0)
      await page.keyboard.type('x')
    })
    await expect(page.locator(lane)).toHaveCount(0)
    const mid = series(tr, 'body').filter((b) => b.t <= xAt).at(-1)!.h
    expect(mid, '打 x 時卡片網格還在補間（有鑑別力）').toBeLessThan(from - 2)
    expect(mid, '打 x 時卡片網格還在補間（有鑑別力）').toBeGreaterThan(to + 2)
    expect(speedJumps(series(tr, 'lane').map((b) => ({ t: b.t, v: b.h }))), '收起中的泳道高度跳').toBe(0)
  })
})

/** 起點與終點之間（各留 2px）的幀數：一幀從起點跳到終點時是 0；長幀被 jumpCount 略過時靠這個抓。 */
const between = (pts: { v: number }[]): number => {
  const a = pts[0]!.v
  const z = pts[pts.length - 1]!.v
  return pts.filter((p) => p.v > Math.min(a, z) + 2 && p.v < Math.max(a, z) - 2).length
}

test.describe('空狀態與切檢視（C9、T16、C6 / T11、M10）', () => {
  test('打出沒結果的字又馬上刪：看板透明度全程 ≥ 0.95、空狀態從沒出現（C9）', async ({ page }) => {
    // 資料前提：「v1」只剩 m9 的 vendor，「v12」沒有結果
    await gotoOverview(page)
    const search = page.getByTestId('overview-search')
    await search.fill('v1')
    await idle(page)
    await expect(page.locator(`${P} [data-lane-wrap]`)).toHaveCount(1)
    await search.focus()
    const tr = await trace(page, { board: `${P} .board`, empty: '[data-testid="overview-empty"]' }, async () => {
      await page.keyboard.type('2')
      await pause(page, 80)
      await page.keyboard.press('Backspace')
    })
    await expect(search).toHaveValue('v1')
    // 看板是 ov-fade 過渡的根元素，它自己的 opacity 就是整塊淡出的進度
    expect(tr.frames.every((f) => f.boxes.board !== null && f.boxes.board.o >= 0.95), '看板一直在、沒淡掉').toBe(true)
    expect(tr.frames.some((f) => f.boxes.empty !== null), '空狀態出現過').toBe(false)
  })

  test('已經沒有結果時切檢視：新檢視一掛上就是空狀態（不延後）', async ({ page }) => {
    await gotoOverview(page)
    await page.getByTestId('overview-search').fill('zzzz')
    await idle(page)
    const tr = await trace(
      page,
      { board: '[data-view-panel="timeline"] .tl', empty: '[data-view-panel="timeline"] [data-testid="overview-empty"]' },
      () => page.locator('[data-view-switch="timeline"]').click(),
    )
    expect(tr.frames.some((f) => f.boxes.board !== null), '先閃出時間軸本體').toBe(false)
    expect(tr.frames.some((f) => f.boxes.empty !== null)).toBe(true)
  })

  for (const v of [
    { name: '卡片', hash: '', panel: P },
    { name: '時間軸', hash: '#timeline', panel: '[data-view-panel="timeline"]' },
  ]) {
    test(`${v.name} ↔ 空狀態兩個方向：面板底邊平順、結尾不跳（T16 / Design M1）`, async ({ page }) => {
      await gotoOverview(page, v.hash)
      const search = page.getByTestId('overview-search')
      const out = await trace(page, { panel: v.panel }, () => search.fill('zzzz'), { ms: 1200 })
      await expect(page.locator(`${v.panel} [data-testid="overview-empty"]`)).toBeVisible()
      const b1 = bottoms(out, 'panel')
      expect(b1[0]!.v - b1[b1.length - 1]!.v, '面板確實變矮（有鑑別力）').toBeGreaterThan(100)
      // 一幀塌掉時沒有任何一幀停在中間高度（那一幀常是長幀，jumpCount 會略過）
      expect(between(b1), '進空狀態：逐幀經過中間高度').toBeGreaterThanOrEqual(3)
      expect(jumpCount(b1), '進空狀態').toBe(0)
      expect(endSnap(b1.map((p) => p.v)), '進空狀態：結尾跳').toBe(false)
      await idle(page)

      const back = await trace(page, { panel: v.panel }, () => search.fill(''), { ms: 1200 })
      const b2 = bottoms(back, 'panel')
      expect(b2[b2.length - 1]!.v - b2[0]!.v, '面板確實變高（有鑑別力）').toBeGreaterThan(100)
      expect(between(b2), '回到有內容：逐幀經過中間高度').toBeGreaterThanOrEqual(3)
      expect(jumpCount(b2), '回到有內容').toBe(0)
      expect(endSnap(b2.map((p) => p.v)), '回到有內容：結尾跳').toBe(false)
    })
  }

  test('時間軸淡入到一半又切回卡片：透明度從當下往回，不先跳實心（M10）', async ({ page }) => {
    await gotoOverview(page)
    let switched = false
    const tr = await trace(
      page,
      { tl: '[data-view-panel="timeline"]' },
      async () => {
        await page.locator('[data-view-switch="timeline"]').click()
        // 時間軸淡入到一半時，在同一幀點回卡片：Playwright 的 click 要好幾趟往返，等它點到時可能已經淡完。
        // 時間軸面板是 ov-view 過渡的根元素，它自己的 opacity 就是淡入進度
        switched = await page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const t0 = performance.now()
              const tick = (): void => {
                const el = document.querySelector('[data-view-panel="timeline"]')
                const o = el ? parseFloat(getComputedStyle(el).opacity) : 0
                if (o > 0.25 && o < 0.55) {
                  document.querySelector<HTMLElement>('[data-view-switch="cards"]')!.click()
                  resolve(true)
                } else if (performance.now() - t0 > 2000) resolve(false)
                else requestAnimationFrame(tick)
              }
              tick()
            }),
        )
      },
      { ms: 1000 },
    )
    expect(switched, '在淡入途中點到卡片').toBe(true)
    const os = series(tr, 'tl').map((b) => b.o)
    const peak = Math.max(...os)
    const at = os.indexOf(peak)
    expect(peak, '沒有先跳成實心').toBeLessThan(0.98)
    expect(os.slice(at).every((o, i, a) => i === 0 || o <= a[i - 1]! + 0.02), '最亮之後一路往下').toBe(true)
    await expect(page.locator(P)).toBeVisible()
  })

  test.describe('平板橫向 1024×768 觸控', () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })

    test('捲到底切到時間軸：捲動速度連續、不反向、結束後不再跳；新檢視可見期間不瞬移（C6 / T11）', async ({ page }) => {
      await gotoOverview(page)
      await page.evaluate(() => scrollTo(0, 99999))
      await idle(page)
      const tr = await trace(page, { tl: '[data-view-panel="timeline"]' }, () => page.locator('[data-view-switch="timeline"]').tap(), {
        ms: 1500,
      })
      const sy = scrollSeries(tr, tr.at)
      expect(sy[0]!.v - sy[sy.length - 1]!.v, '時間軸比卡片矮、捲動被往上夾（有鑑別力）').toBeGreaterThan(50)
      expect(speedJumps(sy), '捲動速度跳').toBe(0)
      expect(reverses(sy.map((p) => p.v)), '捲動反向').toBe(false)
      expect(settledFor(sy, 150), '結束後不再變').toBe(true)
      // 從新檢視插入那一刻量整段（它跟著被夾的捲動移動）：只取看得見的幀的話，第一筆的前一幀速度被當成 0，
      // 正在移動中的起點一定被判成速度突變。修正前捲動在插入時一幀跳 110px，整段量照樣會紅
      const tl = series(tr, 'tl')
      expect(tl.filter((b) => b.o > 0.05).length, '有量到可見期間的時間軸').toBeGreaterThan(3)
      expect(speedJumps(tl.map((b) => ({ t: b.t, v: b.y }))), '新檢視插入後瞬移').toBe(0)
    })
  })
})
