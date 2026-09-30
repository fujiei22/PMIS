import { expect, test, type Page } from '@playwright/test'
import { DashboardPage, html5Drag } from './helpers/dashboardPage'

/**
 * 甘特面板的動畫銜接（動畫稽核批次 A，`docs/incidents/2026-09-30-motion-audit`）。
 *
 * 不只驗「有沒有宣告過渡」，而是逐幀量畫面上的位置 / 透明度：
 * 左欄列與右側條、橫紋是否同步，路徑是否一路朝終點走（不先跳過頭、不停住再瞬移），離場列是否立即讓位。
 *
 * 門檻要耐得住平行跑的負載：不用絕對毫秒，改看「路徑單調」「單幀位移佔總位移的比例（只算間隔正常的幀）」
 * 「同一幀裡左右的落差」「透明度 / 縮放有沒有中間值」。
 */

test.use({ viewport: { width: 1920, height: 1080 } })

/** 一幀裡某個元素的量測；null 代表這一幀它不在畫面上（不存在或 display:none）。 */
interface Box {
  x: number
  y: number
  w: number
  h: number
  /** 自身的 computed opacity。 */
  o: number
  /** computed `scale`（沒設就是 1）。 */
  s: number
  /** SVG 折線才有：第一點與最後一點的畫面座標 [x0, y0, x1, y1]。 */
  pts?: [number, number, number, number]
}

interface Frame {
  /** 從開始記錄算起的毫秒。 */
  t: number
  /** 與上一幀的間隔（ms）。 */
  dt: number
  boxes: Record<string, Box | null>
}

interface Trace {
  frames: Frame[]
  /** 每一次 `markOn` 事件的時間（ms，同 Frame.t 的基準）。 */
  marks: number[]
}

/**
 * 逐幀記錄一組元素，期間執行 action。
 *
 * 量的時機是 ResizeObserver 的回呼：它在所有 rAF 回呼與版面計算之後、paint 之前才跑，
 * 量到的就是這一幀真的會畫出來的位置（在 rAF 裡量，會漏掉排在後面的 rAF 才寫上去的位移）。
 * 每幀重新用選擇器找元素，元素被換掉也追得到。
 *
 * @param targets 名稱 → CSS 選擇器
 * @param markOn 要記時間的事件（捕獲階段，比元件自己的處理早）；分析時用它切「動作前 / 後」
 */
async function trace(
  page: Page,
  targets: Record<string, string>,
  action: () => Promise<void>,
  { ms = 900, markOn = 'click' }: { ms?: number; markOn?: string } = {},
): Promise<Trace> {
  await page.evaluate(
    ({ targets, markOn }) => {
      const t0 = performance.now()
      const frames: Frame[] = []
      const marks: number[] = []
      const state = { frames, marks, stop: false }
      ;(window as unknown as { __trace: typeof state }).__trace = state
      window.addEventListener(markOn, () => marks.push(performance.now() - t0), { capture: true })

      const probe = document.createElement('div')
      probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;visibility:hidden'
      document.body.appendChild(probe)
      let last = t0
      const ro = new ResizeObserver(() => {
        const now = performance.now()
        const boxes: Record<string, Box | null> = {}
        for (const [name, sel] of Object.entries(targets)) {
          const el = document.querySelector(sel)
          const cs = el ? getComputedStyle(el) : null
          if (!el || !cs || cs.display === 'none') {
            boxes[name] = null
            continue
          }
          const r = el.getBoundingClientRect()
          boxes[name] = {
            x: r.left,
            y: r.top,
            w: r.width,
            h: r.height,
            o: parseFloat(cs.opacity),
            s: cs.scale === 'none' ? 1 : parseFloat(cs.scale),
          }
          if (el instanceof SVGPolylineElement && el.points.numberOfItems && el.ownerSVGElement) {
            const o = el.ownerSVGElement.getBoundingClientRect()
            const a = el.points.getItem(0)
            const b = el.points.getItem(el.points.numberOfItems - 1)
            boxes[name]!.pts = [o.left + a.x, o.top + a.y, o.left + b.x, o.top + b.y]
          }
        }
        frames.push({ t: now - t0, dt: now - last, boxes })
        last = now
      })
      ro.observe(probe)
      // 每幀改一次 probe 的寬度，ResizeObserver 才會每幀都回呼
      let flip = false
      const tick = (): void => {
        if (state.stop) {
          ro.disconnect()
          probe.remove()
          return
        }
        flip = !flip
        probe.style.width = flip ? '2px' : '1px'
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    { targets, markOn },
  )
  // 動作前先錄幾幀當起點
  await pause(page, 80)
  await action()
  await pause(page, ms)
  return page.evaluate(() => {
    const s = (window as unknown as { __trace: { frames: Frame[]; marks: number[]; stop: boolean } }).__trace
    s.stop = true
    return { frames: s.frames, marks: s.marks }
  })
}

/**
 * 在頁面裡等 ms：逐幀記錄要錄固定長度，「80ms 內連點」這種情境也要刻意的間隔。
 * 用頁面自己的計時器（同 overview-motion.spec 的做法），不是等畫面穩定。
 */
async function pause(page: Page, ms: number): Promise<void> {
  await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), ms)
}

