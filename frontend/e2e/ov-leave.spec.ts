import { expect, test, type Page } from '@playwright/test'
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

/** 某元素逐幀的左緣 x（原地收起的 chip / 頭像：左緣不動或隨前面的項目連續移動，不會單幀跳）。 */
const xs = (tr: Trace, name: string, from = -Infinity): { t: number; v: number }[] =>
  series(tr, name, from).map((b) => ({ t: b.t, v: b.x }))

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

test('勾成員 m10：離場的頭像原地收起淡出，不疊成一團（T1）', async ({ page }) => {
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
   * 頭像疊是原地收合（批次 C，T6）：離場的頭像留在版面流裡，寬度與透明度一起收到 0，彼此的間距跟著透明度一起縮。
   * 量「不疊成一團」：還很看得見（透明度 > 0.5）的幀，間距至少是原本的四成——批次 B 之前是 absolute 釘位，
   * 第二、三個量到前一個已經 absolute 之後的版面，還不透明就滑到第一個的位置疊成一團（R1）。
   */
  const opaque = tr.frames.filter((f) => names.every((n) => (f.boxes[n]?.o ?? 0) > 0.5))
  expect(opaque.length, '三個都還很看得見的幀').toBeGreaterThan(2)
  const gap0 = cx(opaque[0]!.boxes[names[1]!]!) - cx(opaque[0]!.boxes[names[0]!]!)
  expect(gap0, '原本的間距（前提）').toBeGreaterThan(10)
  for (const f of opaque) {
    for (let i = 1; i < names.length; i++) {
      const gap = cx(f.boxes[names[i]!]!) - cx(f.boxes[names[i - 1]!]!)
      expect(gap, `${names[i]} 與 ${names[i - 1]} 的間距（${f.t.toFixed(0)}ms）`).toBeGreaterThan(0.4 * gap0)
    }
  }
  for (const n of names) {
    expect(jumpCount(series(tr, n).map((b) => ({ dt: b.dt, v: cx(b) }))), `${n} 單幀瞬移`).toBe(0)
  }
})

test('100ms 內連刪兩個排序 chip：兩個各自原地收起，留下的從看得到的位置接續', async ({ page }) => {
  await gotoOverview(page)
  const P = '[data-view-panel="cards"]'
  // 先多加一層（共三個），刪前兩個：留下的第三個要一路補位到最前面（兩個一起離場的情況在 ov-chrome-motion.spec）
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
  /*
   * chip 是原地收合（批次 C，T7）：離場的留在版面流裡收到 0 寬，後面的跟著版面逐幀補位、沒有 transform 位移可以被打斷。
   * c0 左緣不動；c1 在 0–100ms 跟著 c0 收起往左移、第二下後自己也開始收；c2 一路補位到最前面。都不能有單幀跳。
   */
  for (const n of names) {
    const p = xs(tr, n)
    expect(speedJumps(p), `${n} x：${p.map((q) => q.v.toFixed(1)).join(' ')}`).toBe(0)
  }
  // 第二次更新（t2）之後 c2 繼續補位（上面的速度檢查涵蓋第二次更新當幀），最後補到原本第一個的位置
  const c2 = since(series(tr, 'c2'), t2)
  expect(c2.length, 'c2 有第二次更新後的幀').toBeGreaterThan(2)
  expect(Math.abs(c2.at(-1)!.x - series(tr, 'c0')[0]!.x), 'c2 最後補到原本第一個的位置').toBeLessThanOrEqual(1)
})

