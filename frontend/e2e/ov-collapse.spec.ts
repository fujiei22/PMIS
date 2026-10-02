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
  type Frame,
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

/** 看得到：有高度、沒有淡到幾乎透明。 */
const shown = (b: Box | null | undefined): b is Box => !!b && b.h > 0.5 && b.o > 0.05

/** 某一幀看得到的項目（照 names 順序）；預設最後一幀。用來確認情境真的有項目進出（有鑑別力）。 */
function shownIn(tr: Trace, names: string[], frame = tr.frames.length - 1): string[] {
  const f = tr.frames[frame]
  return names.filter((n) => shown(f?.boxes[n]))
}

/** 某一幀看得到的泳道（照 PMS 順序）；預設最後一幀。 */
const lanesIn = (tr: Trace, frame = tr.frames.length - 1): string[] => shownIn(tr, PMS, frame)

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

/** 容器底邊現在（靜止時）的位置；預設卡片檢視的面板。 */
const bottomOf = (page: Page, selector = P): Promise<number> =>
  page.locator(selector).evaluate((el) => el.getBoundingClientRect().bottom)

/** 反悔情境：篩選前、篩完（靜止）時的容器底邊。 */
interface Reversal {
  full: number
  filtered: number
}

/**
 * 容器（面板、時間軸本體）的底邊：一路連續變化、不一幀到位、結尾不跳。
 * @param label 斷言訊息的開頭，例「面板底邊」
 * @param reversal 收到一半就反悔（打了又刪、勾了又取消）時給：
 *   - 全距只有半途那一段，收合最陡那一幀本來就走全距四五成（實測 44.8 / 86.7px），jumpCount 的全距比例會誤判，
 *     改看速度突變（speedJumps：同一幀速度大於前後兩幀各 2.5 倍，長幀也照算）。
 *   - 同 key 回來若從 0 重長，面板底邊會先一路掉到「篩完」的靜止高度再長回（那一幀常是長幀、又正好在收合最快的時候，
 *     速度判斷不一定抓得到，實測 2.38 倍）；從當下高度接續的話只掉到反悔那一刻收到的地方。所以另外量掉了多深。
 * @returns 反悔情境掉了多深（0 = 沒掉、1 = 掉到篩完的高度）；沒給 reversal 回 undefined
 */
function expectEdgeContinuous(tr: Trace, name: string, label: string, reversal?: Reversal): number | undefined {
  const pts = bottoms(tr, name)
  const vs = pts.map((p) => p.v)
  if (!reversal) expect(jumpCount(pts), `${label}單幀跳`).toBe(0)
  expect(speedJumps(pts), `${label}速度突變`).toBe(0)
  expect(endSnap(vs), `${label}結尾跳`).toBe(false)
  if (Math.max(...vs) - Math.min(...vs) > 20) expect(midFrames(vs), `${label}一路連續變化，不是一幀到位`).toBeGreaterThanOrEqual(3)
  if (!reversal) return undefined
  const dip = (reversal.full - Math.min(...vs)) / (reversal.full - reversal.filtered)
  expect(dip, '有在收合途中反悔（有鑑別力）').toBeGreaterThan(0.05)
  expect(dip, `反悔時${label}先掉到篩完的高度（同 key 回來從 0 重長）`).toBeLessThan(0.9)
  return dip
}

/**
 * 反悔情境：每個收到一半又回來的項目（自己的高度有變矮的）只掉到反悔那一刻收到的地方，不從 0 重長。
 * 同一次更新一起開始收、時長曲線相同，各自掉的比例和容器底邊差不多（容 0.1）；從 0 重長的掉到 1。
 * 只看容器底邊不夠：時間軸的群組接續、列從 0 重長時，列只佔一小段，底邊掉的比例幾乎不變（實測）。
 * @param edgeDip 容器底邊掉的比例（expectEdgeContinuous 的回傳值）
 */