/** 某個元素從 `from`（ms）之前最後一幀起、之後每一幀的量測（不在畫面上的幀略過）。 */
function seriesOf(tr: Trace, name: string, from: number): (Box & { t: number; dt: number })[] {
  const shown = tr.frames.filter((f) => f.boxes[name])
  const before = shown.filter((f) => f.t < from).at(-1)
  return (before ? [before] : [])
    .concat(shown.filter((f) => f.t >= from))
    .map((f) => ({ ...f.boxes[name]!, t: f.t, dt: f.dt }))
}

/**
 * 瞬移的門檻：間隔正常（< 25ms）的一幀裡走了總位移的幾成。
 * `--ease` 最陡處一幀（16ms）約走兩成；前一幀卡住（重排整頁）時補間最多推進兩幀的時間，約四成。
 * 瞬移是整段一次到位（稽核量到的是 68%~100%）。
 */
const JUMP_RATIO = 0.5

/**
 * 路徑檢查（y 軸）：
 * - monotonic：每一幀離終點的距離都不比上一幀大（容 1.5px 取樣誤差）——不先跳過頭、不回彈、不停住後反向；
 * - jumps：間隔正常（< 25ms）的幀裡，單幀位移超過總位移 JUMP_RATIO 的次數（間隔長的幀是掉幀，不算）。
 */
function pathReport(tr: Trace, name: string, from: number): { moved: number; monotonic: boolean; jumps: number } {
  const s = seriesOf(tr, name, from)
  if (s.length < 2) return { moved: 0, monotonic: true, jumps: 0 }
  const end = s.at(-1)!.y
  const moved = Math.abs(end - s[0]!.y)
  let monotonic = true
  let jumps = 0
  for (let i = 1; i < s.length; i++) {
    if (Math.abs(s[i]!.y - end) > Math.abs(s[i - 1]!.y - end) + 1.5) monotonic = false
    if (moved > 4 && Math.abs(s[i]!.y - s[i - 1]!.y) > JUMP_RATIO * moved && s[i]!.dt < 25) jumps++
  }
  return { moved, monotonic, jumps }
}

/** 同一幀裡 b 的 y 與 a 的 y + offset 的最大落差（兩個都在畫面上的幀才算）。 */
function maxSkew(tr: Trace, a: string, b: string, offset: number, from: number): number {
  let max = 0
  for (const f of tr.frames) {
    if (f.t < from) continue
    const pa = f.boxes[a]
    const pb = f.boxes[b]
    if (!pa || !pb) continue
    max = Math.max(max, Math.abs(pb.y - (pa.y + offset)))
  }
  return +max.toFixed(1)
}

/**
 * 在橫紋上打測試用的標記（`data-probe-stripe="<列 key>"`）：橫紋沒有自己的 data 屬性，
 * 靜止時它的 DOM 順序就是列的順序，照左欄的順序對上去。Vue 以 key 重用元素，標記在動畫期間跟著元素走。
 */
async function tagStripes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-rowtask],[data-rowgroup]')].map((el) =>
      el.hasAttribute('data-rowtask') ? `t-${el.getAttribute('data-rowtask')}` : `g-${el.getAttribute('data-rowgroup')}`,
    )
    const stripes = document.querySelectorAll('.gantt-chart > .stripe')
    rows.forEach((key, i) => stripes[i]?.setAttribute('data-probe-stripe', key))
  })
}

/** 等頁面上所有有限長度的動畫 / 過渡跑完。 */
async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity),
  )
}

/** 任務列、條、橫紋的選擇器。 */
const row = (id: string): string => `[data-rowtask="${id}"]`
const grow = (id: string): string => `[data-rowgroup="${id}"]`
const bar = (id: string): string => `.bar[data-taskid="${id}"]`
const stripe = (key: string): string => `[data-probe-stripe="${key}"]`

/** 條在列裡往下 6px、摘要條 12px（GanttBar 的 top）。 */
const BAR_OFF = 6
const SUM_OFF = 12

/**
 * 收合 / 篩選這類「列增減」的共同驗收：
 * 指定的列一路朝終點走、沒有瞬移；它的條 / 橫紋每一幀都跟列對齊（≤ 4px）。
 */
