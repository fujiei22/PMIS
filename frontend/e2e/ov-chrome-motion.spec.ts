import { expect, test, type Page } from '@playwright/test'
import { clickInPage, hasMid, idle, peakThenFall, series, trace, type Trace } from './helpers/motion'
import { gotoOverview, reverses, speedJumps } from './helpers/ovMotion'

/**
 * 總覽頂欄與面板標題列的浮層、頭像疊、排序 chip（動畫稽核批次 C 的總覽部分：T6、T7、T12、T14、T15，
 * docs/incidents/2026-09-30-motion-audit）。量測用 helpers/motion 的 trace（透明度含祖先、pointer-events），
 * 開頁用 helpers/ovMotion 的 gotoOverview（只固定 Date，rAF 是真的）。
 */
test.use({ viewport: { width: 1920, height: 1080 } })

const PM = '[data-ov-dd="pm"]'
const STATUS = '[data-ov-dd="status"]'
const CARDS = '[data-view-panel="cards"]'

/** 長幀：兩幀間隔超過這麼久，過渡在這段時間裡會一次走一大截，逐幀路徑量不到（不是程式的問題）。 */
const LONG_FRAME_MS = 50

/** from 起 ms 毫秒內沒有長幀。 */
function calm(tr: Trace, from: number, ms: number): boolean {
  return tr.frames.every((f) => f.t < from || f.t > from + ms || f.dt <= LONG_FRAME_MS)
}

/**
 * 逐幀量測的前提檢查（同 page-motion.spec 的 G9）：run 每次從乾淨的頁面開始錄，
 * 回傳的 valid 不成立（量測窗口裡碰上長幀）就重開頁面重來，最多 3 次；最後一次的結果照樣斷言。
 */
async function measure<T>(page: Page, run: () => Promise<{ value: T; valid: boolean }>): Promise<T> {
  let last!: { value: T; valid: boolean }
  for (let i = 0; i < 3; i++) {
    last = await run()
    if (last.valid) break
  }
  expect(last.valid, '3 次都在量測窗口碰上長幀（機器太忙）').toBe(true)
  return last.value
}

/** 某元素逐幀的值（不在畫面上的幀略過）。 */
function pts(tr: Trace, name: string, key: 'x' | 'y' | 'w' | 'h' | 'cx', from = -Infinity): { t: number; v: number }[] {
  return series(tr, name)
    .filter((b) => b.t >= from)
    .map((b) => ({ t: b.t, v: b[key] }))
}

/** 逐幀值的全距（最大減最小）。 */
function span(ps: { v: number }[]): number {
  const vs = ps.map((p) => p.v)
  return vs.length ? Math.max(...vs) - Math.min(...vs) : 0
}

/** 失敗訊息用：逐幀值列成一行。 */
const fmt = (ps: { v: number }[]): string => ps.map((p) => p.v.toFixed(1)).join(' ')

interface Menu {
  name: string
  open: string
  sel: string
}

/** 總覽的浮層：再點一次觸發鈕收合。 */
const MENUS: Menu[] = [
  { name: '狀態下拉', open: `${STATUS} .dd-trigger`, sel: `${STATUS} .dd-menu` },
  { name: '需注意下拉', open: '[data-ov-dd="alert"] .dd-trigger', sel: '[data-ov-dd="alert"] .dd-menu' },
  { name: '成員面板', open: `${PM} .dd-trigger`, sel: `${PM} .dd-menu` },
  { name: '排序選單', open: `${CARDS} .sort-trigger`, sel: `${CARDS} .sort-menu` },
]

for (const m of MENUS) {
  test(`T12 ${m.name}：開關都是 transition、離場不攔點擊、快速開關不閃全亮`, async ({ page }) => {
    const r = await measure(page, async () => {
      await gotoOverview(page)
      const opening = await trace(page, { pop: m.sel }, () => clickInPage(page, m.open), { ms: 400 })
      const closing = await trace(page, { pop: m.sel }, () => clickInPage(page, m.open), { ms: 400 })
      await idle(page)
      // 開了 60ms 就收：keyframes 版離場從全亮重播（T12），transition 從當下往回
      const quick = await trace(page, { pop: m.sel }, () => clickInPage(page, m.open, { sel: m.open, ms: 60 }), { ms: 400 })
      return {
        value: { opening, closing, quick },
        valid: calm(opening, opening.at, 200) && calm(closing, closing.at, 220) && calm(quick, quick.at, 300),
      }
    })
    expect(hasMid(series(r.opening, 'pop').map((b) => b.o)), '進場有中間值').toBe(true)
    const leaving = series(r.closing, 'pop').filter((b) => b.t > r.closing.at)
    expect(hasMid(leaving.map((b) => b.o)), '離場有中間值').toBe(true)
    expect(leaving.every((b) => b.pe === 'none'), '離場中不攔點擊').toBe(true)
    const q = peakThenFall(series(r.quick, 'pop').map((b) => b.o))
    expect(q.peak, '被打斷了，最亮不到全亮').toBeLessThan(0.98)
    expect(q.rises, '過了最亮之後又變亮的幀數').toBe(0)
  })
}