function expectNoRegrow(tr: Trace, names: string[], edgeDip: number): void {
  for (const name of names) {
    const hs = series(tr, name).map((b) => b.h)
    const h0 = hs[0]
    if (!h0 || Math.min(...hs) > h0 - 1) continue
    expect((h0 - Math.min(...hs)) / h0, `${name} 回來時從 0 重長`).toBeLessThanOrEqual(edgeDip + 0.1)
  }
}

/** 每個項目外層的上緣：不瞬移、速度不突變、結尾不跳（反悔情境不看 jumpCount，理由同 expectEdgeContinuous）。 */
function expectItemsSmooth(tr: Trace, names: string[], reversal: boolean): void {
  for (const name of names) {
    const ys = series(tr, name).map((b) => ({ t: b.t, dt: b.dt, v: b.y }))
    if (!reversal) expect(jumpCount(ys), `${name} 單幀瞬移`).toBe(0)
    expect(speedJumps(ys), `${name} 速度突變`).toBe(0)
    expect(endSnap(ys.map((p) => p.v)), `${name} 結尾跳`).toBe(false)
  }
}

/**
 * 某一幀看得見的項目（由上往下）互不重疊（容 2px），回傳這些項目。
 * 兩個都留下的項目在重排時交錯而過是 move 的本意（例：打 p 時 m5 / m8 換順序），不算；
 * 有一個正在收起 / 長出（淡入淡出中）就不能和別的疊在一起（修正前離場的項目釘在原位，下面的滑上來疊住它）。
 */
function expectStacked(f: Frame, names: string[], label: string): Box[] {
  const vis = names
    .map((n) => f.boxes[n])
    .filter(shown)
    .sort((a, b) => a.y - b.y)
  vis.forEach((b, k) => {
    const a = vis[k - 1]
    if (a && (a.o < 0.99 || b.o < 0.99)) expect(b.y, label).toBeGreaterThanOrEqual(a.y + a.h - 2)
  })
  return vis
}