function expectRowsInSync(
  tr: Trace,
  from: number,
  tasks: string[],
  groups: string[],
  { summary = false }: { summary?: boolean } = {},
): void {
  for (const id of tasks) {
    const p = pathReport(tr, `row:${id}`, from)
    expect(p.moved, `${id} 列要有位移`).toBeGreaterThan(20)
    expect(p.monotonic, `${id} 列一路朝終點走`).toBe(true)
    expect(p.jumps, `${id} 列沒有單幀瞬移`).toBe(0)
    expect(maxSkew(tr, `row:${id}`, `bar:${id}`, BAR_OFF, from), `${id} 條與列同步`).toBeLessThanOrEqual(4)
    expect(maxSkew(tr, `row:${id}`, `stripe:t-${id}`, 0, from), `${id} 橫紋與列同步`).toBeLessThanOrEqual(4)
  }
  for (const id of groups) {
    const p = pathReport(tr, `group:${id}`, from)
    expect(p.moved, `${id} 分類列要有位移`).toBeGreaterThan(20)
    expect(p.monotonic, `${id} 分類列一路朝終點走`).toBe(true)
    expect(p.jumps, `${id} 分類列沒有單幀瞬移`).toBe(0)
    expect(maxSkew(tr, `group:${id}`, `stripe:g-${id}`, 0, from), `${id} 橫紋與分類列同步`).toBeLessThanOrEqual(4)
    if (summary) {
      expect(maxSkew(tr, `group:${id}`, `sum:${id}`, SUM_OFF, from), `${id} 摘要條與分類列同步`).toBeLessThanOrEqual(4)
    }
  }
}

/** 追蹤清單：每個任務的列 / 條 / 橫紋，每個分類的分類列 / 橫紋 / 摘要條。 */
function targetsFor(tasks: string[], groups: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of tasks) {
    out[`row:${id}`] = row(id)
    out[`bar:${id}`] = bar(id)
    out[`stripe:t-${id}`] = stripe(`t-${id}`)
  }
  for (const id of groups) {
    out[`group:${id}`] = grow(id)
    out[`stripe:g-${id}`] = stripe(`g-${id}`)
    out[`sum:${id}`] = bar(`sum-${id}`)
  }
  return out
}

/**
 * 開 Dashboard，但**不固定時鐘**：Playwright 的 `clock.setFixedTime` 會連 requestAnimationFrame 一起換成
 * 計時器模擬，跟真正的畫面幀不同步（rAF 寫上去的位移不一定是畫出來的那一幀）；量逐幀動畫要用瀏覽器原生的 rAF。
 * 這裡量的是列與條的位置，跟「今天」是哪天無關。
 */
async function openGantt(page: Page): Promise<DashboardPage> {
  const app = new DashboardPage(page)
  await page.goto('/projects/pmis')
  await page.locator('[data-rowtask]').first().waitFor()
  await idle(page)
  await tagStripes(page)
  return app
}