test('清除排序：多出來的 chip 同時各自原地收起', async ({ page }) => {
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
  // 原地收起：留在原位收到 0 寬（c3 跟著 c2 收起往左移），逐幀連續；留下的兩層不動
  for (const n of names) {
    const p = xs(tr, n)
    expect(speedJumps(p), `${n} x：${p.map((q) => q.v.toFixed(1)).join(' ')}`).toBe(0)
  }
  for (const n of ['c0', 'c1']) {
    const p = xs(tr, n).map((q) => q.v)
    expect(Math.max(...p) - Math.min(...p), `${n} 不動`).toBeLessThanOrEqual(1)
  }
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

/*
 * 淡入中被移除（spec 成功條件「進場中的元素 opacity 不跳到 1」的離場面）：Vue 取消進場、拿掉 *-enter-active 之後，
 * 先呼叫 @before-leave（freezeLeave）才加 *-leave-active。freezeLeave 量版面逼瀏覽器重算樣式，這時元素自己的
 * transition 清單沒有 opacity / transform，進行中的淡入與放大被取消：透明度當幀跳回 1、尺寸跳回原大，再從實心淡出。
 */

/**
 * 從移除那一刻（t2，頁面裡和觸發同一個 task 取）起的逐幀樣本（含移除前最後一幀）；先確認情境成立：移除時正在淡入、最後離場。
 * 呼叫端量「透明度從當下接續，不先跳回實心」：Vue 下一幀才加 *-leave-to，移除後一兩幀還會照進場的曲線多亮一點，
 * 之後才反向淡出——所以不量「只降不升」，量沒有單幀跳、最亮不到實心。修正前移除後的第一幀透明度就是 1。
 */
function sinceRemoval(tr: Trace, name: string, t2: number): (Box & { t: number; dt: number })[] {
  const s = series(tr, name, t2)
  const at = s[0]
  expect(at && at.t < t2, `${name} 移除前有樣本`).toBe(true)
  expect(at!.o, `${name} 移除時正在淡入`).toBeGreaterThan(0.05)
  expect(at!.o, `${name} 移除時還沒淡入完`).toBeLessThan(0.8)
  expect(tr.frames.at(-1)!.boxes[name], `${name} 最後離場`).toBeNull()
  expect(s.length, `${name} 移除後有樣本`).toBeGreaterThan(5)
  return s
}

test('淡入中的卡被篩掉：透明度與縮放從當下接續淡出，不先跳回實心', async ({ page }) => {
  await gotoOverview(page)
  await page.getByTestId('overview-search').fill('p')
  await idle(page)
  // 「p」剩 m5 pmis、m8 app；清除後 portal 在 m8 泳道淡入，100ms 後篩「a」只剩 app：淡入中的 portal 被篩掉（m8 泳道留著）
  let t2 = 0
  const tr = await trace(page, { portal: '[data-view-panel="cards"] [data-project="portal"]' }, async () => {
    t2 = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          ;(document.querySelector('[data-testid="overview-clear"]') as HTMLElement).click()
          setTimeout(() => {
            const input = document.querySelector('[data-testid="overview-search"]') as HTMLInputElement
            input.value = 'a'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            resolve(performance.now() - (window as unknown as TraceWindow).__ovTrace.t0)
          }, 100)
        }),
    )
  })
  const s = sinceRemoval(tr, 'portal', t2)
  expect(Math.max(...s.map((b) => b.o)), '移除後最亮').toBeLessThan(0.95)
  expect(opacityJumps(s), '透明度單幀跳').toBe(false)
  // 進場的放大也接續（修正前寬度當幀長約 10px 回原尺寸）。卡片的重排不走內建 move，離場的卡不會被 Vue 再加位移
  expect(jumpCount(s.map((b) => ({ dt: b.dt, v: b.w }))), '縮放單幀跳').toBe(0)
})

/** 頁內點擊的對象：選擇器，加 text 時取文字含 text 的那一個。 */
interface Click {
  sel: string
  text?: string
}

/** 長幀：兩幀間隔超過這麼久，過渡在這段時間裡一次走一大截，量不到「從當下接續」。 */
const LONG_FRAME_MS = 50

/**
 * 「淡入中被移除」的錄影，含前提檢查（同 page-motion.spec 的 G9）：頁內點 add，逐幀（rAF）看 watch 的透明度，
 * 淡入走到 0.15 以上的那一幀就點 remove——不用固定毫秒數：進場要等 Vue 隔兩幀才起步，機器忙時 80ms 可能還沒開始淡入、
 * 也可能已經淡入完。前提：點 remove 時還在淡入途中（< 0.6），而且之後 150ms 沒有長幀；不成立就 prep 重來，最多 3 次。
 * 回傳錄影與點 remove 的時間（trace 時間軸）。
 */
