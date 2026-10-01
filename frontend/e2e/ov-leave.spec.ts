import { expect, test } from '@playwright/test'
import {
  drift,
  endSnap,
  gotoOverview,
  idle,
  jumpCount,
  opacityJumps,
  pause,
  probe,
  series,
  speedJumps,
  trace,
  type Box,
  type Trace,
} from './helpers/ovMotion'

/** 總覽清單的離場（動畫稽核 R1：T1、C4、C2 e）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

test('helper 自我檢查：量得到平順過渡、抓得到瞬移與結尾跳、Date 固定而 rAF 是真的', async ({ page }) => {
  await gotoOverview(page)
  expect(await page.evaluate(() => new Date().toISOString().slice(0, 10))).toBe('2026-09-18')
  await page.evaluate(() => {
    const mk = (id: string, css: string): void => {
      const d = document.createElement('div')
      d.id = id
      d.style.cssText = `position:fixed;left:0;top:0;width:40px;height:40px;${css}`
      document.body.appendChild(d)
    }
    mk('p-smooth', 'transition:top 260ms cubic-bezier(0.4,0,0.2,1)')
    mk('p-snap', '')
    mk('p-tail', 'transition:top 260ms cubic-bezier(0.4,0,0.2,1)')
  })
  const tr = await trace(page, { smooth: '#p-smooth', snap: '#p-snap', tail: '#p-tail' }, () =>
    page.evaluate(() => {
      ;(document.getElementById('p-smooth') as HTMLElement).style.top = '300px'
      ;(document.getElementById('p-snap') as HTMLElement).style.top = '300px'
      const tail = document.getElementById('p-tail') as HTMLElement
      tail.style.top = '100px'
      // 照緩出曲線收斂到 100px（最後幾幀每幀不到 1px），過渡結束才一次跳 6px：
      // 模擬 demo 的「結尾小幅瞬移」（間距 / 框線留在收合層外，收完剩 6px 一次消失）。
      // 等速走到九成再跳不算：每幀本來就走 8px，跳 14px 不到前一步的 3 倍，endSnap 照定義不抓。
      tail.addEventListener(
        'transitionend',
        () => {
          tail.style.transition = 'none'
          tail.style.top = '106px'
        },
        { once: true },
      )
    }),
  )
  const ys = (name: string) => series(tr, name).map((b) => ({ t: b.t, dt: b.dt, v: b.y }))
  expect(tr.frames.length, '有錄到幀').toBeGreaterThan(20)
  expect(jumpCount(ys('smooth')), '平順過渡不算瞬移').toBe(0)
  expect(jumpCount(ys('snap')), '一幀到位算瞬移').toBe(1)
  expect(speedJumps(ys('snap')), '速度判斷也抓得到').toBeGreaterThan(0)
  expect(endSnap(ys('smooth').map((p) => p.v)), '平順收斂不算結尾跳').toBe(false)
  expect(endSnap(ys('tail').map((p) => p.v)), '結尾小幅瞬移').toBe(true)
})

/** 中心點 x。 */
const cx = (b: Box): number => b.x + b.w / 2

/** 錄製結束時已經不在畫面上的（離場的）那幾個名稱。 */
function gone(tr: Trace, names: string[]): string[] {
  const last = tr.frames[tr.frames.length - 1]!
  return names.filter((n) => last.boxes[n] === null)
}

/** from 之前的最後一幀當起點，接著 from 之後的每一幀（同 series 的 from）。 */
function since<T extends { t: number }>(pts: T[], from: number): T[] {
  const before = pts.filter((p) => p.t < from).at(-1)
  return (before ? [before] : []).concat(pts.filter((p) => p.t >= from))
}

/**
 * 離場元素從 from（開始離場的時間）到看不見為止的位移：原地淡出應 ≤ 4px。
 * 離場前還在補位移動的元素（例：連刪的第二個 chip）要給 from，否則會把離場前正常的補位也算進去。
 */
function expectStill(tr: Trace, name: string, from = -Infinity): void {
  const d = drift(series(tr, name, from))
  expect(d, `${name} 有樣本`).not.toBeNaN()
  expect(d, `${name} 位移`).toBeLessThanOrEqual(4)
}