test.describe('左欄列增減：離場列立即讓位、左右同步（D1 / D5 / D9）', () => {
  test('收合分類 g1：t1 當幀消失，下方列與條 / 橫紋同步上移', async ({ page }) => {
    const app = await openGantt(page)
    const tasks = ['t7', 't12', 't20', 't30']
    const groups = ['g2', 'g6']
    const tr = await trace(page, { ...targetsFor(tasks, groups), leaving: row('t1') }, () =>
      app.groupRow('g1').locator('.caret').click(),
    )
    const at = tr.marks[0]!
    // 離場列不停留佔位：點下去之後的每一幀都已經不在
    expect(tr.frames.filter((f) => f.t > at && f.boxes.leaving), '離場列 t1 還留在畫面上的幀').toHaveLength(0)
    expectRowsInSync(tr, at, tasks, groups)
  })

  test('篩選「執行中」：留下的列與條 / 橫紋同步移到新位置', async ({ page }) => {
    const app = await openGantt(page)
    const tasks = ['t8', 't13', 't29']
    const groups = ['g2', 'g6']
    await app.topFilter(0).locator('.dd-trigger').click()
    const tr = await trace(page, { ...targetsFor(tasks, groups), leaving: row('t1') }, () =>
      app.topFilter(0).locator('.dd-item', { hasText: '執行中' }).click(),
    )
    const at = tr.marks[0]!
    expect(tr.frames.filter((f) => f.t > at && f.boxes.leaving), '離場列 t1 還留在畫面上的幀').toHaveLength(0)
    expectRowsInSync(tr, at, tasks, groups)
  })

  test('全部收合：分類列與橫紋 / 摘要條同步上移', async ({ page }) => {
    await openGantt(page)
    const groups = ['g2', 'g4', 'g6']
    const tr = await trace(page, { ...targetsFor([], groups), leaving: row('t30') }, () =>
      page.getByRole('button', { name: '全部收合' }).click(),
    )
    const at = tr.marks[0]!
    expect(tr.frames.filter((f) => f.t > at && f.boxes.leaving), '離場列 t30 還留在畫面上的幀').toHaveLength(0)
    expectRowsInSync(tr, at, [], groups, { summary: true })
  })

  test('80ms 內連點收合 → 展開：第二下之後一路回到原位、左右同步', async ({ page }) => {
    const app = await openGantt(page)
    const tasks = ['t7', 't20']
    const groups = ['g2']
    const caret = app.groupRow('g1').locator('.caret')
    const box = (await caret.boundingBox())!
    const tr = await trace(page, targetsFor(tasks, groups), async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await pause(page, 80)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    })
    expect(tr.marks).toHaveLength(2)
    const [first, second] = tr.marks as [number, number]
    for (const id of tasks) {
      expect(maxSkew(tr, `row:${id}`, `bar:${id}`, BAR_OFF, first), `${id} 條與列同步`).toBeLessThanOrEqual(4)
      expect(maxSkew(tr, `row:${id}`, `stripe:t-${id}`, 0, first), `${id} 橫紋與列同步`).toBeLessThanOrEqual(4)
      const p = pathReport(tr, `row:${id}`, second)
      expect(p.monotonic, `${id} 列第二下之後一路朝終點走`).toBe(true)
      expect(p.jumps, `${id} 列沒有單幀瞬移`).toBe(0)
    }
    expect(maxSkew(tr, 'group:g2', 'stripe:g-g2', 0, first), 'g2 橫紋與分類列同步').toBeLessThanOrEqual(4)
    expect(pathReport(tr, 'group:g2', second).monotonic, 'g2 第二下之後一路朝終點走').toBe(true)
  })
})

test('列排序換位後 40ms 放手：被拖列的放大、其他列的淡化都有中間幀回到原狀（D8）', async ({ page }) => {
  const app = await openGantt(page)
  const gb = (await app.row('t4').locator('.grip').boundingBox())!
  const x = gb.x + gb.width / 2
  const y0 = gb.y + gb.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 + 12)
  await pause(page, 300)
  const tr = await trace(
    page,
    { dragged: row('t4'), other: row('t2') },
    async () => {
      // 越過 t5 的下緣 → 換位；40ms 後把游標移到甘特畫布上再放開（不落在列上，放開不會變成點選）
      await page.mouse.move(x, y0 + 30)
      await pause(page, 40)
      await page.mouse.move(1000, y0 + 30)
      await page.mouse.up()
    },
    { markOn: 'pointerup' },
  )
  expect(await app.rowOrder().then((o) => o.slice(3, 6))).toEqual(['t3', 't5', 't4'])
  const at = tr.marks[0]!
  const after = tr.frames.filter((f) => f.t >= at)
  const scales = after.map((f) => f.boxes.dragged?.s ?? 1)
  const ops = after.map((f) => f.boxes.other?.o ?? 1)
  expect(scales.some((s) => s > 1.002 && s < 1.023), `被拖列放大有中間幀：${scales.join(',')}`).toBe(true)
  expect(ops.some((o) => o > 0.55 && o < 0.95), `其他列淡化有中間幀：${ops.join(',')}`).toBe(true)
})

