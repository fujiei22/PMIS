import { expect, test } from '@playwright/test'
import { endSnap, gotoOverview, jumpCount, series, trace, type Trace } from './helpers/ovMotion'

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
})