/**
 * T6 錨點：總覽頂欄的篩選器一律靠右排（.top-right / .filters 都是 flex-end），觸發鈕變寬 / 變窄是左緣在動、右緣不動。
 * 下拉 / 成員面板開著勾選項，選單要錨在右緣、不被帶著跑（修正前 left: 0：狀態 −10.3px、成員 +29.5px）。
 */
for (const vp of [
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
]) {
  test.describe(`${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp })

    test('T6 狀態下拉開著勾第一項：選單不被觸發鈕帶著跑', async ({ page }) => {
      await gotoOverview(page)
      await page.locator(`${STATUS} .dd-trigger`).click()
      await idle(page)
      const tr = await trace(page, { menu: `${STATUS} .dd-menu`, trig: `${STATUS} .dd-trigger` }, () =>
        clickInPage(page, `${STATUS} .dd-item`),
      )
      expect(span(pts(tr, 'trig', 'w')), '觸發鈕寬度有變（前提）').toBeGreaterThan(5)
      expect(span(pts(tr, 'menu', 'x')), `選單 x：${fmt(pts(tr, 'menu', 'x'))}`).toBeLessThanOrEqual(1)
    })

    test('T6 成員面板開著勾成員10：面板不被觸發鈕帶著跑', async ({ page }) => {
      await gotoOverview(page)
      await page.locator(`${PM} .dd-trigger`).click()
      await idle(page)
      const tr = await trace(page, { menu: `${PM} .dd-menu`, trig: `${PM} .dd-trigger` }, () =>
        clickInPage(page, `${PM} [data-pm-option="m10"]`),
      )
      expect(span(pts(tr, 'trig', 'w')), '觸發鈕寬度有變（前提）').toBeGreaterThan(5)
      expect(span(pts(tr, 'menu', 'x')), `面板 x：${fmt(pts(tr, 'menu', 'x'))}`).toBeLessThanOrEqual(1)
    })
  })
}

/** 沒勾人時疊的前三位 PM（m1–m3 依 portfolio 順序）用 data-probe 追：離場後選擇器就找不到。 */
async function probeAvatars(page: Page): Promise<string[]> {
  return page.evaluate((PM) => {
    const avs = [...document.querySelectorAll(`${PM} .mp-stack .avatar`)]
    avs.forEach((el, i) => el.setAttribute('data-probe', `av${i}`))
    return avs.map((_, i) => `[data-probe="av${i}"]`)
  }, PM)
}

for (const dir of ['勾', '取消'] as const) {
  test(`T6 ${dir}成員10：觸發鈕寬度、它左邊的搜尋框與每顆頭像逐幀連續；「…」與人數淡入淡出（T14）`, async ({ page }) => {
    const { tr, avs } = await measure(page, async () => {
      await gotoOverview(page)
      await page.locator(`${PM} .dd-trigger`).click()
      if (dir === '取消') await page.locator(`${PM} [data-pm-option="m10"]`).click()
      await idle(page)
      const avs = await probeAvatars(page)
      const targets: Record<string, string> = {
        trig: `${PM} .dd-trigger`,
        search: '.top-row .search',
        more: `${PM} .mp-more`,
        count: `${PM} .mp-count`,
        m10: `${PM} .mp-stack [title="成員10"]`,
      }
      avs.forEach((s, i) => (targets[`av${i}`] = s))
      const tr = await trace(page, targets, () => clickInPage(page, `${PM} [data-pm-option="m10"]`))
      return { value: { tr, avs }, valid: calm(tr, tr.at, 350) }
    })
    const trig = pts(tr, 'trig', 'x')
    expect(span(trig), '觸發鈕左緣有移動（前提）').toBeGreaterThan(20)
    expect(speedJumps(trig), `觸發鈕左緣 x：${fmt(trig)}`).toBe(0)
    expect(reverses(trig.map((p) => p.v)), `觸發鈕左緣單調：${fmt(trig)}`).toBe(false)
    const search = pts(tr, 'search', 'x')
    expect(speedJumps(search), `搜尋框 x：${fmt(search)}`).toBe(0)
    for (let i = 0; i < avs.length; i++) {
      const av = pts(tr, `av${i}`, 'cx')
      expect(speedJumps(av), `av${i} cx：${fmt(av)}`).toBe(0)
    }
    expect(speedJumps(pts(tr, 'm10', 'cx')), `成員10 cx：${fmt(pts(tr, 'm10', 'cx'))}`).toBe(0)
    expect(hasMid(series(tr, 'more').map((b) => b.o)), '「…」淡入淡出').toBe(true)
    expect(hasMid(series(tr, 'count').map((b) => b.o)), '人數淡入淡出').toBe(true)
  })
}

test('篩選項 FLIP：狀態下拉勾第一項，觸發鈕變寬，左邊的成員觸發鈕與搜尋框滑過去', async ({ page }) => {
  const tr = await measure(page, async () => {
    await gotoOverview(page)
    await page.locator(`${STATUS} .dd-trigger`).click()
    await idle(page)
    const tr = await trace(page, { search: '.top-row .search', pm: `${PM} .dd-trigger` }, () =>
      clickInPage(page, `${STATUS} .dd-item`),
    )
    return { value: tr, valid: calm(tr, tr.at, 350) }
  })
  for (const n of ['search', 'pm']) {
    const p = pts(tr, n, 'x')
    expect(span(p), `${n} 有移動（前提）`).toBeGreaterThan(5)
    // 10px 的單幀瞬移：speedJumps 的門檻是 8px，抓得到
    expect(speedJumps(p), `${n} x：${fmt(p)}`).toBe(0)
  }
})

for (const dir of ['勾', '取消'] as const) {
  test(`T14 成員面板${dir}第一位：「已選 N 位」淡入淡出、「清除勾選」那列原地${dir === '勾' ? '長出' : '收起'}（面板高度逐幀連續）`, async ({ page }) => {
    const tr = await measure(page, async () => {
      await gotoOverview(page)
      await page.locator(`${PM} .dd-trigger`).click()
      if (dir === '取消') await page.locator(`${PM} [data-pm-option="m10"]`).click()
      await idle(page)
      const tr = await trace(page, { menu: `${PM} .dd-menu`, sub: `${PM} .mp-sub`, tools: `${PM} .mp-btn` }, () =>
        clickInPage(page, `${PM} [data-pm-option="m10"]`),
      )
      return { value: tr, valid: calm(tr, tr.at, 350) }
    })
    const h = pts(tr, 'menu', 'h')
    expect(span(h), '面板高度有變（前提）').toBeGreaterThan(20)
    expect(speedJumps(h), `面板高度：${fmt(h)}`).toBe(0)
    expect(hasMid(series(tr, 'sub').map((b) => b.o)), '「已選 N 位」淡入淡出').toBe(true)
    expect(hasMid(series(tr, 'tools').map((b) => b.o)), '「清除勾選」淡入淡出').toBe(true)
  })
}

test('T7 排序選單開著加一層：選單不動，排序鈕逐幀滑過去', async ({ page }) => {
  const tr = await measure(page, async () => {
    await gotoOverview(page)
    await page.locator(`${CARDS} .sort-trigger`).click()
    await idle(page)
    const tr = await trace(page, { trig: `${CARDS} .sort-trigger`, menu: `${CARDS} .sort-menu`, chip: `${CARDS} .sorts > :nth-child(3)` }, () =>
      page.evaluate((CARDS) => {
        const at = performance.now() - (window as unknown as { __trace: { t0: number } }).__trace.t0
        ;[...document.querySelectorAll<HTMLElement>(`${CARDS} .sort-option`)].find((b) => b.textContent?.includes('專案開始日'))!.click()
        return at
      }, CARDS),
    )
    return { value: tr, valid: calm(tr, tr.at, 350) }
  })
  const trig = pts(tr, 'trig', 'x')
  expect(span(trig), '排序鈕有移動（前提）').toBeGreaterThan(50)
  expect(speedJumps(trig), `排序鈕 x：${fmt(trig)}`).toBe(0)
  expect(span(pts(tr, 'menu', 'x')), `選單 x：${fmt(pts(tr, 'menu', 'x'))}`).toBeLessThanOrEqual(1)
  expect(hasMid(series(tr, 'chip').map((b) => b.o)), '新 chip 淡入').toBe(true)
})

test('T7 移除一層（✕）：排序鈕逐幀滑過去，不蓋到淡出中的 chip', async ({ page }) => {
  const tr = await measure(page, async () => {
    await gotoOverview(page)
    const tr = await trace(page, { trig: `${CARDS} .sort-trigger`, chip: `${CARDS} .sorts > :nth-child(2)` }, () =>
      clickInPage(page, `${CARDS} .sorts > :nth-child(2) .chip-x`),
    )
    return { value: tr, valid: calm(tr, tr.at, 350) }
  })
  const trig = pts(tr, 'trig', 'x')
  expect(span(trig), '排序鈕有移動（前提）').toBeGreaterThan(50)
  expect(speedJumps(trig), `排序鈕 x：${fmt(trig)}`).toBe(0)
  // 修正前 chip 離場是 absolute、.sorts 當幀縮短，排序鈕跳到還在淡出的 chip 上面
  const overlap = tr.frames.filter((f) => {
    const c = f.boxes.chip
    const t = f.boxes.trig
    return c && t && c.o > 0.05 && t.x < c.x + c.w - 1
  })
  expect(overlap, '排序鈕蓋到看得見的離場 chip 的幀').toHaveLength(0)
})

test('兩個 chip 一起離場：離場的 chip 不往下掉', async ({ page }) => {
  const { tr, names } = await measure(page, async () => {
    await gotoOverview(page)
    await expect(page.locator(`${CARDS} .sorts > *`), '預設兩層排序').toHaveCount(2)
    const names = ['c0', 'c1']
    const tr = await trace(page, { c0: `${CARDS} .sorts > :nth-child(1) .sort-chip`, c1: `${CARDS} .sorts > :nth-child(2) .sort-chip` }, () =>
      page.evaluate((CARDS) => {
        const at = performance.now() - (window as unknown as { __trace: { t0: number } }).__trace.t0
        const xs = [...document.querySelectorAll<HTMLElement>(`${CARDS} .sorts .chip-x`)]
        xs[1]!.click()
        // 同一個 task 裡再刪第一層：兩個在同一次更新一起離場
        xs[0]!.click()
        return at
      }, CARDS),
    )
    return { value: { tr, names }, valid: calm(tr, tr.at, 350) }
  })
  for (const n of names) {
    const ys = series(tr, n).filter((b) => b.o > 0.05).map((b) => ({ t: b.t, v: b.y }))
    expect(ys.length, `${n} 有看得見的幀`).toBeGreaterThan(3)
    expect(span(ys), `${n} y：${fmt(ys)}`).toBeLessThanOrEqual(1)
  }
})

test.describe('平板直向', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('T15 加一層排序：新 chip 捲進 .sorts 的可見範圍，捲動逐幀連續', async ({ page }) => {
    const tr = await measure(page, async () => {
      await gotoOverview(page)
      await page.locator(`${CARDS} .sort-trigger`).click()
      await idle(page)
      const tr = await trace(page, { sorts: `${CARDS} .sorts`, chip: `${CARDS} .sorts > :nth-child(3)` }, () =>
        page.evaluate((CARDS) => {
          const at = performance.now() - (window as unknown as { __trace: { t0: number } }).__trace.t0
          ;[...document.querySelectorAll<HTMLElement>(`${CARDS} .sort-option`)].find((b) => b.textContent?.includes('專案開始日'))!.click()
          return at
        }, CARDS),
      )
      return { value: tr, valid: calm(tr, tr.at, 350) }
    })
    const last = tr.frames[tr.frames.length - 1]!.boxes
    const sorts = last.sorts!
    const chip = last.chip!
    expect(chip.x + chip.w, `新 chip 右緣（${(chip.x + chip.w).toFixed(1)}）在 .sorts 右緣（${(sorts.x + sorts.w).toFixed(1)}）以內`).toBeLessThanOrEqual(sorts.x + sorts.w + 1)
    expect(chip.x, '新 chip 左緣在 .sorts 左緣以內').toBeGreaterThanOrEqual(sorts.x - 1)
    // 捲動會帶著第一個 chip 往左：逐幀連續，不是一幀捲到底
    const first = pts(tr, 'chip', 'x', tr.at)
    expect(speedJumps(first), `新 chip x：${fmt(first)}`).toBe(0)
  })
})
