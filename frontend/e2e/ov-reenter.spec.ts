import { expect, test, type Page } from '@playwright/test'
import { gotoOverview, idle, opacityJumps, pause, series, speedJumps, trace, type Trace } from './helpers/ovMotion'

/**
 * 同一個 key 在離場途中又回來（動畫稽核 R3「淡出到一半的直接消失」、C2 c）。
 * - 卡片（freezeLeave 釘位離場）：回來的卡從舊卡當下看得到的位置、透明度、大小接續，不先消失再從頭淡入、不瞬移（Task 4c）。
 * - 卡片、泳道、時間軸群組與列：反悔後立刻往回，不在起點多停兩幀（useFreezeReenter / useCollapseReenter）。
 */
test.use({ viewport: { width: 1920, height: 1080 } })

const P = '[data-view-panel="cards"]'
const T = '[data-view-panel="timeline"]'
/** samplePortfolio 的 7 個專案（`src/mocks/samplePortfolio.ts`）。 */
const IDS = ['pmis', 'portal', 'payment', 'dw', 'app', 'wiki', 'vendor']

/** 每張卡與它所在的 .lane-body（`:has()` 找父層；卡片離場中仍是它的子元素）。同 ov-flip.spec。 */
const CARDS = Object.fromEntries(
  IDS.flatMap((id) => [
    [id, `${P} [data-project="${id}"]`],
    [`${id}:body`, `${P} .lane-body:has(> [data-project="${id}"])`],
  ]),
)

interface CardPt {
  t: number
  dt: number
  /** 卡片中心相對所在 .lane-body 的位置。 */
  cx: number
  cy: number
  /** 看得到的寬（含縮放）。 */
  w: number
  o: number
}

/** 卡片相對所在 .lane-body 的逐幀中心、寬與透明度；卡片或泳道不在畫面上的幀略過。 */
function card(tr: Trace, id: string): CardPt[] {
  return tr.frames
    .filter((f) => f.boxes[id] && f.boxes[`${id}:body`])
    .map((f) => {
      const c = f.boxes[id]!
      const b = f.boxes[`${id}:body`]!
      return { t: f.t, dt: f.dt, cx: c.x + c.w / 2 - b.x, cy: c.y + c.h / 2 - b.y, w: c.w, o: c.o }
    })
}

/**
 * 記下搜尋框每次 input 事件的時間（同 Frame.t 基準，trace 開始後才有意義）。
 * 給了 watch 的話，第 2 次 input（反悔那一下）之後的第一幀（rAF）記下這些元素身上正在跑的 CSS 過渡屬性（firstFrame）。
 */
async function watchInputs(page: Page, watch: string[] = []): Promise<void> {
  await page.evaluate((watch) => {
    const w = window as unknown as { __inputs: number[]; __first: Record<string, string[] | null>; __ovTrace?: { t0: number } }
    w.__inputs = []
    w.__first = {}
    document.addEventListener(
      'input',
      () => {
        w.__inputs.push(performance.now() - (w.__ovTrace?.t0 ?? 0))
        if (w.__inputs.length !== 2) return
        requestAnimationFrame(() => {
          for (const sel of watch) {
            const el = document.querySelector(sel)
            w.__first[sel] = el
              ? el
                  .getAnimations()
                  .filter((a): a is CSSTransition => a instanceof CSSTransition && a.playState !== 'finished')
                  .map((a) => a.transitionProperty)
              : null
          }
        })
      },
      true,
    )
  }, watch)
}

const inputTimes = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as unknown as { __inputs: number[] }).__inputs)

/** 反悔之後第一幀，各元素身上正在跑的 CSS 過渡屬性（找不到元素為 null）。 */
const firstFrame = (page: Page): Promise<Record<string, string[] | null>> =>
  page.evaluate(() => (window as unknown as { __first: Record<string, string[] | null> }).__first)

/** 反悔那一刻（輸入事件之前的最後一幀）的值。 */
function valueAt<P extends { t: number }>(pts: P[], at: number, pick: (p: P) => number): number {
  const before = pts.filter((p) => p.t < at)
  expect(before.length, '反悔前有樣本').toBeGreaterThan(0)
  return pick(before[before.length - 1]!)
}