/** 某元素相對 ref 元素左上角的逐幀位置；兩者都在畫面上的幀才算。 */
function relSeries(tr: Trace, name: string, ref: string): (Box & { t: number; dt: number })[] {
  return tr.frames
    .filter((f) => f.boxes[name] && f.boxes[ref])
    .map((f) => {
      const b = f.boxes[name]!
      const r = f.boxes[ref]!
      return { ...b, x: b.x - r.x, y: b.y - r.y, t: f.t, dt: f.dt }
    })
}

/*
 * 離場的時間要在頁面裡、和觸發更新同一個 task 取（trace 時間軸＝helpers/ovMotion 錄製狀態 __ovTrace 的 t0 起算）：
 * 從 Playwright 端先問時間再操作，中間隔一次往返，可能正好夾著一幀還在移動的畫面，被算成離場後的位移。
 */
type TraceWindow = Window & { __ovTrace: { t0: number } }

test('勾成員 m10：離場的頭像各自原地淡出（T1）', async ({ page }) => {
  await gotoOverview(page)
  // 沒勾人時疊前三位 PM；勾 m10 後只剩 m10，前三位同一次更新一起離場
  const avs = await probe(page, '[data-ov-dd="pm"] .mp-stack > *', 'av')
  expect(avs).toHaveLength(3)
  await page.locator('[data-ov-dd="pm"] button.dd-trigger').click()
  await idle(page)
  const names = avs.map((_, i) => `av${i}`)
  const tr = await trace(page, Object.fromEntries(avs.map((s, i) => [names[i]!, s])), () =>
    page.locator('[data-ov-dd="pm"] [data-pm-option="m10"]').click(),
  )
  expect(gone(tr, names), '三個一起離場').toEqual(names)
  /*
   * 頭像疊在靠右對齊的觸發鈕裡：三個離場（absolute）、只進一個，觸發鈕當幀變窄約 30px，整疊頭像跟著平順右移
   * （觸發鈕寬度瞬變屬批次 C 的 T6，不在這裡量）。這裡量「各自原地」：離場的頭像彼此的間距不變——
   * 修正前第二、三個量到前一個已經 absolute 之後的版面，滑到第一個的位置疊成一團（R1）。
   */
  const all = tr.frames.filter((f) => names.every((n) => (f.boxes[n]?.o ?? 0) > 0.05))
  expect(all.length, '三個都看得見的幀').toBeGreaterThan(5)
  for (const n of names.slice(1)) {
    const gaps = all.map((f) => cx(f.boxes[n]!) - cx(f.boxes[names[0]!]!))
    expect(Math.max(...gaps) - Math.min(...gaps), `${n} 與 av0 的間距變化`).toBeLessThanOrEqual(4)
  }
  for (const n of names) {
    expect(jumpCount(series(tr, n).map((b) => ({ dt: b.dt, v: cx(b) }))), `${n} 單幀瞬移`).toBe(0)
  }
})

test('100ms 內連刪兩個排序 chip：兩個各自原地淡出，留下的從看得到的位置接續', async ({ page }) => {
  await gotoOverview(page)
  const P = '[data-view-panel="cards"]'
  // 先多加一層（共三個）：只有兩個時全部離場，.sorts 塌成 0 高、垂直置中讓離場的 chip 一起下移 14px（批次 C 的元件樣式）
  await page.locator(`${P} .sort-trigger`).click()
  await page.locator(`${P} .sort-option`, { hasText: '專案開始日' }).click()
  await page.keyboard.press('Escape')
  await idle(page)
  const chips = await probe(page, `${P} .sorts > *`, 'chip')
  expect(chips).toHaveLength(3)
  const names = chips.map((_, i) => `c${i}`)
  let t2 = 0
  const tr = await trace(page, Object.fromEntries(chips.map((s, i) => [names[i]!, s])), async () => {
    t2 = await page.evaluate((P) => {
      // 第二下要點「還留著的」第一個 chip：離場中的 chip 還在 DOM 裡，點到它只會再刪一次同一個鍵
      const firstX = (): HTMLElement =>
        document.querySelector(`${P} .sorts > :not(.ov-chip-leave-active) .chip-x`) as HTMLElement
      firstX().click()
      return new Promise<number>((resolve) =>
        setTimeout(() => {
          firstX().click()
          resolve(performance.now() - (window as unknown as TraceWindow).__ovTrace.t0)
        }, 100),
      )
    }, P)
  })
  expect(gone(tr, names), '刪掉的兩個').toEqual(['c0', 'c1'])
  expectStill(tr, 'c0')
  // c1 在 0–100ms 補位往左移，第二下時位移到一半：釘在當下看得到的位置、取消位移的過渡
  expectStill(tr, 'c1', t2)
  // c2 一直在補位：第二次更新時 Vue 拿掉 move class，進行中的位移要被取消（overview-motion.css 的 :where 規則），
  // 否則 Vue 量到殘留位移、當幀往前跳一段（拿掉規則時約 45px）；有取消時這一幀停在原處，之後重新起步
  const c2 = since(series(tr, 'c2'), t2)
  expect(c2.length, 'c2 有第二次更新後的幀').toBeGreaterThan(2)
  expect(Math.abs(cx(c2[1]!) - cx(c2[0]!)), 'c2 第二次更新當幀的位移').toBeLessThanOrEqual(8)
})

