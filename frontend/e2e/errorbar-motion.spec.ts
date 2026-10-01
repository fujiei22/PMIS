import { expect, test, type Page } from '@playwright/test'
import { clickInPage, hasMid, idle, openDashboard, peakThenFall, series, trace, ui, type Trace } from './helpers/motion'

/**
 * 錯誤列（ErrorBar）出現 / 關閉時頁面內容的銜接（動畫稽核批次 E 的 G11 / D14，docs/incidents/2026-09-30-motion-audit）。
 * 錯誤列掛在 sticky 頂欄的第二列、在文件流裡（契約 C）：高度要逐幀展開 / 收起，
 * 下面的甘特與面板頭（sticky top 跟著頂欄高度走）連續被推開 / 收回，不能一幀跳 40px；關閉要有離場。
 * 捲到中段時 Chrome 的 scroll anchoring 會補償文件流裡的位移：內容可以不動，但一樣不能有單幀跳動。
 */
test.use({ viewport: { width: 1920, height: 1080 } })

/**
 * 瞬移的幀數：單幀位移 > minStep，而且速度（位移 / 間隔）比前後兩幀都大 2.5 倍以上。
 * 速度那一條同 dash-menu-motion.spec：跑全套 e2e 時 CPU 忙、一幀可能隔 50ms 以上，
 * 補間照實際時間走，那一幀位移本來就大，但速度跟前後幀接得上；瞬移是前後都不動、只有那一幀動。
 */
function speedJumps(pts: { t: number; v: number }[], minStep = 8): number {
  const sp = pts.map((p, i) => (i === 0 ? 0 : Math.abs(p.v - pts[i - 1]!.v) / Math.max(1, p.t - pts[i - 1]!.t)))
  let n = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.abs(pts[i]!.v - pts[i - 1]!.v)
    if (d > minStep && sp[i]! > 2.5 * (sp[i - 1] ?? 0) && sp[i]! > 2.5 * (sp[i + 1] ?? 0)) n++
  }
  return n
}

/**
 * 某個元素逐幀的 y：總位移（頭尾差）、瞬移的幀數、最大單幀位移（訊息用）。
 * 瞬移另外要求單幀走掉整段位移範圍（最大減最小）的一半以上：平行負載下記錄的時間與動畫取樣的時間偶爾對不上，
 * 補間途中會量到一幀 13px、前後各 5px 這種不均勻的步伐，速度比過得了 2.5 倍，但遠不到一半；
 * 修前是一幀 40px 整段到位（換行那條是 32px），兩條都過。用範圍不用頭尾差：先往回再回到原位的那條，頭尾差是 0。
 * key 可改量高度（h）；minStep 可改用固定門檻（補間中途接手的兩條，見 HALF_LINE）。
 */
function slideY(
  tr: Trace,
  name: string,
  { key = 'y', minStep }: { key?: 'y' | 'h'; minStep?: number } = {},
): { moved: number; jumps: number; maxStep: number } {
  const pts = series(tr, name).map((b) => ({ t: b.t, v: b[key] }))
  const vs = pts.map((p) => p.v)
  const range = vs.length ? Math.max(...vs) - Math.min(...vs) : 0
  return {
    moved: vs.length ? Math.abs(vs[vs.length - 1]! - vs[0]!) : 0,
    jumps: speedJumps(pts, minStep ?? Math.max(8, range / 2)),
    maxStep: Math.max(0, ...vs.map((v, i) => (i ? Math.abs(v - vs[i - 1]!) : 0))),
  }
}

/** 逐幀的錯誤列：trace 只取最後一個符合的元素，離場中的舊錯誤列與新的並存時量的是新的。 */
const BAR = '[data-errorbar]'
/** 頂欄：第二列就是錯誤列，它的高度 = 第一列 + 錯誤列看得到的高度（不管錯誤列裡面怎麼分層）。 */
const TOP = '.top-bar'
const GANTT_HEAD = '[data-panel="gantt"] .panel-head'
const RULER = '.gantt-ruler-row'

/** 甘特第一列的選擇器（trace 取最後一個符合的元素，要用 id 選到唯一一列）。 */
async function firstRow(page: Page): Promise<string> {
  const id = await page.locator('[data-rowtask]').first().getAttribute('data-rowtask')
  return `[data-rowtask="${id}"]`
}