test.describe('重排：條 / 橫紋逐幀連續、跟著列走（D2）', () => {
  test('分類交換（g1 拖到 g2 後面）：兩個分類的條 / 橫紋都平順換位', async ({ page }) => {
    const app = await openGantt(page)
    const tasks = ['t1', 't3', 't6', 't7', 't9', 't12']
    const groups = ['g1', 'g2']
    const gb = (await app.groupRow('g1').locator('.grip').boundingBox())!
    const x = gb.x + gb.width / 2
    const y0 = gb.y + gb.height / 2
    await page.mouse.move(x, y0)
    await page.mouse.down()
    // 先越過自己整塊（7 列）的下緣，再過下一塊的一半才交換（legacy :2506-2520）
    await page.mouse.move(x, y0 + 120)
    await pause(page, 260)
    await page.mouse.move(x, y0 + 240)
    await pause(page, 100)
    const tr = await trace(page, targetsFor(tasks, groups), () => page.mouse.move(x, y0 + 360), {
      markOn: 'pointermove',
    })
    await page.mouse.up()
    expect((await app.rowOrder()).slice(0, 8)).toEqual(['G:g2', 't7', 't8', 't9', 't10', 't11', 't12', 'G:g1'])
    expectRowsInSync(tr, tr.marks[0]!, tasks, groups)
  })

  test('列排序（t4 拖過 t5）：被拖列自己的條也跟列一起補間', async ({ page }) => {
    const app = await openGantt(page)
    const tasks = ['t4', 't5']
    const gb = (await app.row('t4').locator('.grip').boundingBox())!
    const x = gb.x + gb.width / 2
    const y0 = gb.y + gb.height / 2
    await page.mouse.move(x, y0)
    await page.mouse.down()
    await page.mouse.move(x, y0 + 12)
    await pause(page, 300)
    const tr = await trace(page, targetsFor(tasks, []), () => page.mouse.move(x, y0 + 30), {
      markOn: 'pointermove',
    })
    // 放開前把游標移到畫布上，不落在列上（放開變點選是 D16，另外驗）
    await page.mouse.move(1000, y0 + 30)
    await page.mouse.up()
    expect((await app.rowOrder()).slice(3, 6)).toEqual(['t3', 't5', 't4'])
    expectRowsInSync(tr, tr.marks[0]!, tasks, [])
  })

  test('看板卡拖到甘特分類列（t3 → g3）：搬走的列與後面的列、條、橫紋都平順換位', async ({ page }) => {
    await openGantt(page)
    // t3 搬到 g3 第一筆：原位置到 g3 之間的列上移一格，t3 自己往下一大段（g3 之後的列不動）
    const tasks = ['t3', 't4', 't7', 't12']
    const groups = ['g2', 'g3']
    const tr = await trace(
      page,
      targetsFor(tasks, groups),
      () => html5Drag(page, '[data-card="t3"]', '[data-rowgroup="g3"]'),
      { markOn: 'drop' },
    )
    const order = await new DashboardPage(page).rowOrder()
    expect(order[order.indexOf('G:g3') + 1], 't3 成為 g3 第一筆').toBe('t3')
    expectRowsInSync(tr, tr.marks[0]!, tasks, groups)
  })
})

test.describe('排序放手不變成點選（D16）', () => {
  /** 甘特水平捲動位置。 */
  const scrollLeft = (page: Page): Promise<number> =>
    page.locator('.gantt-scroller').evaluate((el) => el.scrollLeft)

  test('列排序：放手時游標在任務名上 → 不選取、不淡化、不捲動', async ({ page }) => {
    const app = await openGantt(page)
    const sl0 = await scrollLeft(page)
    const gb = (await app.row('t4').locator('.grip').boundingBox())!
    const x = gb.x + gb.width / 2
    const y0 = gb.y + gb.height / 2
    await page.mouse.move(x, y0)
    await page.mouse.down()
    await page.mouse.move(x, y0 + 12)
    await pause(page, 300)
    // 越過 t5 → 換位；游標往右移到 t4（換位後的位置）的任務名上再放開
    await page.mouse.move(x + 80, y0 + 34)
    await pause(page, 400)
    await page.mouse.up()
    await pause(page, 600)
    expect((await app.rowOrder()).slice(3, 6)).toEqual(['t3', 't5', 't4'])
    await expect(app.row('t4')).toHaveAttribute('data-selected', 'false')
    await expect(app.row('t2')).toHaveCSS('opacity', '1')
    expect(await scrollLeft(page)).toBe(sl0)
  })

  test('分類交換：放手時游標在分類名上 → 不選取分類', async ({ page }) => {
    const app = await openGantt(page)
    await page.getByRole('button', { name: '全部收合' }).click()
    await idle(page)
    const gb = (await app.groupRow('g1').locator('.grip').boundingBox())!
    const x = gb.x + gb.width / 2
    const y0 = gb.y + gb.height / 2
    await page.mouse.move(x, y0)
    await page.mouse.down()
    await page.mouse.move(x, y0 + 16)
    await pause(page, 300)
    // 越過 g2 的一半 → 交換；游標往右移到分類名上再放開
    await page.mouse.move(x + 80, y0 + 44)
    await pause(page, 400)
    await page.mouse.up()
    await pause(page, 600)
    expect((await app.rowOrder()).slice(0, 2)).toEqual(['G:g2', 'G:g1'])
    await expect(app.groupRow('g1')).not.toHaveClass(/selected/)
    await expect(app.groupRow('g2')).not.toHaveClass(/selected/)
  })
})