/**
 * 反悔之後的第一幀，還停在起點的元素：身上沒有往回的 CSS 過渡（prop）在跑（找不到元素也算）。
 * 修正前寫好起點後等 Vue 兩幀後換 enter-to 才放開，第一幀時還停在 inline 的起點、沒有過渡。
 * 用「過渡是否已建立」判斷、不數逐幀高度：Chromium 新建的過渡要等下一幀才定開始時間（含合成器回報），
 * 第一、二幀本來就可能還在起點，而且差一幀上下浮動（實測：修正前第 3–4 幀才動、修正後第 2–3 幀，和一次全新的篩選同樣快）。
 */
function stalled(first: Record<string, string[] | null>, prop: string): string[] {
  return Object.entries(first)
    .filter(([, props]) => !props?.includes(prop))
    .map(([sel]) => sel)
}

test.describe('卡片：離場到一半又被加回來', () => {
  test('打 p 80ms 內刪掉：淡出到一半的卡從當下的透明度與大小接續淡入，不先消失再從頭淡入（R3）', async ({ page }) => {
    await gotoOverview(page)
    const search = page.getByTestId('overview-search')
    await search.focus()
    await watchInputs(page, ['portal', 'payment'].map((id) => CARDS[id]!))
    // p 篩掉客戶入口（m8 第一格）與金流介接（m5 第二格）；Backspace 時兩張都還在淡出
    const tr = await trace(page, CARDS, async () => {
      await page.keyboard.type('p')
      await pause(page, 80)
      await page.keyboard.press('Backspace')
    })
    const back = (await inputTimes(page))[1]!
    for (const id of ['portal', 'payment']) {
      const pts = card(tr, id)
      const o0 = valueAt(pts, back, (p) => p.o)
      const w0 = valueAt(pts, back, (p) => p.w)
      expect(o0, `${id} 反悔時正在淡出（有鑑別力）`).toBeLessThan(0.97)
      expect(o0, `${id} 反悔時還看得到（有鑑別力）`).toBeGreaterThan(0.2)
      const after = pts.filter((p) => p.t >= back)
      // 修正前：舊卡直接移除、新卡從透明度 0、縮到 0.96 重新淡入（0.58 → 0、寬一幀少 7.8px）
      expect(Math.min(...after.map((p) => p.o)), `${id} 反悔後透明度掉回 0`).toBeGreaterThan(o0 - 0.05)
      expect(Math.min(...after.map((p) => p.w)), `${id} 反悔後一下縮回進場的大小`).toBeGreaterThan(w0 - 1)
      expect(opacityJumps(pts), `${id} 透明度跳`).toBe(false)
      // 位置沒變：中心逐幀不動（縮放以中心為基準，容 1px）
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i]!.cx - pts[i - 1]!.cx, pts[i]!.cy - pts[i - 1]!.cy)
        expect(d, `${id} 中心單幀位移`).toBeLessThanOrEqual(1)
      }
      expect(after.at(-1)!.o, `${id} 最後完全顯示`).toBe(1)
    }
    const first = await firstFrame(page)
    expect(Object.keys(first), '反悔後第一幀量到兩張卡').toHaveLength(2)
    expect(stalled(first, 'opacity'), '反悔後第一幀還停在起點（往回的過渡還沒開始）').toEqual([])
  })

  test('移動途中被篩掉又回來：從釘住的位置接續滑回自己的格子，不瞬移、不重新淡入', async ({ page }) => {
    await gotoOverview(page)
    const search = page.getByTestId('overview-search')
    await search.fill('p')
    await idle(page)
    // 清除：客戶入口回到 m8 第一格，行動 App 從第一格往第二格滑；100ms 後搜「客戶」把滑到一半的行動 App 篩掉（釘在半路淡出），
    // 80ms 後再清除：行動 App 回到第二格
    await watchInputs(page)
    const tr = await trace(page, CARDS, async () => {
      await search.fill('')
      await pause(page, 100)
      await search.fill('客戶')
      await pause(page, 80)
      await search.fill('')
    })
    const [, cut, back] = await inputTimes(page)
    const app = card(tr, 'app')
    const slot2 = app.at(-1)!.cx
    const slot1 = app[0]!.cx
    const pinned = valueAt(app, back!, (p) => p.cx)
    expect(Math.abs(pinned - slot1), '篩掉時已離開第一格（有鑑別力）').toBeGreaterThan(30)
    expect(Math.abs(slot2 - pinned), '篩掉時還沒到第二格（有鑑別力）').toBeGreaterThan(30)
    const o0 = valueAt(app, back!, (p) => p.o)
    expect(o0, '反悔時正在淡出（有鑑別力）').toBeLessThan(0.97)
    expect(app.filter((p) => p.t >= cut! + 20 && p.t < back!).length, '有釘住淡出的幀').toBeGreaterThan(0)
    // 修正前：回來的卡出現在第二格、透明度 0，一幀跳約 100px
    expect(speedJumps(app.map((p) => ({ t: p.t, v: p.cx }))), '水平瞬移').toBe(0)
    const after = app.filter((p) => p.t >= back!)
    for (let i = 1; i < after.length; i++) {
      expect(Math.abs(after[i]!.cx - after[i - 1]!.cx), '回來後單幀水平位移').toBeLessThan(0.3 * Math.abs(slot2 - pinned))
    }
    expect(Math.min(...after.map((p) => p.o)), '反悔後透明度掉回 0').toBeGreaterThan(o0 - 0.05)
    expect(Math.min(...after.map((p) => p.w)), '反悔後一下縮回進場的大小').toBeGreaterThan(valueAt(app, back!, (p) => p.w) - 1)
    expect(opacityJumps(app), '透明度跳').toBe(false)
    expect(after.at(-1)!.o, '最後完全顯示').toBe(1)
  })
})