/**
 * 讓下一次 updateTask 失敗，雙擊任務名改名、打一個字；回傳「按 Enter」：
 * 離開編輯 → 送出 → api 失敗 → 名稱還原、錯誤列出現（同 interactions.spec「api 失敗時改名還原並顯示錯誤條」）。
 */
async function armFailedRename(page: Page, id: string): Promise<() => Promise<void>> {
  // 接上真後端之後沒有 __mockApi，注入不了失敗就跳過（review M8）
  // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
  test.skip(!(await page.evaluate(() => !!window.__mockApi)))
  await page.evaluate(() => window.__mockApi!.failNext('updateTask'))
  const row = page.locator(`[data-rowtask="${id}"]`)
  await row.locator('.name').dblclick()
  const input = row.locator('input')
  await expect(input).toBeVisible()
  await input.pressSequentially('X')
  return () => input.press('Enter')
}

/** 某段 trace 裡錯誤列逐幀的透明度（自己與所有祖先相乘）。 */
function barOpacity(tr: Trace, after = -Infinity): number[] {
  return series(tr, 'bar')
    .filter((b) => b.t > after)
    .map((b) => b.o)
}

/**
 * 等錯誤列的進出場跑完。Vue 隔兩幀才換上 enter-to，剛 push 完那一刻還沒有在跑的過渡，
 * 直接 idle() 會提早放行：先等兩幀再等動畫跑完。
 */
async function barSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await idle(page)
}

/** 頁內直接拿 ui store（同 helpers/motion 的 ui()，但要在頁內用 setTimeout 排程呼叫，不能隔一次往返）。 */
type PiniaApp = {
  __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, Record<string, unknown>> } } } }
}

test.beforeEach(async ({ page }) => {
  await openDashboard(page)
})

test('頁頂（scrollY = 0）：錯誤列出現與按 ✕ 收起時，甘特第一列逐幀被推開 / 收回，進出場都有淡入淡出', async ({
  page,
}) => {
  const row = await firstRow(page)
  const targets = { row, head: GANTT_HEAD, bar: BAR }
  const enter = await armFailedRename(page, 't3')

  const shown = await trace(page, targets, enter)
  await expect(page.locator(BAR), '前提：錯誤列出現了').toContainText('更新任務')
  expect(await page.evaluate(() => window.scrollY), '前提：還在頁頂').toBe(0)
  const down = slideY(shown, 'row')
  expect(down.moved, '前提：甘特第一列被推下去').toBeGreaterThan(30)
  expect(down.jumps, `出現：第一列單幀瞬移的次數（最大單幀 ${down.maxStep.toFixed(1)}px）`).toBe(0)
  expect(slideY(shown, 'head').jumps, '出現：甘特面板頭單幀瞬移的次數').toBe(0)
  expect(hasMid(barOpacity(shown)), '出現：錯誤列有淡入的中間值').toBe(true)

  // 進場跑完才關：負載高時進場可能拖到上一段記錄的尾巴，沒跑完就關的話量到的收回距離不足
  await idle(page)
  const hidden = await trace(page, targets, () => clickInPage(page, `${BAR} .error-x`))
  await expect(page.locator(BAR), '前提：錯誤列收掉了').toHaveCount(0)
  const up = slideY(hidden, 'row')
  expect(up.moved, '前提：甘特第一列收回去').toBeGreaterThan(30)
  expect(up.jumps, `收起：第一列單幀瞬移的次數（最大單幀 ${up.maxStep.toFixed(1)}px）`).toBe(0)
  expect(slideY(hidden, 'head').jumps, '收起：甘特面板頭單幀瞬移的次數').toBe(0)
  expect(hasMid(barOpacity(hidden, hidden.at)), '收起：錯誤列有離場（淡出的中間值）').toBe(true)
  const leaving = series(hidden, 'bar').filter((b) => b.t > hidden.at)
  expect(
    leaving.map((b) => b.pe).filter((pe) => pe !== 'none'),
    '收起：離場中的每一幀都不攔點擊（pointer-events: none）',
  ).toHaveLength(0)
})