test.describe('程式捲動補間讓位給使用者（D7）', () => {
  // 這組不量逐幀位置，照一般 e2e 固定時鐘（今天 = 2026-09-18），捲動位置才可預期
  const scrollLeftOf = (app: DashboardPage): Promise<number> => app.scrollLeftOf(app.ganttScroller)

  test('選取 t6 的 focus 捲動中按住條右移 6px：日期不變（捲動量不算進拖曳）', async ({ page }) => {
    const app = new DashboardPage(page)
    await app.goto()
    // 先量 focus 捲動的終點：選取 t6、等補間（最長 1.15 秒）跑完，再取消選取
    await app.row('t6').locator('.name').click()
    await pause(page, 1300)
    const target = await scrollLeftOf(app)
    await app.row('t6').locator('.name').click()
    // 從終點左邊 400px 再選一次：補間約 0.5 秒，條從右往左滑，一直在畫布中段（離自動捲動的邊緣很遠）
    await app.ganttScroller.evaluate((el, v) => {
      el.scrollLeft = v
    }, target - 400)
    const before = await app.row('t6').locator('.date-text').innerText()
    await app.row('t6').locator('.name').click()
    await pause(page, 60)
    const b = (await app.bar('t6').boundingBox())!
    const x = b.x + b.width / 2
    const y = b.y + b.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await pause(page, 250)
    await page.mouse.move(x + 3, y)
    await pause(page, 250)
    await page.mouse.move(x + 6, y)
    await pause(page, 300)
    await page.mouse.up()
    await expect(app.row('t6').locator('.date-text')).toHaveText(before)
  })

  test('「今天」捲動補間中滾輪有效：停在滾輪之後的位置，不被拉回今天', async ({ page }) => {
    const app = new DashboardPage(page)
    await app.goto()
    // 先量「今天」補間的終點
    await app.todayButton.click()
    await pause(page, 1300)
    const today = await scrollLeftOf(app)
    // 從最右邊按「今天」：往左捲一大段；60ms 後在畫布上往右滾
    await app.ganttScroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    await app.todayButton.click()
    const box = (await app.ganttScroller.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 60)
    await pause(page, 60)
    await page.mouse.wheel(400, 0)
    await pause(page, 1300)
    const end = await scrollLeftOf(app)
    // 沒讓位的話補間會一路把位置拉回今天
    expect(Math.abs(end - today), `停在 ${end}、今天在 ${today}`).toBeGreaterThan(100)
  })
})

/**
 * 在相依線上打測試用的標記（`data-probe-dep="<from>-<to>"`）：可見的 `.dep` 與點擊熱區 `.dep-hit` 是同一份清單、同一個順序，
 * 熱區的 `<title>` 寫著「A → B（點擊刪除串接）」，用任務名對回去。
 */
async function tagDeps(page: Page, pairs: [string, string][]): Promise<void> {
  await page.evaluate((pairs) => {
    const name = (id: string): string =>
      document.querySelector(`[data-rowtask="${id}"] .name`)?.getAttribute('title') ?? ''
    const hits = [...document.querySelectorAll('.dep-hit')]
    const lines = document.querySelectorAll('.dep-layer polyline.dep')
    for (const [a, b] of pairs) {
      const i = hits.findIndex((h) => h.textContent?.startsWith(`${name(a)} → ${name(b)}`))
      lines[i]?.setAttribute('data-probe-dep', `${a}-${b}`)
    }
  }, pairs)
}

/**
 * 相依線兩端與條的最大落差（同一幀）：起點貼著前置條的右緣、條的垂直中線（top + 11），
 * 終點在後續條左緣往左 3px（箭頭）、同樣在垂直中線（DependencyLines 的 ax / ay / endX / by）。
 */
function depGap(tr: Trace, from: string, to: string, since: number): number {
  let max = 0
  for (const f of tr.frames) {
    if (f.t < since) continue
    const d = f.boxes[`dep:${from}-${to}`]?.pts
    const a = f.boxes[`bar:${from}`]
    const b = f.boxes[`bar:${to}`]
    if (!d || !a || !b) continue
    max = Math.max(
      max,
      Math.abs(d[0] - (a.x + a.w)),
      Math.abs(d[1] - (a.y + 11)),
      Math.abs(d[2] - (b.x - 3)),
      Math.abs(d[3] - (b.y + 11)),
    )
  }
  return +max.toFixed(1)
}