test.describe('原地收合：反悔後立刻往回長（不停頓）', () => {
  /** 打 p、80ms 後 Backspace 的逐幀量測，連同 Backspace 的時間點；watch 的元素記反悔後第一幀的過渡。 */
  async function typeThenBack(page: Page, targets: Record<string, string>): Promise<{ tr: Trace; back: number }> {
    await page.getByTestId('overview-search').focus()
    await watchInputs(page, Object.values(targets))
    const tr = await trace(page, targets, async () => {
      await page.keyboard.type('p')
      await pause(page, 80)
      await page.keyboard.press('Backspace')
    })
    return { tr, back: (await inputTimes(page))[1]! }
  }

  /** 每個項目：反悔時正在收（有鑑別力），反悔後一路往回長、不再往下掉（不從 0 重長）。 */
  function expectGrowsBack(tr: Trace, back: number, names: string[]): void {
    for (const name of names) {
      const pts = series(tr, name).map((b) => ({ t: b.t, v: b.h }))
      const h0 = valueAt(pts, back, (p) => p.v)
      expect(h0, `${name} 反悔時正在收起（有鑑別力）`).toBeLessThan(pts[0]!.v - 1)
      const after = pts.filter((p) => p.t >= back)
      expect(Math.min(...after.map((p) => p.v)), `${name} 反悔後又往下掉`).toBeGreaterThan(h0 - 0.5)
      expect(after.at(-1)!.v, `${name} 最後長回原高`).toBeCloseTo(pts[0]!.v, 0)
    }
  }

  test('泳道：打 p 80ms 內刪掉，收到一半的泳道反悔後第一幀就開始往回長', async ({ page }) => {
    await gotoOverview(page)
    // p 只留 m5、m8：m9、m10 整條收起又回來
    const { tr, back } = await typeThenBack(page, { m9: `${P} [data-lane-wrap="m9"]`, m10: `${P} [data-lane-wrap="m10"]` })
    expectGrowsBack(tr, back, ['m9', 'm10'])
    const first = await firstFrame(page)
    expect(Object.keys(first), '反悔後第一幀量到兩條泳道').toHaveLength(2)
    expect(stalled(first, 'grid-template-rows'), '反悔後第一幀還停在起點（往回的過渡還沒開始）').toEqual([])
  })

  test('時間軸：打 p 80ms 內刪掉，收到一半的群組與列反悔後第一幀就開始往回長', async ({ page }) => {
    await gotoOverview(page, '#timeline')
    // m9、m10 整組收起；客戶入口（m8）、金流介接（m5）兩列收起
    const { tr, back } = await typeThenBack(page, {
      'g:m9': `${T} [data-g-wrap="m9"]`,
      'g:m10': `${T} [data-g-wrap="m10"]`,
      'r:portal': `${T} [data-row-wrap="portal"]`,
      'r:payment': `${T} [data-row-wrap="payment"]`,
    })
    expectGrowsBack(tr, back, ['g:m9', 'g:m10', 'r:portal', 'r:payment'])
    const first = await firstFrame(page)
    expect(Object.keys(first), '反悔後第一幀量到兩個群組、兩列').toHaveLength(4)
    expect(stalled(first, 'grid-template-rows'), '反悔後第一幀還停在起點（往回的過渡還沒開始）').toEqual([])
  })
})