test('清除排序：多出來的 chip 同時各自原地淡出', async ({ page }) => {
  await gotoOverview(page)
  const P = '[data-view-panel="cards"]'
  // 清除排序是回到預設（落後、到期日兩層），先多加兩層，清除時這兩層同一次更新一起離場
  await page.locator(`${P} .sort-trigger`).click()
  await page.locator(`${P} .sort-option`, { hasText: '專案開始日' }).click()
  await page.locator(`${P} .sort-option`, { hasText: 'Issue 數量' }).click()
  await idle(page)
  const chips = await probe(page, `${P} .sorts > *`, 'chip')
  expect(chips).toHaveLength(4)
  const names = chips.map((_, i) => `c${i}`)
  const tr = await trace(page, Object.fromEntries(chips.map((s, i) => [names[i]!, s])), () =>
    page.locator(`${P} .sort-clear`).click(),
  )
  expect(gone(tr, names), '多加的兩層').toEqual(['c2', 'c3'])
  expectStill(tr, 'c2')
  expectStill(tr, 'c3')
})

test('排序位移途中被篩掉的卡：照常淡出、相對泳道原地不瞬移（C2 e）', async ({ page }) => {
  await gotoOverview(page)
  const search = page.getByTestId('overview-search')
  const [pay] = await probe(page, '[data-view-panel="cards"] [data-project="payment"]', 'pay')
  const body = '[data-view-panel="cards"] [data-pm-col="m5"] .lane-body'
  let t2 = 0
  // 「金流」只剩 m5 的 payment（往泳道第一格 FLIP）；100ms 後改成「p」剩 m5 pmis、m8 app，payment 在 FLIP 途中離場
  const tr = await trace(page, { pay: pay!, body }, async () => {
    await search.fill('金流')
    await pause(page, 100)
    t2 = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="overview-search"]') as HTMLInputElement
      input.value = 'p'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return performance.now() - (window as unknown as TraceWindow).__ovTrace.t0
    })
  })
  expect(tr.frames.at(-1)!.boxes.pay, 'payment 最後離場').toBeNull()
  const rel = relSeries(tr, 'pay', 'body')
  const before = rel.filter((p) => p.t < t2)
  expect(before.length).toBeGreaterThan(2)
  expect(Math.abs(before.at(-1)!.x - before.at(-2)!.x), '篩掉時 payment 正在位移').toBeGreaterThan(1)
  expect(opacityJumps(rel), '透明度單幀跳').toBe(false)
  /*
   * 不瞬移、原地：從篩掉前的最後一幀起，相對泳道的位移 ≤ 4px（釘在含 FLIP 位移的看得到的位置；修正前釘在版面位置，
   * 或沿著沒取消的 FLIP 繼續滑）。不用 jumpCount 量整段：FLIP 被打斷的位置每次不同，全距小時正常的一幀位移也會超過一半。
   */
  const d = drift(since(rel, t2))
  expect(d, '離場後有樣本').not.toBeNaN()
  expect(d, '離場後相對泳道的位移').toBeLessThanOrEqual(4)
})