test.describe('相依線、今天線、選取淡化跟著條走（D4）', () => {
  const PAIRS: [string, string][] = [
    ['t8', 't9'],
    ['t9', 't20'],
  ]
  const depTargets = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [a, b] of PAIRS) {
      out[`dep:${a}-${b}`] = `[data-probe-dep="${a}-${b}"]`
      out[`bar:${a}`] = bar(a)
      out[`bar:${b}`] = bar(b)
    }
    return out
  }

  test('收合 g1：相依線兩端每一幀都貼著還在上移的條', async ({ page }) => {
    const app = await openGantt(page)
    await tagDeps(page, PAIRS)
    const tr = await trace(page, depTargets(), () => app.groupRow('g1').locator('.caret').click())
    const at = tr.marks[0]!
    expect(pathReport(tr, 'bar:t9', at).moved, 't9 的條要有位移').toBeGreaterThan(100)
    for (const [a, b] of PAIRS) expect(depGap(tr, a, b, at), `${a} → ${b}`).toBeLessThanOrEqual(4)
  })

  test('列選單 +1 天：相依線跟著變寬的條與被推動的下游一起走', async ({ page }) => {
    const app = await openGantt(page)
    await tagDeps(page, PAIRS)
    await app.rowMore('t8').click()
    const tr = await trace(page, depTargets(), () =>
      app.rowMenu.locator('.rm-step', { hasText: '+1天' }).click(),
    )
    const at = tr.marks[0]!
    const pushed = seriesOf(tr, 'bar:t9', at)
    expect(pushed.at(-1)!.x - pushed[0]!.x, 't9 被推一天').toBeGreaterThan(20)
    for (const [a, b] of PAIRS) expect(depGap(tr, a, b, at), `${a} → ${b}`).toBeLessThanOrEqual(4)
  })

  test('選取 t3：無關的相依線淡化有中間幀', async ({ page }) => {
    const app = await openGantt(page)
    await tagDeps(page, [['t24', 't25']])
    const tr = await trace(page, { dep: '[data-probe-dep="t24-t25"]' }, () => app.row('t3').locator('.name').click())
    const ops = tr.frames.filter((f) => f.t >= tr.marks[0]!).map((f) => f.boxes.dep?.o ?? 1)
    expect(ops.at(-1), '最後淡到 0.25').toBeCloseTo(0.25, 2)
    expect(ops.some((o) => o > 0.3 && o < 0.95), `淡化有中間幀：${ops.join(',')}`).toBe(true)
  })

  test('收合 g1：今天線高度逐幀變短（跟著畫布，不是一幀跳到終點）', async ({ page }) => {
    const app = await openGantt(page)
    const tr = await trace(page, { today: '.today-line' }, () => app.groupRow('g1').locator('.caret').click())
    // 從點下去之前的最後一幀算起
    const hs = seriesOf(tr, 'today', tr.marks[0]!).map((f) => f.h)
    const [h0, h1] = [hs[0]!, hs.at(-1)!]
    expect(h0 - h1, '畫布少了 6 列').toBeGreaterThan(150)
    expect(hs.some((h) => h < h0 - 10 && h > h1 + 10), `高度有中間幀：${hs.join(',')}`).toBe(true)
    expect(hs.every((h, i) => i === 0 || h <= hs[i - 1]! + 0.5), '一路變短').toBe(true)
  })
})

test.describe('平板：選取中常駐的連線圓點跟著條走（D4）', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })

  const dots = {
    bar: bar('t8'),
    dotR: '[data-linkfor="t8"].zone-r',
    dotL: '[data-linkfor="t8"].zone-l',
  }

  /** 右側圓點熱區貼在條右緣外 2px、上緣比條高 9px（GanttBar 的 zoneR / zoneY）。 */
  function dotGap(tr: Trace, since: number): number {
    let max = 0
    for (const f of tr.frames) {
      if (f.t < since || !f.boxes.bar || !f.boxes.dotR) continue
      const b = f.boxes.bar
      const d = f.boxes.dotR
      max = Math.max(max, Math.abs(d.x - (b.x + b.w + 2)), Math.abs(d.y - (b.y - 9)))
    }
    return +max.toFixed(1)
  }

  test('+1 天：右側圓點跟著條的右緣走；收合上方分類：圓點跟著條上移', async ({ page }) => {
    const app = await openGantt(page)
    await app.row('t8').locator('.name').tap()
    await pause(page, 1300)
    await expect(page.locator(dots.dotR)).toHaveClass(/shown/)

    await app.rowMore('t8').tap()
    let tr = await trace(page, dots, () => app.rowMenu.locator('.rm-step', { hasText: '+1天' }).tap())
    expect(dotGap(tr, tr.marks[0]!), '+1 天時圓點與條右緣').toBeLessThanOrEqual(4)

    await page.locator('.rm-mask').tap()
    await idle(page)
    tr = await trace(page, dots, () => app.groupRow('g1').locator('.caret').tap())
    expect(pathReport(tr, 'bar', tr.marks[0]!).moved, '條要有位移').toBeGreaterThan(100)
    expect(dotGap(tr, tr.marks[0]!), '收合時圓點與條').toBeLessThanOrEqual(4)
  })
})

