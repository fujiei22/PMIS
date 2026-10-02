import { expect, test, type Page } from '@playwright/test'
import { gotoOverview, idle, jumpCount, opacityJumps, pause, series, trace, type Trace } from './helpers/ovMotion'

/** 時間軸的銜接（動畫稽核 T9、T10、T13、T17）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

const T = '[data-view-panel="timeline"]'

/** 開時間軸、記下掛載時「今天」置中的位置，再捲回最左邊，讓「今天」按鈕有一段距離可以捲。 */
async function fromStart(page: Page): Promise<number> {
  await gotoOverview(page, '#timeline')
  const body = page.locator(`${T} .tl-body`)
  const today = await body.evaluate((el) => el.scrollLeft)
  await body.evaluate((el) => {
    el.scrollLeft = 0
  })
  await idle(page)
  return today
}

/** t 之後第一幀某元素的透明度；已經拿掉（或 display: none）算 0，沒錄到那一幀回 NaN（斷言會失敗）。 */
function opacityAt(tr: Trace, name: string, t: number): number {
  const f = tr.frames.find((x) => x.t >= t)
  return f ? (f.boxes[name]?.o ?? 0) : NaN
}

/**
 * 1920 寬時整段範圍幾乎都看得到（最多只能捲 155px），今天置中會被夾到 0，「今天」按鈕從最左邊按下去根本不捲。
 * 改用一般筆電寬（1280，仍是桌面版左欄），今天置中約在 303px，從最左邊按才捲得出好幾幀。
 */
test.describe('今天捲動（T10）', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('今天平滑捲動：每次捲動事件時尺規與捲軸已經和畫布對齊（T10）', async ({ page }) => {
    const today = await fromStart(page)
    expect(today, '今天離範圍起點夠遠，捲得出好幾幀').toBeGreaterThan(200)
    await page.evaluate(() => {
      const b = document.querySelector('[data-view-panel="timeline"] .tl-body') as HTMLElement
      const r = document.querySelector('[data-view-panel="timeline"] .tl-ruler') as HTMLElement
      const h = document.querySelector('[data-view-panel="timeline"] .tl-hbar') as HTMLElement
      const w = window as unknown as { __lag: { ruler: number[]; bar: number[] } }
      w.__lag = { ruler: [], bar: [] }
      // 捕獲階段：比 App 自己在 .tl-body 上的同步處理早，量到的是「這一幀畫出來時」尺規有沒有跟上
      document.addEventListener(
        'scroll',
        (e) => {
          if (e.target !== b) return
          w.__lag.ruler.push(Math.abs(b.scrollLeft - r.scrollLeft))
          w.__lag.bar.push(Math.abs(b.scrollLeft - h.scrollLeft))
        },
        { capture: true, passive: true },
      )
    })
    await page.getByTestId('overview-today').click()
    await pause(page, 1300)
    const lag = await page.evaluate(() => (window as unknown as { __lag: { ruler: number[]; bar: number[] } }).__lag)
    expect(lag.ruler.length, '有捲動').toBeGreaterThan(5)
    expect(Math.max(...lag.ruler), '尺規落後畫布（px）').toBeLessThanOrEqual(1)
    expect(Math.max(...lag.bar), '底下的捲軸落後畫布（px）').toBeLessThanOrEqual(1)
    expect(
      Math.abs((await page.locator(`${T} .tl-body`).evaluate((el) => el.scrollLeft)) - today),
      '停在和掛載時一樣的「今天」置中位置',
    ).toBeLessThanOrEqual(1)
  })

  test('今天捲動途中滾輪：補間立刻停', async ({ page }) => {
    await fromStart(page)
    const body = page.locator(`${T} .tl-body`)
    await page.getByTestId('overview-today').click()
    await pause(page, 150)
    const box = (await body.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 40)
    await page.mouse.wheel(0, 40)
    const a = await body.evaluate((el) => el.scrollLeft)
    expect(a, '補間已經開始').toBeGreaterThan(0)
    await pause(page, 400)
    expect(Math.abs((await body.evaluate((el) => el.scrollLeft)) - a), '停了之後不再往今天走').toBeLessThanOrEqual(2)
  })

  test('今天捲動途中拖曳畫布：補間立刻停，放手停在拖到的位置', async ({ page }) => {
    await fromStart(page)
    const body = page.locator(`${T} .tl-body`)
    // 記下按下那一刻的位置（原生捕獲 listener，不經過 Vue）
    await body.evaluate((el) => {
      const w = window as unknown as { __downLeft: number }
      w.__downLeft = -1
      el.addEventListener('pointerdown', () => (w.__downLeft = el.scrollLeft), { capture: true })
    })
    await page.getByTestId('overview-today').click()
    await pause(page, 150)
    // 從畫布中段往右拖 80px（畫面往回捲、離開今天；左欄、速覽不平移）：補間沒停的話會把位置搶回今天
    const box = (await body.boundingBox())!
    const x = box.x + box.width * 0.6
    const y = box.y + 60
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 80, y, { steps: 8 })
    await page.mouse.up()
    const down = await page.evaluate(() => (window as unknown as { __downLeft: number }).__downLeft)
    expect(down, '按下時補間已經開始').toBeGreaterThan(0)
    await pause(page, 400)
    expect(
      Math.abs((await body.evaluate((el) => el.scrollLeft)) - Math.max(0, down - 80)),
      '停在拖到的位置（按下時的位置往回 80px），沒有被拉回今天',
    ).toBeLessThanOrEqual(2)
  })
})