/** @param reversal 見 expectEdgeContinuous */
function expectLanesContinuous(tr: Trace, reversal?: Reversal): void {
  expectEdgeContinuous(tr, 'panel', '面板底邊', reversal)
  expectItemsSmooth(tr, PMS, !!reversal)
  // 每一幀：看得見的泳道互不重疊、不畫到面板外（容 2px）
  for (const f of tr.frames) {
    const vis = expectStacked(f, PMS, '泳道重疊')
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
  const full = await bottomOf(page)
  await search.fill('p')
  await idle(page)
  const filtered = await bottomOf(page)
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
  const full = await bottomOf(page)
  await opt.click()
  await idle(page)
  const filtered = await bottomOf(page)
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

/**
 * 留下的項目外層的上緣在起點與終點之間（各容 2px），回傳超出最多的 px（0 = 沒超出）。
 * 換順序的項目若先往反方向鼓出再回來（內建 move 當幀起跑、離場項目的收合 / 進場項目的長出晚約 3 幀才開始：
 * move 的終點是「離場的還沒收、進場的還沒長」時的位置，之後收合 / 長出又把版面拉回），
 * 起終點一樣時 reverses 看不出來（方向是 0），所以直接看有沒有走出起終點之間。
 */
function bulge(tr: Trace, name: string): number {
  const ys = series(tr, name).map((b) => b.y)
  const lo = Math.min(ys[0]!, ys[ys.length - 1]!) - 2
  const hi = Math.max(ys[0]!, ys[ys.length - 1]!) + 2
  return Math.max(0, ...ys.map((y) => Math.max(lo - y, y - hi)))
}

test('打 p 再清空：換順序的泳道路徑單調，離場收合、進場長出時都不先往反方向鼓出再回來（N2）', async ({ page }) => {
  await gotoOverview(page)
  const search = page.getByTestId('overview-search')
  const out = await traceLanes(page, () => search.fill('p'))
  expect([lanesIn(out, 0), lanesIn(out)], '四條泳道收到只剩 m5、m8').toEqual([PMS, ['m5', 'm8']])
  await idle(page)
  const back = await traceLanes(page, () => search.fill(''))
  expect(lanesIn(back), '清空後四條泳道都在').toEqual(PMS)
  for (const [label, tr] of [['打 p', out], ['清空', back]] as const) {
    for (const pm of ['m5', 'm8']) {
      expect(bulge(tr, pm), `${label}：${pm} 走出起點與終點之間（px）`).toBe(0)
      expect(reverses(series(tr, pm).map((b) => b.y)), `${label}：${pm} 折返`).toBe(false)
    }
  }
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

test.describe('時間軸：群組與列原地收合（T2 / T3）', () => {
  const T = '[data-view-panel="timeline"]'
  const BODY = `${T} .tl-body`
  /** samplePortfolio 的專案 → PM（時間軸一個專案一列，依 PM 分組；組內與組間的順序照排序，不固定）。 */
  const PM_OF: Record<string, string> = {
    pmis: 'm5',
    payment: 'm5',
    portal: 'm8',
    app: 'm8',
    dw: 'm9',
    vendor: 'm9',
    wiki: 'm10',
  }
  const PROJECTS = Object.keys(PM_OF)
  const G = PMS.map((pm) => `g:${pm}`)
  const R = PROJECTS.map((id) => `r:${id}`)

  /**
   * 群組 / 列的外層（.tl-groups / .g-list 的直接子元素），用 PM / 專案 id 對應（進場的開始時還不在畫面上，也要量）。
   * 原地收合前外層就是群組本體 .g（認它的標頭列 data-pm-group）與列本體 .p-block（data-project）；
   * 之後是 .g-wrap（data-g-wrap）與 .r-wrap（data-row-wrap）。兩種都認，修正前後量的是同一個東西。
   */
  const groupOf = (pm: string): string => `${T} .tl-groups > :is(:has(> [data-pm-group="${pm}"]), [data-g-wrap="${pm}"])`
  const rowOf = (id: string): string => `${T} .g-list > :is([data-project="${id}"], [data-row-wrap="${id}"])`

  /** 面板、本體（.tl-body）、每個群組與每一列外層的逐幀量測。 */
  function traceTimeline(page: Page, action: () => Promise<unknown>): Promise<Trace> {
    return trace(page, {
      panel: T,
      body: BODY,
      ...Object.fromEntries(PMS.map((pm) => [`g:${pm}`, groupOf(pm)])),
      ...Object.fromEntries(PROJECTS.map((id) => [`r:${id}`, rowOf(id)])),
    }, action)
  }

  /** 面板與本體的底邊。 */
  interface Edges {
    panel: number
    body: number
  }

  /** 現在（靜止時）的面板與本體底邊：反悔情境篩選前、篩完時的基準。 */
  async function edges(page: Page): Promise<Edges> {
    return { panel: await bottomOf(page, T), body: await bottomOf(page, BODY) }
  }

  /**
   * 面板與本體的底邊、每個群組與列：一路連續、不瞬移、結尾不跳。每一幀：
   * - 看得見的群組互不重疊、不畫到本體底邊外（本體 overflow 裁切，畫到外面＝被瞬間裁掉；修正前離場群組 absolute，本體當幀就縮）；
   * - 同一組裡的列（含收起 / 長出中的）上下緊接、不重疊也不留縫（容 2px）：這些情境只篩選、組內不換順序，列的位置只跟著
   *   上面的列收合長出。修正前離場列釘在原位，同組的列滑上來疊住它；同 key 回來的列若在 useRelativeFlip 量完位置之後
   *   才寫上起點高度，下面的列多出一段位移、和上面的列離開一條縫（約一列收剩的高度）。
   * - 留下的列（開始與結束都在）在所屬群組完整顯示時不畫到本體底邊外（修正前群組被 move 從舊位置帶上來時被本體裁掉）。
   *   群組正在收起 / 長出時，裡面的列本來就被群組的裁切層切掉，不看。
   */
  function expectTimelineContinuous(tr: Trace, reversal?: { from: Edges; to: Edges }): void {
    const dip = expectEdgeContinuous(tr, 'panel', '面板底邊', reversal && { full: reversal.from.panel, filtered: reversal.to.panel })
    expectEdgeContinuous(tr, 'body', '本體底邊', reversal && { full: reversal.from.body, filtered: reversal.to.body })
    if (dip !== undefined) expectNoRegrow(tr, [...G, ...R], dip)
    expectItemsSmooth(tr, [...G, ...R], !!reversal)
    const staying = PROJECTS.filter((id) => shownIn(tr, [`r:${id}`], 0).length && shownIn(tr, [`r:${id}`]).length)
    for (const f of tr.frames) {
      const body = f.boxes.body
      const groups = expectStacked(f, G, '群組重疊')
      if (body) groups.forEach((b) => expect(b.y + b.h, '群組被本體裁掉').toBeLessThanOrEqual(body.y + body.h + 2))
      for (const pm of PMS) {
        const rows = PROJECTS.filter((id) => PM_OF[id] === pm)
          .map((id) => f.boxes[`r:${id}`])
          .filter((b): b is Box => !!b)
          .sort((a, b) => a.y - b.y)
        rows.forEach((b, k) => {
          const a = rows[k - 1]
          if (a) expect(Math.abs(b.y - (a.y + a.h)), `${pm} 組內的列沒有上下緊接`).toBeLessThanOrEqual(2)
        })
      }
      if (!body) continue
      for (const id of staying) {
        const r = f.boxes[`r:${id}`]
        const g = f.boxes[`g:${PM_OF[id]}`]
        if (shown(r) && g && g.o >= 0.99) expect(r.y + r.h, `${id} 列被本體裁掉`).toBeLessThanOrEqual(body.y + body.h + 2)
      }
    }
  }

  test('勾「已完成」：群組與列原地收合，本體底邊平順、留下的列不被瞬間裁掉、互不重疊（T2）', async ({ page }) => {
    await gotoOverview(page, '#timeline')
    // 列的裁切層：平常不裁（hover / 選取時 bar 的光暈不在列的上下緣被切平，A25），收起時要裁（內容不畫到下一列上）
    const clipOf = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).overflowY)
    expect(await clipOf(`${T} .g-list > * > *`), '平常列不裁切').toBe('visible')
    await page.locator('[data-ov-dd="status"] button.dd-trigger').click()
    await idle(page)
    const leavingClip = page.waitForFunction(() => {
      const el = document.querySelector('[data-view-panel="timeline"] .g-list > .ov-row-leave-active > *')
      return el ? getComputedStyle(el).overflowY : false
    })
    const tr = await traceTimeline(page, () =>
      page.locator('[data-ov-dd="status"]').getByRole('button', { name: '已完成', exact: true }).click(),
    )
    expect(await (await leavingClip).jsonValue(), '收起中的列要裁切').toBe('clip')
    expect([shownIn(tr, G, 0), shownIn(tr, G)], '四個群組收到只剩 m9').toEqual([G, ['g:m9']])
    expect([shownIn(tr, R, 0), shownIn(tr, R)], '七列收到只剩報表資料倉儲（同組的供應商入口也收起）').toEqual([R, ['r:dw']])
    expectTimelineContinuous(tr)
  })

  /** 搜尋 q、100ms 內清空的逐幀量測，連同篩選前、篩完時的底邊（反悔情境的基準）。 */
  async function searchThenClear(page: Page, q: string) {
    await gotoOverview(page, '#timeline')
    const search = page.getByTestId('overview-search')
    const from = await edges(page)
    await search.fill(q)
    await idle(page)
    const to = await edges(page)
    await search.fill('')
    await idle(page)
    const tr = await traceTimeline(page, async () => {
      await search.fill(q)
      await pause(page, 100)
      await search.fill('')
    })
    return { tr, reversal: { from, to } }
  }

  test('搜尋 p、100ms 內清空：離場中又回來的群組與列從當下高度接續、不瞬移（T3）', async ({ page }) => {
    // p 只留 PMIS（m5）與行動 App（m8）：m9 / m10 整組、金流介接與客戶入口兩列收到一半又回來，m5 / m8 換順序又換回來
    const { tr, reversal } = await searchThenClear(page, 'p')
    expect(shownIn(tr, R), '清空後七列都在').toEqual(R)
    expectTimelineContinuous(tr, reversal)
  })

  test('搜尋「行動」、100ms 內清空：同組裡回來的列上面那列，下面的列不被一幀推下去（T3）', async ({ page }) => {
    // 「行動」只留 m8 的行動 App：同組在它上面的客戶入口收到一半又回來。行動 App 的位置變了，useRelativeFlip 會量它；
    // 回來那列的起點高度若在量完之後才寫上，行動 App 就被一幀推下去（約一列收剩的高度）再滑回來
    const { tr, reversal } = await searchThenClear(page, '行動')
    expect(shownIn(tr, R), '清空後七列都在').toEqual(R)
    const first = tr.frames[0]!.boxes
    expect(first['r:portal']!.y, '客戶入口在行動 App 上面（有鑑別力）').toBeLessThan(first['r:app']!.y)
    expectTimelineContinuous(tr, reversal)
  })

  test('搜尋 p 再清空：換順序的群組與留下的列路徑單調，離場收合、進場長出時都不先往反方向鼓出再回來（N2）', async ({ page }) => {
    await gotoOverview(page, '#timeline')
    const search = page.getByTestId('overview-search')
    const out = await traceTimeline(page, () => search.fill('p'))
    expect([shownIn(out, G, 0), shownIn(out, G)], '四個群組收到只剩 m5、m8').toEqual([G, ['g:m5', 'g:m8']])
    await idle(page)
    const back = await traceTimeline(page, () => search.fill(''))
    expect(shownIn(back, R), '清空後七列都在').toEqual(R)
    for (const [label, tr] of [['搜尋 p', out], ['清空', back]] as const) {
      for (const name of ['g:m5', 'g:m8', 'r:pmis', 'r:app']) {
        expect(bulge(tr, name), `${label}：${name} 走出起點與終點之間（px）`).toBe(0)
        expect(reverses(series(tr, name).map((b) => b.y)), `${label}：${name} 折返`).toBe(false)
      }
    }
  })

  test('搜尋 pmis：多個群組同時離場各自原地收合、不重疊、面板結尾不跳；清除後原地長出', async ({ page }) => {
    await gotoOverview(page, '#timeline')
    const out = await traceTimeline(page, () => page.getByTestId('overview-search').fill('pmis'))
    expect([shownIn(out, G, 0), shownIn(out, G)], '三個群組同時離場').toEqual([G, ['g:m5']])
    expect(shownIn(out, R), '同組的金流介接也收起').toEqual(['r:pmis'])
    expectTimelineContinuous(out)

    await idle(page)
    const back = await traceTimeline(page, () => page.getByTestId('overview-clear').click())
    expect([shownIn(back, G, 0), shownIn(back, G)], '從 m5 一組長回四組').toEqual([['g:m5'], G])
    expect(shownIn(back, R), '七列都回來').toEqual(R)
    expectTimelineContinuous(back)
  })

  /*
   * 群組重排用 TransitionGroup 內建的 move（ov-group-move）。群組外層平常沒宣告 transition 的話，第二次重排時 Vue 拿掉 move class
   * 停不住進行中的位移，量到含殘留位移的位置，群組先跳到上一段的終點再折返（overview-motion.css 的 :where 規則）。
   * 搜尋反悔的情境同時有收合在推動群組，跳的那一段混在位移裡分不出來，所以另外用只有重排的情境：排序方向按兩次。
   * 第二下用頁面裡的 setTimeout 準時按，Playwright 的 click 前後要等好幾十 ms，按到時第一段已經快走完。
   */
  /** 折返點走到上一段的多遠：0 = 沒動、1 = 走到上一段的終點才折返。 */
  function turnDepth(vs: number[], from: number, to: number): number {
    const turn = to > from ? Math.max(...vs) : Math.min(...vs)
    return (turn - from) / (to - from)
  }

  test('排序方向 80ms 內按兩次：群組從看得到的位置折返，不先跳到上一段的終點（T3）', async ({ page }) => {
    await gotoOverview(page, '#timeline')
    const chip = page.locator(`${T} .sort-chip`).first()
    const tops = async (): Promise<Record<string, number>> =>
      Object.fromEntries(
        await Promise.all(
          PMS.map(async (pm) => [pm, await page.locator(groupOf(pm)).evaluate((el) => el.getBoundingClientRect().top)]),
        ),
      )
    const start = await tops()
    await chip.click()
    await idle(page)
    const target = await tops()
    await chip.click()
    await idle(page)
    const tr = await trace(page, Object.fromEntries(PMS.map((pm) => [`g:${pm}`, groupOf(pm)])), () =>
      chip.evaluate((el: HTMLElement) => {
        el.click()
        setTimeout(() => el.click(), 80)
      }),
    )
    const moving = PMS.filter((pm) => Math.abs(target[pm]! - start[pm]!) > 20)
    expect(moving.length, '有群組換位置（有鑑別力）').toBeGreaterThanOrEqual(2)
    for (const pm of moving) {
      const ys = series(tr, `g:${pm}`).map((b) => ({ t: b.t, dt: b.dt, v: b.y }))
      const vs = ys.map((p) => p.v)
      const depth = turnDepth(vs, start[pm]!, target[pm]!)
      expect(depth, `${pm} 有在半路折返（有鑑別力）`).toBeGreaterThan(0.05)
      expect(depth, `${pm} 折返前先跳到上一段的終點`).toBeLessThan(0.9)
      expect(speedJumps(ys), `${pm} 速度突變`).toBe(0)
      expect(endSnap(vs), `${pm} 結尾跳`).toBe(false)
      expect(Math.abs(vs[vs.length - 1]! - start[pm]!), `${pm} 回到原位`).toBeLessThan(1)
    }
  })
})

test.describe('離場中的項目不能互動（a11y）', () => {
  const T = '[data-view-panel="timeline"]'

  /**
   * 焦點放在 focus 上，不移動焦點地改搜尋字（直接送 input 事件，fill 會把焦點移到搜尋框），下一幀回報離場中的外層 wrap：
   * 有沒有 inert、焦點還在不在裡面。收起途中的項目仍在版面流裡、看得到，但不能再 Tab 進去、點到或被讀屏讀成兩份。
   */
  async function filterWithFocusInside(page: Page, focus: string, wrap: string, q: string) {
    await page.locator(focus).focus()
    return page.evaluate(
      async ({ wrap, q }) => {
        const w = document.querySelector<HTMLElement>(wrap)!
        const before = w.contains(document.activeElement)
        const input = document.querySelector('[data-testid="overview-search"]') as HTMLInputElement
        input.value = q
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((resolve) => requestAnimationFrame(resolve))
        return {
          before,
          leaving: w.isConnected && Array.from(w.classList).some((k) => k.endsWith('-leave-active')),
          inert: w.inert,
          focusInside: w.contains(document.activeElement),
        }
      },
      { wrap, q },
    )
  }

  const cases = [
    { name: '卡片檢視的泳道（m10）', hash: '', focus: `${P} [data-project="wiki"] .card-main`, wrap: `${P} [data-lane-wrap="m10"]` },
    { name: '時間軸群組（m10）', hash: '#timeline', focus: `${T} [data-pm-group="m10"]`, wrap: `${T} [data-g-wrap="m10"]` },
    { name: '時間軸的列（金流介接，群組留下）', hash: '#timeline', focus: `${T} [data-project="payment"] .p-row`, wrap: `${T} [data-row-wrap="payment"]` },
  ]
  for (const c of cases) {
    test(`搜尋 pmis 時焦點在離場的${c.name}裡：離場中加上 inert、焦點移開`, async ({ page }) => {
      await gotoOverview(page, c.hash)
      const r = await filterWithFocusInside(page, c.focus, c.wrap, 'pmis')
      expect(r.before, '焦點先在裡面（有鑑別力）').toBe(true)
      expect(r.leaving, '確實在離場中（有鑑別力）').toBe(true)
      expect(r.inert, '離場中沒有 inert').toBe(true)
      expect(r.focusInside, '焦點還留在離場的項目裡').toBe(false)
    })
  }
})