test('捲到甘特中段：錯誤列出現與收起時，黏住的面板頭、尺規與畫面上的任務列都沒有單幀跳動', async ({ page }) => {
  // 捲到甘特面板頭黏在頂欄下方、前幾列已經捲過去的位置
  await page.evaluate((sel) => {
    const head = document.querySelector(sel)!.getBoundingClientRect()
    const top = document.querySelector('.top-bar')!.getBoundingClientRect().height
    window.scrollTo(0, window.scrollY + head.top - top + 240)
  }, GANTT_HEAD)
  await page.waitForFunction(() => window.scrollY > 0)
  // 畫面上一列看得到的任務（在尺規下方、視窗底部之上）拿來改名
  const visible = await page.evaluate((ruler) => {
    const floor = document.querySelector(ruler)!.getBoundingClientRect().bottom + 40
    const rows = [...document.querySelectorAll<HTMLElement>('[data-rowtask]')]
    const hit = rows.find((r) => {
      const b = r.getBoundingClientRect()
      return b.top > floor && b.bottom < window.innerHeight - 40
    })
    return hit?.dataset.rowtask ?? null
  }, RULER)
  expect(visible, '前提：畫面上有看得到的任務列').not.toBeNull()
  const scrolled = await page.evaluate(() => window.scrollY)

  const targets = {
    first: await firstRow(page),
    row: `[data-rowtask="${visible}"]`,
    head: GANTT_HEAD,
    ruler: RULER,
    bar: BAR,
  }
  const enter = await armFailedRename(page, visible!)

  const shown = await trace(page, targets, enter)
  await expect(page.locator(BAR), '前提：錯誤列出現了').toContainText('更新任務')
  const head = slideY(shown, 'head')
  expect(head.moved, '前提：黏住的面板頭跟著頂欄長高往下').toBeGreaterThan(30)
  for (const name of ['first', 'row', 'head', 'ruler']) {
    const r = slideY(shown, name)
    expect(r.jumps, `出現：${name} 單幀瞬移的次數（最大單幀 ${r.maxStep.toFixed(1)}px，scrollY ${scrolled}）`).toBe(0)
  }
  expect(hasMid(barOpacity(shown)), '出現：錯誤列有淡入的中間值').toBe(true)

  // 進場跑完才關：負載高時進場可能拖到上一段記錄的尾巴，沒跑完就關的話量到的收回距離不足
  await idle(page)
  const hidden = await trace(page, targets, () => clickInPage(page, `${BAR} .error-x`))
  await expect(page.locator(BAR), '前提：錯誤列收掉了').toHaveCount(0)
  expect(slideY(hidden, 'head').moved, '前提：黏住的面板頭跟著頂欄收回往上').toBeGreaterThan(30)
  for (const name of ['first', 'row', 'head', 'ruler']) {
    const r = slideY(hidden, name)
    expect(r.jumps, `收起：${name} 單幀瞬移的次數（最大單幀 ${r.maxStep.toFixed(1)}px）`).toBe(0)
  }
  expect(hasMid(barOpacity(hidden, hidden.at)), '收起：錯誤列有離場（淡出的中間值）').toBe(true)
})

test('收起途中又來一筆：收到一半的那條照樣收完、新的另外展開，甘特第一列沒有單幀跳動', async ({ page }) => {
  const row = await firstRow(page)
  await ui(page, 'pushError', { label: '更新任務', error: {} })
  await barSettled(page)

  // 按 ✕ 後 40ms（收起才剛開始，舊的那條還有八成以上的高度）再來一筆；點擊與推新的一筆都在頁內排程，不隔往返
  const tr = await trace(page, { row, bar: BAR }, () =>
    page.evaluate((sel) => {
      const w = window as unknown as { __trace: { t0: number }; __stillLeaving?: boolean }
      const at = performance.now() - w.__trace.t0
      ;(document.querySelector(sel) as HTMLElement).click()
      setTimeout(() => {
        w.__stillLeaving = document.querySelectorAll('[data-errorbar]').length > 0
        const store = (document.querySelector('#app') as unknown as PiniaApp).__vue_app__.config.globalProperties.$pinia._s.get('ui')!
        ;(store.pushError as (e: { label: string; error: unknown }) => void)({ label: '新增任務', error: {} })
      }, 40)
      return at
    }, `${BAR} .error-x`),
  )
  const leaving = await page.evaluate(() => (window as unknown as { __stillLeaving?: boolean }).__stillLeaving)
  expect(leaving, '前提：新的一筆進來時，舊的那條還在收').toBe(true)
  await expect(page.locator(BAR), '收完只剩新的一條').toHaveCount(1)
  await expect(page.locator(BAR)).toContainText('新增任務')
  const r = slideY(tr, 'row')
  expect(r.jumps, `第一列單幀瞬移的次數（最大單幀 ${r.maxStep.toFixed(1)}px）`).toBe(0)
})

