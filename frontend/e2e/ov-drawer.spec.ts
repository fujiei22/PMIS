import { expect, test, type Page } from '@playwright/test'
import { drift, gotoOverview, idle, jumpCount, pause, probe, reverses, series, trace } from './helpers/ovMotion'

/** 速覽抽屜與卡片的銜接（動畫稽核 C5、C7 B、C8、C11、C12、C14）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

const P = '[data-view-panel="cards"]'
const cardMain = (id: string): string => `${P} [data-project="${id}"] .card-main`

interface ArrowFrame {
  t: number
  /** 每張卡下緣箭頭看得到的程度：沒有 ::after（content none）算 0，否則是它的透明度。 */
  arrows: Record<string, number>
  /** 泳道抽屜的高度。 */
  h: number
  /** 抽屜目前在哪張卡下方（data-drawer）。 */
  on: string | null
}

/** 點 click（選擇器），之後 ms 毫秒逐幀記錄 ids 每張卡的箭頭、pm 泳道抽屜的高度與它在哪張卡下方；卡片或抽屜還不在的幀略過。 */
async function recordArrows(page: Page, pm: string, ids: string[], click: string, ms: number): Promise<ArrowFrame[]> {
  return page.evaluate(
    async ({ P, pm, ids, click, ms }) => {
      const arrowOf = (card: Element): number => {
        const a = getComputedStyle(card, '::after')
        return a.content === 'none' || a.content === 'normal' ? 0 : parseFloat(a.opacity)
      }
      const out: ArrowFrame[] = []
      ;(document.querySelector(click) as HTMLElement).click()
      const t0 = performance.now()
      await new Promise<void>((done) => {
        const tick = (): void => {
          const drawer = document.querySelector<HTMLElement>(`${P} [data-pm-col="${pm}"] .drawer`)
          const cards = ids.map((id) => document.querySelector(`${P} [data-project="${id}"]`))
          if (drawer && cards.every((c) => c)) {
            out.push({
              t: performance.now() - t0,
              arrows: Object.fromEntries(ids.map((id, i) => [id, arrowOf(cards[i]!)])),
              h: drawer.getBoundingClientRect().height,
              on: drawer.dataset.drawer ?? null,
            })
          }
          if (performance.now() - t0 < ms) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      return out
    },
    { P, pm, ids, click, ms },
  )
}

test('展開箭頭與抽屜同步：長出、收起的每一幀，箭頭透明度與抽屜高度進度相差 ≤ 0.35（C11）', async ({ page }) => {
  await gotoOverview(page)
  const opening = await recordArrows(page, 'm5', ['pmis'], cardMain('pmis'), 600)
  const full = opening.at(-1)!.h
  expect(full).toBeGreaterThan(100)
  expect(opening.every((f) => Math.abs(f.arrows.pmis! - f.h / full) <= 0.35), '長出時箭頭與抽屜不同步').toBe(true)
  await idle(page)
  const closing = await recordArrows(page, 'm5', ['pmis'], cardMain('pmis'), 600)
  expect(closing.at(-1)!.h).toBe(0)
  expect(closing.every((f) => Math.abs(f.arrows.pmis! - f.h / full) <= 0.35), '收起時箭頭與抽屜不同步').toBe(true)
})

test('收起速覽時滑鼠還停在卡片上：箭頭收起期間卡片不上浮（箭頭不和收起中的抽屜之間出現縫隙）', async ({ page }) => {
  await gotoOverview(page)
  await page.locator(cardMain('pmis')).click()
  await idle(page)
  // 滑鼠停在主體上（hover）；再點一次收起
  const b = (await page.locator(cardMain('pmis')).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await idle(page)
  const frames = await page.evaluate(async (P) => {
    const card = document.querySelector(`${P} [data-project="pmis"]`) as HTMLElement
    const out: { top: number; arrow: number }[] = []
    const t0 = performance.now()
    card.querySelector<HTMLElement>('.card-main')!.click()
    await new Promise<void>((done) => {
      const tick = (): void => {
        out.push({ top: card.getBoundingClientRect().top, arrow: parseFloat(getComputedStyle(card, '::after').opacity) })
        if (performance.now() - t0 < 500) requestAnimationFrame(tick)
        else done()
      }
      requestAnimationFrame(tick)
    })
    return out
  }, P)
  const top0 = frames[0]!.top
  const showing = frames.filter((f) => f.arrow > 0.02)
  expect(showing.length, '有錄到箭頭收起的過程（有鑑別力）').toBeGreaterThan(5)
  expect(Math.max(...showing.map((f) => Math.abs(f.top - top0))), '箭頭還看得到時卡片上浮了（px）').toBeLessThanOrEqual(0.1)
})

test('切回卡片檢視：展開中那張的箭頭和抽屜一起在，不會在已全開的抽屜上方重新淡入（C11）', async ({ page }) => {
  await gotoOverview(page)
  await page.locator(cardMain('pmis')).click()
  await idle(page)
  await page.locator('[data-view-switch="timeline"]').click()
  await idle(page)
  const frames = await recordArrows(page, 'm5', ['pmis'], '[data-view-switch="cards"]', 600)
  expect(frames.length).toBeGreaterThan(5)
  const full = frames.at(-1)!.h
  expect(full).toBeGreaterThan(100)
  expect(frames.every((f) => Math.abs(f.arrows.pmis! - f.h / full) <= 0.35), '箭頭與抽屜不同步').toBe(true)
})

test('速覽開著時篩掉同列後面的卡：那張卡相對泳道原地淡出（C5）', async ({ page }) => {
  await gotoOverview(page)
  await page.locator(cardMain('pmis')).click()
  await idle(page)
  const [pay] = await probe(page, `${P} [data-project="payment"]`, 'pay')
  const body = `${P} [data-pm-col="m5"] .lane-body`
  const tr = await trace(page, { pay: pay!, body }, () => page.getByTestId('overview-search').fill('pmis'))
  const rel = tr.frames
    .filter((f) => f.boxes.pay && f.boxes.body && f.boxes.pay.o > 0.05)
    .map((f) => ({ x: f.boxes.pay!.x - f.boxes.body!.x, y: f.boxes.pay!.y - f.boxes.body!.y, w: f.boxes.pay!.w, h: f.boxes.pay!.h, o: f.boxes.pay!.o }))
  expect(rel.length).toBeGreaterThan(2)
  expect(drift(rel), '相對泳道的位移').toBeLessThanOrEqual(4)
})

/** 同列換卡時逐幀記 m8 泳道：每份速覽內容的最大透明度、抽屜高度；第一筆是點擊當下（t = 0）的高度。 */
async function recordSwap(page: Page, to: string): Promise<{ t: number; max: number; h: number }[]> {
  return page.evaluate(
    async ({ P, to }) => {
      const drawer = document.querySelector(`${P} [data-pm-col="m8"] .drawer`) as HTMLElement
      const out = [{ t: 0, max: 1, h: drawer.getBoundingClientRect().height }]
      ;(document.querySelector(`${P} [data-project="${to}"] .card-main`) as HTMLElement).click()
      const t0 = performance.now()
      await new Promise<void>((done) => {
        const tick = (): void => {
          const cs = [...drawer.querySelectorAll('.drawer-content')]
          out.push({
            t: performance.now() - t0,
            max: Math.max(0, ...cs.map((c) => parseFloat(getComputedStyle(c).opacity))),
            h: drawer.getBoundingClientRect().height,
          })
          if (performance.now() - t0 < 700) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      return out
    },
    { P, to },
  )
}

for (const [from, to] of [['app', 'portal'], ['portal', 'app']] as const) {
  test(`同列換一張卡（m8：${from} → ${to}）：內容交叉淡化、抽屜高度平順（C12）`, async ({ page }) => {
    await gotoOverview(page)
    const a = (await page.locator(`${P} [data-project="${from}"]`).boundingBox())!
    const b = (await page.locator(`${P} [data-project="${to}"]`).boundingBox())!
    expect(Math.abs(a.y - b.y), `${from} 與 ${to} 要在同一列`).toBeLessThan(1)
    // 範例資料兩份速覽一樣高：把 portal 的內容加高 160px，換卡時抽屜高度才真的會變
    await page.addStyleTag({ content: `${P} .drawer-content:has(.enter-head[href$="/portal"]) { padding-bottom: 160px; }` })
    await page.locator(cardMain(from)).click()
    await idle(page)
    const frames = await recordSwap(page, to)
    expect(frames.every((f) => f.max >= 0.5), '每一幀都至少有一份內容看得清楚（不整片閃掉）').toBe(true)
    const hs = frames.map((f, i) => ({ dt: i ? f.t - frames[i - 1]!.t : 0, v: f.h }))
    expect(Math.abs(hs.at(-1)!.v - hs[0]!.v), '抽屜高度要真的有變（加高沒生效）').toBeGreaterThan(100)
    expect(jumpCount(hs), '抽屜高度單幀跳').toBe(0)
  })
}

/** 進入 Dashboard 再按上一頁，逐幀記頁面（切頁淡入）與速覽自己的淡入（外框 × 內容；Box.o 不乘祖先）。 */
async function backFrom(page: Page, targets: { box: string; qv: string }): Promise<{ view: number; own: number }[]> {
  await page.locator('[data-rowtask]').first().waitFor()
  const tr = await trace(page, { view: '[data-view="overview"]', ...targets }, () => page.goBack(), { ms: 1200 })
  return tr.frames
    .filter((f) => f.boxes.view && f.boxes.box && f.boxes.qv)
    .map((f) => ({ view: f.boxes.view!.o, own: f.boxes.box!.o * f.boxes.qv!.o }))
}

test('展開 vendor → 進 Dashboard → 返回：速覽內容與頁面同步出現（C14）', async ({ page }) => {
  await gotoOverview(page)
  await page.locator(cardMain('vendor')).click()
  await idle(page)
  await page.locator(`${P} [data-project="vendor"] .enter-edge`).click()
  const qv = `${P} [data-drawer="vendor"]`
  const fs = await backFrom(page, { box: `${qv} .drawer-box`, qv: `${qv} .drawer-content` })
  expect(fs.some((f) => f.view < 0.5), '要錄到切頁淡入的過程').toBe(true)
  // 速覽只跟著頁面淡入，自己不再淡一次（修正前外框的 appear 與內容的 fadeIn 疊在切頁淡入上：開頭幾幀速覽自己是 0，頁面 0.9 時速覽實際約 0.7）
  expect(fs.every((f) => f.own >= 0.95), '速覽自己又淡入一次').toBe(true)
})

test('時間軸展開 vendor → 進 Dashboard → 返回：速覽內容與頁面同步出現（C14）', async ({ page }) => {
  await gotoOverview(page)
  await page.locator('[data-view-switch="timeline"]').click()
  await idle(page)
  const row = '[data-view-panel="timeline"] [data-project="vendor"]'
  await page.locator(`${row} .p-row`).click()
  await idle(page)
  await page.locator(`${row} .enter-head`).click()
  const fs = await backFrom(page, { box: `${row} .qv-box`, qv: `${row} .quick-view` })
  expect(fs.some((f) => f.view < 0.5), '要錄到切頁淡入的過程').toBe(true)
  expect(fs.every((f) => f.own >= 0.95), '速覽自己又淡入一次').toBe(true)
})

test.describe('一欄寬（換列）', () => {
  test.use({ viewport: { width: 640, height: 900 } })

  test('同泳道換到下一列的卡（m8：portal → app）：箭頭跟著抽屜走，舊卡的隨舊抽屜收起、新卡的等抽屜到新列才長出（C11）', async ({ page }) => {
    await gotoOverview(page)
    const portal = (await page.locator(`${P} [data-project="portal"]`).boundingBox())!
    const app = (await page.locator(`${P} [data-project="app"]`).boundingBox())!
    expect(app.y, 'portal 與 app 要在不同列').toBeGreaterThan(portal.y + portal.height)
    await page.locator(cardMain('portal')).click()
    await idle(page)
    const portalFull = (await page.locator(`${P} [data-pm-col="m8"] .drawer`).boundingBox())!.height
    const frames = await recordArrows(page, 'm8', ['portal', 'app'], cardMain('app'), 1000)
    const full: Record<string, number> = { portal: portalFull, app: frames.at(-1)!.h }
    expect(Math.min(portalFull, full.app!)).toBeGreaterThan(100)
    // 確實先在舊列收起、再到新列長出
    expect(frames.some((f) => f.on === 'portal' && f.h < portalFull - 1), '抽屜先在舊列收起').toBe(true)
    expect(frames.at(-1)!.on, '抽屜最後在 app 下方').toBe('app')
    const stray = frames.filter((f) => Object.entries(f.arrows).some(([id, o]) => id !== f.on && o > 0.1))
    expect(stray, '抽屜不在下方的卡亮著箭頭').toHaveLength(0)
    const lag = frames.filter((f) => Math.abs((f.arrows[f.on ?? ''] ?? 0) - f.h / (full[f.on ?? ''] ?? 1)) > 0.35)
    expect(lag, '箭頭與抽屜不同步').toHaveLength(0)
  })

  /**
   * 展開 portal，把 app（下一列）捲到畫面中間（420px；m8 是最後一條泳道，頁面在底部會被夾住）。
   * 回傳 app 的追蹤選擇器與它主體的中心點：用 mouse.click 點座標，不用 locator.click——後者點之前有時會先把元素
   * 捲到它認為可點的位置（實測先捲 10–20px），量到的起點就不是使用者看到的位置。
   * @param padBottom 頁面下方墊高（px）：頁面捲在底部時，抽屜收合讓頁高變矮、瀏覽器自己把捲動往上夾，等於替補償做了；
   *   墊高讓捲動不會被夾，量得到補償本身有沒有晚一幀。
   */
  async function openPortalShowApp(page: Page, padBottom = 0): Promise<{ app: string; pt: { x: number; y: number } }> {
    await gotoOverview(page)
    if (padBottom) await page.addStyleTag({ content: `[data-view="overview"] { padding-bottom: ${padBottom}px; }` })
    await page.locator(cardMain('portal')).click()
    await idle(page)
    await page.locator(`${P} [data-project="app"]`).evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 420))
    await idle(page)
    const [app] = await probe(page, `${P} [data-project="app"]`, 'app')
    const b = (await page.locator(cardMain('app')).boundingBox())!
    return { app: app!, pt: { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  }

  /** 換到 app 的兩種方式：滑鼠點、鍵盤 Enter（觸發換列的那次按鍵不能被當成使用者捲動而停掉補償）。 */
  const pick = {
    點擊: (page: Page, pt: { x: number; y: number }) => page.mouse.click(pt.x, pt.y),
    Enter: async (page: Page) => {
      await page.locator(cardMain('app')).focus()
      await page.keyboard.press('Enter')
    },
  }

  for (const [how, choose] of Object.entries(pick)) {
    test(`同泳道換到下一列的卡（${how}）：舊抽屜收合期間頁面跟著上捲，被點的卡停在原位、一直留在畫面內（C8）`, async ({ page }) => {
      const { app, pt } = await openPortalShowApp(page)
      const tr = await trace(page, { app }, () => choose(page, pt), { ms: 1500 })
      const ys = series(tr, 'app')
      expect(ys.every((b) => b.y >= 0 && b.y + b.h <= 900), '被點的卡滑出畫面').toBe(true)
      // 舊抽屜收合（--t-panel，約 0.26 秒）期間：抽屜收多少頁面就捲多少，卡片不動；之後新抽屜在它下方長出，捲進畫面時才會動
      const collapsing = ys.filter((b) => b.t <= tr.at + 300)
      expect(collapsing.length).toBeGreaterThan(8)
      expect(collapsing.every((b) => Math.abs(b.y - ys[0]!.y) <= 2), '收合期間被點的卡跟著抽屜上移').toBe(true)
      expect(Math.min(...collapsing.map((b) => b.sy)), '頁面要真的有上捲').toBeLessThan(ys[0]!.sy - 100)
    })
  }

  test('換到下一列、頁面下方還有內容（捲動不會被夾）：被點的卡在畫出來的每一幀都不動（補償不晚一幀，C8）', async ({ page }) => {
    const { app, pt } = await openPortalShowApp(page, 1200)
    // ovMotion 的取樣在版面算完、繪製前（ResizeObserver），量到的就是畫出來的那一幀
    const tr = await trace(page, { app }, () => page.mouse.click(pt.x, pt.y), { ms: 1200 })
    const ys = series(tr, 'app')
    const collapsing = ys.filter((b) => b.t <= tr.at + 300)
    expect(collapsing.length).toBeGreaterThan(8)
    expect(Math.min(...collapsing.map((b) => b.sy)), '頁面要真的有上捲（有鑑別力）').toBeLessThan(ys[0]!.sy - 100)
    const worst = Math.max(...collapsing.map((b) => Math.abs(b.y - ys[0]!.y)))
    expect(worst, '收合期間被點的卡離開原位（px）').toBeLessThanOrEqual(2)
  })

  test('換列補償中使用者往上捲：補償立刻停，不把頁面拉回去（C8）', async ({ page }) => {
    const { app, pt } = await openPortalShowApp(page)
    const tr = await trace(page, { app }, async () => {
      await page.mouse.click(pt.x, pt.y)
      await page.mouse.wheel(0, -300)
    })
    // 補償讓卡片停在原位、抽屜收合只會讓它上移；卡片往下移只可能是滾輪捲上去的距離留住了。
    // 繼續補償的話，下一幀就把捲上去的距離捲回來（scrollY 變大），卡片又回到原位
    const ys = series(tr, 'app').map((b) => b.y)
    expect(Math.max(...ys), '捲上去的距離被補償拉回').toBeGreaterThan(ys[0]! + 200)
    // 只看舊抽屜收合的期間：之後新抽屜長出，把它捲進畫面（A28）本來就會往下捲
    const sy = tr.frames.filter((f) => f.t >= tr.at && f.t <= tr.at + 300).map((f) => f.sy)
    expect(sy.length).toBeGreaterThan(8)
    expect(sy.every((v, i) => i === 0 || v <= sy[i - 1]! + 1), '使用者捲動後頁面被往下拉').toBe(true)
  })

  test('換列補償中按下（pointerdown：拖捲軸、點畫面）：補償立刻停（C8）', async ({ page }) => {
    const { app, pt } = await openPortalShowApp(page)
    const tr = await trace(page, { app }, async () => {
      // 記下每次 pointerdown 的時間（同 trace 的時間基準）：第一次是點 app，第二次是補償中按下
      await page.evaluate(() => {
        const w = window as unknown as { __ovTrace: { t0: number }; __downs: number[] }
        w.__downs = []
        addEventListener('pointerdown', () => w.__downs.push(performance.now() - w.__ovTrace.t0), { capture: true })
      })
      await page.mouse.click(pt.x, pt.y)
      await pause(page, 60)
      // 按在看板左邊的頁面留白上：不點到任何控制項
      await page.mouse.move(4, 450)
      await page.mouse.down()
      await page.mouse.up()
    })
    const downs = await page.evaluate(() => (window as unknown as { __downs: number[] }).__downs)
    expect(downs).toHaveLength(2)
    const down = downs[1]!
    const sy = tr.frames.filter((f) => f.t >= tr.at && f.t <= tr.at + 300)
    const before = sy.filter((f) => f.t < down)
    const after = sy.filter((f) => f.t > down + 20).map((f) => f.sy)
    expect(before.at(-1)!.sy, '按下前補償已經在捲（有鑑別力）').toBeLessThan(before[0]!.sy - 5)
    expect(down, '在舊抽屜收合期間按下（有鑑別力）').toBeLessThan(tr.at + 220)
    expect(after.length).toBeGreaterThan(3)
    expect(Math.max(...after) - Math.min(...after), '按下後頁面還在被捲（補償沒停）').toBeLessThanOrEqual(1)
  })

  test('兩條泳道的換列補償重疊：最後一條結束才還原根元素的 overflow-anchor，且還原成原值', async ({ page }) => {
    await gotoOverview(page)
    // 一欄寬時 m5（PMIS / 金流介接）與 m8（客戶入口 / 行動 App）都是兩列；各展開上面那張
    await page.locator(cardMain('pmis')).click()
    await idle(page)
    await page.locator(cardMain('portal')).click()
    await idle(page)
    // 補償前的 inline 值（別處也可能設過）：結束後要還原成它，不是清空
    await page.evaluate(() => (document.documentElement.style.overflowAnchor = 'auto'))
    const { frames, second } = await page.evaluate(async (P) => {
      const html = document.documentElement
      const out: { t: number; v: string }[] = []
      // 用 element.click()：不產生 pointerdown，第二下不會把第一條泳道的補償當成使用者操作停掉
      const click = (id: string): void => (document.querySelector(`${P} [data-project="${id}"] .card-main`) as HTMLElement).click()
      const t0 = performance.now()
      let second = 0
      click('payment')
      setTimeout(() => {
        second = performance.now() - t0
        click('app')
      }, 120)
      await new Promise<void>((done) => {
        const tick = (): void => {
          out.push({ t: performance.now() - t0, v: html.style.overflowAnchor })
          if (performance.now() - t0 < 900) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      return { frames: out, second }
    }, P)
    const none = frames.filter((f) => f.v === 'none')
    expect(none.length, '補償期間關掉 scroll anchoring（有鑑別力）').toBeGreaterThan(3)
    // 第二條的補償在它開始後約 PANEL_UNMOUNT_MS（320ms）才結束；第一條先結束時不能提早打開
    expect(none.at(-1)!.t, '第一條結束時就還原了').toBeGreaterThan(second + 320 - 40)
    expect(frames.filter((f) => f.t > none[0]!.t && f.t < none.at(-1)!.t).every((f) => f.v === 'none'), '補償中途被打開').toBe(true)
    expect(frames.at(-1)!.v, '還原成補償前的值').toBe('auto')
  })
})

test.describe('平板橫向 1024×768 觸控', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })

  test('泳道標頭黏住時收合面板：標頭逐幀連續，不先彈一下（C7 B）', async ({ page }) => {
    await gotoOverview(page)
    await page.locator(cardMain('pmis')).tap()
    await idle(page)
    const head = `${P} [data-pm-col="m5"] .lane-head`
    await page.locator(head).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => scrollBy(0, 120))
    await idle(page)
    const stuck = await page.locator(head).evaluate((el) => el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top)
    expect(stuck, '標頭要先黏住（離泳道頂有一段距離）').toBeGreaterThan(50)
    const tr = await trace(page, { head }, () => page.locator(`${P} .panel-toggle`).tap())
    const hs = series(tr, 'head', tr.at)
    expect(hs.length).toBeGreaterThan(3)
    // 頁面還沒被夾（scrollY 沒變）的幀，黏住的標頭不該動：過渡中 overflow hidden 時第一幀就彈回泳道頂（約 −220px）
    const unscrolled = hs.filter((b) => Math.abs(b.sy - hs[0]!.sy) < 0.5)
    expect(unscrolled.length).toBeGreaterThan(1)
    expect(unscrolled.every((b) => Math.abs(b.y - hs[0]!.y) <= 1), '頁面沒捲動時標頭先彈走').toBe(true)
    // 之後頁面變短、捲動被夾，只會把標頭往下帶，途中不往回
    expect(reverses(hs.map((b) => b.y)), '標頭先往上彈再被拉下').toBe(false)
  })
})