async function traceRemoveWhileEntering(
  page: Page,
  prep: () => Promise<void>,
  a: { add: Click; remove: Click; watch: string },
): Promise<{ tr: Trace; t2: number }> {
  let tr!: Trace
  let r = { t: 0, o: 1 }
  let valid = false
  for (let attempt = 0; attempt < 3 && !valid; attempt++) {
    await prep()
    tr = await trace(page, { el: a.watch }, async () => {
      r = await page.evaluate(
        (a) =>
          new Promise<{ t: number; o: number }>((resolve, reject) => {
            const t0 = (window as unknown as TraceWindow).__ovTrace.t0
            const find = (c: { sel: string; text?: string }): HTMLElement =>
              (c.text
                ? [...document.querySelectorAll<HTMLElement>(c.sel)].find((e) => e.textContent?.includes(c.text!))
                : document.querySelector<HTMLElement>(c.sel))!
            find(a.add).click()
            const start = performance.now()
            const tick = (): void => {
              const el = document.querySelector(a.watch)
              const o = el ? parseFloat(getComputedStyle(el).opacity) : 0
              if (o > 0.15) {
                find(a.remove).click()
                resolve({ t: performance.now() - t0, o })
              } else if (performance.now() - start > 2000) reject(new Error('2 秒內沒有開始淡入'))
              else requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }),
        a,
      )
    })
    valid = r.o < 0.6 && tr.frames.every((f) => f.t < r.t || f.t > r.t + 150 || f.dt <= LONG_FRAME_MS)
  }
  expect(valid, `3 次都沒在淡入途中移除、或移除後碰上長幀（機器太忙；最後一次移除時 ${r.o.toFixed(2)}）`).toBe(true)
  return { tr, t2: r.t }
}

test('加一層排序、淡入途中清除排序：淡入中的 chip 從當下接續淡出，不先跳回實心', async ({ page }) => {
  const P = '[data-view-panel="cards"]'
  // 預設兩層；加「專案開始日」成第三個 chip 淡入，淡入途中清除排序回預設：淡入中的第三個 chip 離場
  const { tr, t2 } = await traceRemoveWhileEntering(
    page,
    async () => {
      await gotoOverview(page)
      await page.locator(`${P} .sort-trigger`).click()
      await idle(page)
      await expect(page.locator(`${P} .sorts > *`), '預設兩層').toHaveCount(2)
    },
    {
      add: { sel: `${P} .sort-option`, text: '專案開始日' },
      remove: { sel: `${P} .sort-clear` },
      watch: `${P} .sorts > :nth-child(3)`,
    },
  )
  const s = sinceRemoval(tr, 'el', t2)
  expect(Math.max(...s.map((b) => b.o)), '移除後最亮').toBeLessThan(0.95)
  expect(opacityJumps(s), '透明度單幀跳').toBe(false)
})

test('勾了成員、淡入途中又取消：淡入中的頭像從當下接續淡出，不先跳回實心', async ({ page }) => {
  // 勾 m10：頭像疊只剩 m10（淡入）；淡入途中取消：回到前三位，淡入中的 m10 頭像離場
  // 追頭像外層（.ov-slot）：淡入淡出寫在外層，頭像本身的透明度一直是 1
  const m10 = { sel: '[data-ov-dd="pm"] [data-pm-option="m10"]' }
  const { tr, t2 } = await traceRemoveWhileEntering(
    page,
    async () => {
      await gotoOverview(page)
      await page.locator('[data-ov-dd="pm"] button.dd-trigger').click()
      await idle(page)
    },
    { add: m10, remove: m10, watch: '[data-ov-dd="pm"] .mp-stack > :has([title="成員10"])' },
  )
  const s = sinceRemoval(tr, 'el', t2)
  expect(Math.max(...s.map((b) => b.o)), '移除後最亮').toBeLessThan(0.95)
  expect(opacityJumps(s), '透明度單幀跳').toBe(false)
})