test.describe('錯誤筆數變了讓錯誤列換行', () => {
  // 窄一點的視窗，兩筆長標籤排不進一行
  test.use({ viewport: { width: 1024, height: 900 } })

  /** 一筆就超過可用寬度的一半：兩筆一定排不進一行。 */
  const label = (n: number): string => `第 ${n} 筆：${'很長的操作名稱'.repeat(5)}`

  /**
   * 補間中途接手的兩條用的瞬移門檻：半行（一行錯誤列 40px）。
   * 修前那一幀跳的是「補間中的高度」與「進出場插值到的高度」之差（約 30px），不到整段範圍（兩行約 72px）的一半，
   * slideY 預設的「範圍一半」抓不到。
   */
  const HALF_LINE = 20

  /** 頁內排程用：拿 ui store 的 pushError。 */
  type Push = (e: { label: string; error: unknown }) => void

  test('第二筆讓錯誤列多一行時，高度逐幀長高、甘特第一列逐幀被推開；關掉一筆時逐幀收回', async ({ page }) => {
    const row = await firstRow(page)
    const targets = { row, bar: BAR }
    await ui(page, 'pushError', { label: label(1), error: {} })
    await expect(page.locator(BAR)).toContainText(label(1))
    await barSettled(page)
    const oneLine = (await page.locator(BAR).boundingBox())!.height

    const grown = await trace(page, targets, () => ui(page, 'pushError', { label: label(2), error: {} }))
    const twoLines = (await page.locator(BAR).boundingBox())!.height
    expect(twoLines - oneLine, '前提：第二筆讓錯誤列多了一行').toBeGreaterThan(20)
    const down = slideY(grown, 'row')
    expect(down.moved, '前提：甘特第一列被推下去').toBeGreaterThan(20)
    expect(down.jumps, `多一行：第一列單幀瞬移的次數（最大單幀 ${down.maxStep.toFixed(1)}px）`).toBe(0)

    await idle(page)
    const shrunk = await trace(page, targets, () => clickInPage(page, `${BAR} .error-x`))
    await expect(page.locator(`${BAR} .error-item`), '前提：剩一筆').toHaveCount(1)
    const up = slideY(shrunk, 'row')
    expect(up.moved, '前提：甘特第一列收回去').toBeGreaterThan(20)
    expect(up.jumps, `少一行：第一列單幀瞬移的次數（最大單幀 ${up.maxStep.toFixed(1)}px）`).toBe(0)
  })

  test('少一行還沒收完就關掉最後一筆：從當下看得到的高度收起，甘特第一列與頂欄高度都沒有單幀跳動', async ({ page }) => {
    const row = await firstRow(page)
    const bare = (await page.locator(TOP).boundingBox())!.height
    await ui(page, 'pushError', { label: label(1), error: {} })
    await barSettled(page)
    const oneLine = (await page.locator(TOP).boundingBox())!.height
    await ui(page, 'pushError', { label: label(2), error: {} })
    await barSettled(page)
    const twoLines = (await page.locator(TOP).boundingBox())!.height
    expect(twoLines - oneLine, '前提：兩筆排成兩行').toBeGreaterThan(20)

    // 關掉一筆（少一行的補間開始），100ms 後（補間還沒跑完）再關掉最後一筆；兩下都在頁內排程，不隔往返
    const tr = await trace(page, { row, top: TOP, bar: BAR }, () =>
      page.evaluate(
        ({ x, top }) => {
          const w = window as unknown as { __trace: { t0: number }; __midH?: number }
          const at = performance.now() - w.__trace.t0
          ;(document.querySelector(x) as HTMLElement).click()
          setTimeout(() => {
            w.__midH = document.querySelector(top)!.getBoundingClientRect().height
            ;(document.querySelector(x) as HTMLElement).click()
          }, 100)
          return at
        },
        { x: `${BAR} .error-x`, top: TOP },
      ),
    )
    const mid = await page.evaluate(() => (window as unknown as { __midH?: number }).__midH ?? 0)
    expect(mid, '前提：關最後一筆時，少一行的補間已經開始').toBeLessThan(twoLines - 3)
    expect(mid, '前提：關最後一筆時，少一行的補間還沒跑完').toBeGreaterThan(oneLine + 3)
    await expect(page.locator(BAR), '前提：錯誤列收掉了').toHaveCount(0)
    const r = slideY(tr, 'row', { minStep: HALF_LINE })
    expect(r.moved, '前提：甘特第一列收回到沒有錯誤列的位置').toBeGreaterThan(twoLines - bare - 2)
    expect(r.jumps, `第一列單幀瞬移的次數（最大單幀 ${r.maxStep.toFixed(1)}px）`).toBe(0)
    const h = slideY(tr, 'top', { key: 'h', minStep: HALF_LINE })
    expect(h.jumps, `頂欄高度單幀瞬移的次數（最大單幀 ${h.maxStep.toFixed(1)}px）`).toBe(0)
    const os = barOpacity(tr, tr.at)
    expect(hasMid(os), '錯誤列有離場（淡出的中間值）').toBe(true)
    expect(peakThenFall(os).rises, '淡出途中沒有又變亮').toBe(0)
  })

  test('進場途中又來一筆讓它換行：高度從當下展開到的位置接著長，甘特第一列與頂欄高度都沒有單幀跳動', async ({ page }) => {
    const row = await firstRow(page)
    const bare = (await page.locator(TOP).boundingBox())!.height

    // 第一筆進來後 100ms（進場還在展開）再來一筆；兩筆都在頁內排程，不隔往返
    const tr = await trace(page, { row, top: TOP, bar: BAR }, () =>
      page.evaluate(
        ({ labels, top }) => {
          const w = window as unknown as { __trace: { t0: number }; __midH?: number }
          const store = (document.querySelector('#app') as unknown as PiniaApp).__vue_app__.config.globalProperties.$pinia._s.get('ui')!
          const push = store.pushError as Push
          const at = performance.now() - w.__trace.t0
          push({ label: labels[0]!, error: {} })
          setTimeout(() => {
            w.__midH = document.querySelector(top)!.getBoundingClientRect().height
            push({ label: labels[1]!, error: {} })
          }, 100)
          return at
        },
        { labels: [label(1), label(2)], top: TOP },
      ),
    )
    const mid = await page.evaluate(() => (window as unknown as { __midH?: number }).__midH ?? 0)
    await barSettled(page)
    const twoLines = (await page.locator(TOP).boundingBox())!.height
    expect(twoLines - bare, '前提：兩筆排成兩行').toBeGreaterThan(60)
    expect(mid, '前提：第二筆進來時，第一筆的進場已經開始展開').toBeGreaterThan(bare + 3)
    expect(mid, '前提：第二筆進來時，第一筆的進場還沒展開到一行').toBeLessThan(bare + (twoLines - bare) / 2)
    const r = slideY(tr, 'row', { minStep: HALF_LINE })
    expect(r.moved, '前提：甘特第一列被推到兩行錯誤列下面').toBeGreaterThan(twoLines - bare - 2)
    expect(r.jumps, `第一列單幀瞬移的次數（最大單幀 ${r.maxStep.toFixed(1)}px）`).toBe(0)
    const h = slideY(tr, 'top', { key: 'h', minStep: HALF_LINE })
    expect(h.jumps, `頂欄高度單幀瞬移的次數（最大單幀 ${h.maxStep.toFixed(1)}px）`).toBe(0)
    const os = barOpacity(tr)
    expect(hasMid(os), '錯誤列有淡入的中間值').toBe(true)
    expect(os.filter((o, i) => i > 0 && o < os[i - 1]! - 0.02), '淡入途中沒有又變暗').toHaveLength(0)
  })
})