test.describe('窄版左欄（< 900px）：日期膠囊不重播淡入、任務名寬度單調（D10 / D15）', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('分類交換時被搬動的列，日期膠囊一直是實的（不重播淡入）', async ({ page }) => {
    const app = await openGantt(page)
    const dates: Record<string, string> = {}
    for (const id of ['t1', 't6', 't7', 't9', 't12']) dates[id] = `${row(id)} .date`
    const gb = (await app.groupRow('g1').locator('.grip').boundingBox())!
    const x = gb.x + gb.width / 2
    const y0 = gb.y + gb.height / 2
    await page.mouse.move(x, y0)
    await page.mouse.down()
    await page.mouse.move(x, y0 + 120)
    await pause(page, 260)
    await page.mouse.move(x, y0 + 240)
    await pause(page, 100)
    const tr = await trace(page, dates, () => page.mouse.move(x, y0 + 360), { markOn: 'pointermove' })
    await page.mouse.up()
    expect((await app.rowOrder()).slice(0, 2)).toEqual(['G:g2', 't7'])
    for (const id of Object.keys(dates)) {
      const ops = tr.frames.map((f) => f.boxes[id]?.o ?? 1)
      expect(Math.min(...ops), `${id} 的日期膠囊最淡到`).toBe(1)
    }
  })

  test('左欄展開 / 收合：任務名寬度一路變寬 / 變窄，不在膠囊換寫法那一幀縮回去', async ({ page }) => {
    await openGantt(page)
    const names: Record<string, string> = {}
    for (const id of ['t1', 't3', 't9', 't20']) names[id] = `${row(id)} .name`
    const toggle = page.getByTestId('gantt-left-toggle')

    /** 某個任務名的寬度序列（從動作前最後一幀起）要一路朝同一個方向走（容 0.5px）。 */
    const expectMonotonic = (tr: Trace, dir: 1 | -1, label: string): void => {
      for (const id of Object.keys(names)) {
        const ws = seriesOf(tr, id, tr.marks[0]!).map((f) => f.w)
        expect(dir * (ws.at(-1)! - ws[0]!), `${label} ${id} 最後比一開始${dir > 0 ? '寬' : '窄'}`).toBeGreaterThan(2)
        const bad = ws.findIndex((w, i) => i > 0 && dir * (w - ws[i - 1]!) < -0.5)
        expect(bad, `${label} ${id} 寬度逐幀：${ws.map((w) => w.toFixed(1)).join(',')}`).toBe(-1)
      }
    }

    const open = await trace(page, names, () => toggle.click(), { ms: 1000 })
    expectMonotonic(open, 1, '展開')
    await expect(page.locator(`${row('t3')} .date-days`)).toBeVisible()
    await idle(page)
    const close = await trace(page, names, () => toggle.click(), { ms: 1000 })
    expectMonotonic(close, -1, '收合')
    await expect(page.locator(`${row('t3')} .date-days`)).toHaveCount(0)
  })
})

test.describe('甘特面板收合 / 展開（D3 / D12）', () => {
  test('展開途中甘特的內容不蓋住下方看板（overflow 等過渡跑完才放行）', async ({ page }) => {
    const app = await openGantt(page)
    await app.panelToggle('gantt').click()
    await expect(page.locator('[data-rowtask]')).toHaveCount(0)
    await idle(page)
    // 每一幀取看板卡片區（標題列下方 100px，避開 sticky 的欄標題）的兩點，看最上層的元素屬於哪個面板
    const hits = page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const out: string[] = []
          const t0 = performance.now()
          const tick = (): void => {
            const kb = document.querySelector('[data-panel="kanban"]')!
            const head = kb.querySelector('.panel-head')!.getBoundingClientRect()
            const y = head.bottom + 100
            for (const x of [head.left + 200, head.left + 900]) {
              if (y > innerHeight - 2) continue
              const el = document.elementFromPoint(x, y)
              out.push(el?.closest('[data-panel]')?.getAttribute('data-panel') ?? 'none')
            }
            if (performance.now() - t0 < 600) requestAnimationFrame(tick)
            else resolve(out)
          }
          requestAnimationFrame(tick)
        }),
    )
    await app.panelToggle('gantt').click()
    const seen = await hits
    expect(seen.filter((p) => p === 'gantt'), `每幀命中的面板：${seen.join(',')}`).toHaveLength(0)
    await expect(page.locator('[data-rowtask]')).toHaveCount(30)
  })

  test('收合再展開：水平捲動位置不變，尺規跟著', async ({ page }) => {
    const app = await openGantt(page)
    await app.freezeGanttScroll(500)
    await app.panelToggle('gantt').click()
    await expect(page.locator('[data-rowtask]')).toHaveCount(0)
    await app.panelToggle('gantt').click()
    await expect(page.locator('[data-rowtask]')).toHaveCount(30)
    await expect.poll(() => app.scrollLeftOf(app.ganttScroller)).toBe(500)
    expect(await app.scrollSyncDelta()).toBeLessThan(1)
  })
})