test.describe('原地收合：進場中被換順序（keyed diff 搬動 DOM 取消進行中的過渡）', () => {
  const PMS = ['m5', 'm8', 'm9', 'm10']

  /**
   * 每個外層：單幀透明度跳 > 0.35、單幀高度變化 > 全距 35%（dt < 34 的幀才算，同 opacityJumps；全距 < 4px 視為沒動）都不行
   * （一幀變實心 / 一幀長完）。
   * --ease 最陡一幀約走全距一成多、前一幀卡住時約兩成；被搬動一幀到位實測走五到六成。
   * 不用 speedJumps：更新那一幀常是長幀、後面接一個只有幾 ms 的短幀，正常的一步也會被算成速度突變（實測 8.6px / 6ms）。
   */
  function expectNoSnap(tr: Trace, names: string[]): void {
    for (const name of names) {
      const s = series(tr, name)
      expect(opacityJumps(s), `${name} 透明度一幀跳`).toBe(false)
      const hs = s.map((b) => b.h)
      const range = Math.max(...hs) - Math.min(...hs)
      if (range < 4) continue
      const snaps = s.filter((b, i) => i > 0 && b.dt < 34 && Math.abs(b.h - s[i - 1]!.h) > 0.35 * range)
      expect(snaps, `${name} 高度一幀長完`).toHaveLength(0)
    }
  }

  test('卡片：搜尋 pmis 每 90ms 刪一字，刪到空字串時泳道換順序，進場中的泳道不一幀長完、不一幀變實心（C2 I2）', async ({ page }) => {
    await gotoOverview(page)
    const search = page.getByTestId('overview-search')
    await search.fill('pmis')
    await idle(page)
    await search.focus()
    const tr = await trace(
      page,
      Object.fromEntries(PMS.map((pm) => [pm, `${P} .board > [data-lane-wrap="${pm}"]`])),
      async () => {
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press('Backspace')
          await pause(page, 90)
        }
      },
      { ms: 900 },
    )
    await expect(search).toHaveValue('')
    // 有鑑別力：m8 在「p」時進場，刪到空字串（90ms 後）時還在長
    const m8 = series(tr, 'm8')
    expect(m8.some((b) => b.o > 0.05 && b.o < 0.95), 'm8 有進場過程').toBe(true)
    expectNoSnap(tr, PMS)
  })

  test('時間軸：「pm」→「p」→ 空字串（間隔 60ms），刪到空字串時群組換順序，進場中的群組不一幀長完、不一幀變實心（T5 e）', async ({ page }) => {
    await gotoOverview(page, '#timeline')
    const search = page.getByTestId('overview-search')
    await search.fill('pm')
    await idle(page)
    await search.focus()
    const tr = await trace(
      page,
      Object.fromEntries(PMS.map((pm) => [pm, `${T} .tl-groups > [data-g-wrap="${pm}"]`])),
      async () => {
        // 間隔要短：m8 長得越多，被搬動時一幀跳的量越小（長到七成後只跳三成，量不出來）
        await page.keyboard.press('Backspace')
        await pause(page, 60)
        await page.keyboard.press('Backspace')
      },
      { ms: 900 },
    )
    await expect(search).toHaveValue('')
    const m8 = series(tr, 'm8')
    expect(m8.some((b) => b.o > 0.05 && b.o < 0.95), 'm8 有進場過程').toBe(true)
    expectNoSnap(tr, PMS)
  })
})
