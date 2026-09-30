import { expect, test, type Page } from '@playwright/test'
import { DashboardPage } from './helpers/dashboardPage'

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