test.describe('速覽色框、摘要 bar、連開兩列（T9、T13、T17）', () => {
  test('速覽收合時 PM 色框與速覽一起淡，不殘留（T9）', async ({ page }) => {
    await gotoOverview(page, '#timeline')
    const P = `${T} [data-project="pmis"]`
    const row = page.locator(`${P} .p-row`)
    await row.click()
    await idle(page)
    const tr = await trace(page, { cap: `${P} .qv-cap`, wrap: `${P} .quick-wrap` }, () => row.click(), { ms: 700 })
    // 以速覽（.quick-wrap）開始變矮的那一幀當收合起點，不受 click 本身花的時間影響
    const wrap = series(tr, 'wrap', tr.at)
    const h0 = wrap[0]!.h
    const start = wrap.find((b) => b.h < h0 - 1)
    expect(start, '速覽有收合').toBeDefined()
    const end = wrap.find((b) => b.h <= 1)
    expect(end, '速覽收完').toBeDefined()
    // 收合開始後 150ms（--t-panel 的一半多）色框已淡到 < 0.6；綁延遲卸載時要等 320ms 才開始淡，這時還是 1
    expect(opacityAt(tr, 'cap', start!.t + 150), '收合 150ms 時色框的透明度').toBeLessThan(0.6)
    // 速覽收完的那一幀色框也差不多淡完，不會在列上多留一截
    expect(opacityAt(tr, 'cap', end!.t), '速覽收完時色框的透明度').toBeLessThan(0.1)
    // 是淡掉不是一下消失：拿掉前最後看得到的那一幀已經快透明，途中也沒有一幀跳太多
    const caps = series(tr, 'cap', tr.at)
    expect(caps.at(-1)!.o, '色框拿掉前最後一幀的透明度').toBeLessThan(0.1)
    expect(opacityJumps(caps), '色框透明度單幀跳動').toBe(false)
  })

  test('速覽收合途中又點開：色框從當下的透明度接續，不先歸零再淡入（T9）', async ({ page }) => {
    await gotoOverview(page, '#timeline')
    const P = `${T} [data-project="pmis"]`
    await page.locator(`${P} .p-row`).click()
    await idle(page)
    // 收合後 120ms（色框淡到一半左右）再點開；在頁面裡送，間隔才準
    const tr = await trace(
      page,
      { cap: `${P} .qv-cap` },
      () =>
        page.evaluate((sel) => {
          const r = document.querySelector(sel) as HTMLElement
          r.click()
          setTimeout(() => r.click(), 120)
        }, `${P} .p-row`),
      { ms: 800 },
    )
    const caps = series(tr, 'cap', tr.at)
    expect(Math.min(...caps.map((b) => b.o)), '途中最淡的一幀（有淡下去、但沒有歸零）').toBeGreaterThan(0.2)
    expect(Math.min(...caps.map((b) => b.o)), '途中最淡的一幀').toBeLessThan(0.9)
    expect(opacityJumps(caps), '色框透明度單幀跳動').toBe(false)
    expect(caps.at(-1)!.o, '最後回到完全不透明').toBeGreaterThan(0.95)
  })

  /**
   * m8 有「客戶入口網站改版」（7/6 起）與「行動 App v2」（9/15 起、到期最晚）。
   * 搜「入口」只剩前者：左緣不動、右端縮（寬 1401 → 725）；搜「App」只剩後者：左緣右移、寬度也縮。
   */
  for (const [q, dx, dw] of [
    ['入口', 0, 600],
    ['App', 400, 400],
  ] as const) {
    test(`收合中的群組被篩選（搜「${q}」）：摘要 bar 左緣與寬度平滑變化（T13）`, async ({ page }) => {
      await gotoOverview(page, '#timeline')
      await page.locator('[data-pm-group="m8"]').click()
      await idle(page)
      const tr = await trace(page, { sum: '[data-pm-group="m8"] .g-sum' }, () =>
        page.getByTestId('overview-search').fill(q),
      )
      const sum = series(tr, 'sum')
      const ws = sum.map((b) => ({ t: b.t, dt: b.dt, v: b.w }))
      const xs = sum.map((b) => ({ t: b.t, dt: b.dt, v: b.x }))
      expect(Math.abs(ws.at(-1)!.v - ws[0]!.v), '寬度確實變了').toBeGreaterThan(dw)
      expect(Math.abs(xs.at(-1)!.v - xs[0]!.v), '左緣移動量').toBeGreaterThanOrEqual(dx)
      expect(jumpCount(ws), '寬度單幀跳動').toBe(0)
      expect(jumpCount(xs), '左緣單幀跳動').toBe(0)
    })
  }

  /**
   * 稽核的情境（27-two-rows）：先開下方的 vendor，100ms 內再開上方的 pmis。
   * 每列展開完都捲的話：vendor 先展開完、開始平滑捲動時 pmis 還在長；pmis 展開完時捲動還沒停，以半途的位置判斷
   * 「看得見、不用捲」，之後 vendor 那段捲動照跑，把 pmis 的速覽推到黏住的標頭底下。
   * 另一個順序（先上後下）每列都捲也會到位，留著守住「只捲最後那列」時最後那列不會漏捲。
   */
  test.describe('矮視窗', () => {
    test.use({ viewport: { width: 1920, height: 700 } })

    for (const [first, last] of [
      ['vendor', 'pmis'],
      ['pmis', 'vendor'],
    ] as const) {
      test(`100ms 內連開兩列（先 ${first} 後 ${last}）：最後展開的速覽整個看得見（T17）`, async ({ page }) => {
        await gotoOverview(page, '#timeline')
        const lastRow = page.locator(`${T} [data-project="${last}"] .p-row`)
        // 兩下都在頁面裡送、間隔 60ms：從測試端點送（locator.click 還會等元素停止移動），兩下之間會拉長到 100ms 以上，
        // 後開那列展開完時先開那列的捲動已經把它推出去，它自己會捲回來，量不到這個問題
        await page.evaluate(
          ({ a, b }) => {
            ;(document.querySelector(a) as HTMLElement).click()
            setTimeout(() => (document.querySelector(b) as HTMLElement).click(), 60)
          },
          { a: `${T} [data-project="${first}"] .p-row`, b: `${T} [data-project="${last}"] .p-row` },
        )
        await pause(page, 1400)
        await expect(lastRow, '最後點的那列有展開').toHaveAttribute('aria-expanded', 'true')
        const qv = page.locator(`${T} [data-project="${last}"] .qv`)
        const box = (await qv.boundingBox())!
        expect(box.height, '速覽已經長完').toBeGreaterThan(200)
        // 黏住的頂欄、面板標題列與尺規列的底線（速覽自己的 scroll-margin-top）
        const safeTop = await qv.evaluate((el) => parseFloat(getComputedStyle(el).scrollMarginTop))
        expect(safeTop, '黏住的標頭高度').toBeGreaterThan(54)
        expect(box.y, '速覽頂邊沒有被黏住的標頭蓋住').toBeGreaterThanOrEqual(safeTop - 2)
        expect(box.y + box.height, '速覽底邊在視窗內（視窗高 700）').toBeLessThanOrEqual(702)
      })
    }
  })
})
