import { expect, test, type Locator, type Page } from '@playwright/test'
import { OverviewPage } from './helpers/overviewPage'

/** 元素的 computed transition 或 animation 是否有非 0 時長（靜態宣告的守衛）。 */
async function hasMotion(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => {
    const s = getComputedStyle(el)
    const dur = (v: string) => v.split(',').some((x) => parseFloat(x) > 0)
    return dur(s.transitionDuration) || dur(s.animationDuration)
  })
}

/** 在 action 執行期間，頁面上是否出現過某個 class（抓 Vue Transition 的 *-active）。 */
async function seesClass(page: Page, cls: string, action: () => Promise<void>): Promise<boolean> {
  const seen = page.evaluate((c) => new Promise<boolean>((resolve) => {
    const mo = new MutationObserver(() => {
      if (document.getElementsByClassName(c).length) { mo.disconnect(); resolve(true) }
    })
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    setTimeout(() => { mo.disconnect(); resolve(false) }, 2000)
  }), cls)
  await action()
  return seen
}

test.describe('總覽 動畫清單', () => {
  test('A1 卡片 / A2 速覽外殼與 caret / A11 檢視鈕 / A15 清除 / A24 面板收合鈕 / A30 進度條', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    expect(await hasMotion(ov.card('pmis'))).toBe(true)
    expect(await hasMotion(page.locator('[data-view-panel="cards"] [data-pm-col="m5"] .drawer'))).toBe(true)
    expect(await hasMotion(ov.card('pmis').locator('.card-caret'))).toBe(true)
    expect(await hasMotion(ov.card('pmis').locator('.pa-bar .fill'))).toBe(true)
    expect(await hasMotion(page.locator('[data-view-switch="cards"]'))).toBe(true)
    expect(await hasMotion(page.getByTestId('overview-clear'))).toBe(true)
    expect(await hasMotion(page.locator('[data-view-panel="cards"] .panel-caret'))).toBe(true)
    expect(await hasMotion(page.locator('[data-view-panel="cards"] .panel-body'))).toBe(true)
  })

  test('A4 下拉開 / 關都有過渡', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    expect(await seesClass(page, 'ov-pop-enter-active', () => ov.openDropdown('status'))).toBe(true)
    expect(await seesClass(page, 'ov-pop-leave-active', () => page.keyboard.press('Escape'))).toBe(true)
  })

  test('A5 排序選單 / A16 chip 移除 / A21 chip 箭頭', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    const panel = page.locator('[data-view-panel="cards"]')
    expect(await hasMotion(panel.locator('.chip-arrow').first())).toBe(true)
    expect(await seesClass(page, 'ov-pop-enter-active', () => panel.locator('.sort-trigger').click())).toBe(true)
    await page.keyboard.press('Escape')
    expect(await seesClass(page, 'ov-chip-leave-active', () => panel.locator('.chip-x').first().click())).toBe(true)
  })

  test('A7 / A8 篩選時卡片離場；A9 欄離場', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    expect(await seesClass(page, 'ov-card-leave-active', () => ov.pick('status', '未開始'))).toBe(true)
    await page.getByTestId('overview-clear').click()
    expect(await seesClass(page, 'ov-col-leave-active', () => ov.pickPm('m5'))).toBe(true)
  })

  test('A17 空狀態淡入', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.pick('status', '已完成')
    expect(await seesClass(page, 'ov-fade-enter-active', () => ov.pick('alert', '落後'))).toBe(true)
  })

  test('A10 切換檢視；A3 / A13 / A20 / A25 / A26 時間軸', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    expect(await seesClass(page, 'ov-view-leave-active', () => page.locator('[data-view-switch="timeline"]').click())).toBe(true)
    await expect(page.locator('[data-view-panel="timeline"]')).toBeVisible()
    expect(await hasMotion(ov.row('pmis').locator('.qv .quick-wrap'))).toBe(true)
    expect(await hasMotion(page.locator('[data-pm-group="m5"] .g-caret'))).toBe(true)
    expect(await hasMotion(ov.row('pmis').locator('.bar'))).toBe(true)
    expect(await hasMotion(ov.row('pmis').locator('.p-left'))).toBe(true)
    expect(await seesClass(page, 'ov-row-leave-active', () => ov.pick('status', '未開始'))).toBe(true)
  })

  test('A14 今天按鈕是平滑捲動（捲動分多次、落在不同位置）', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const body = page.locator('.tl-body')
    await body.evaluate((el) => { el.scrollLeft = 0 })
    // 記錄 scroll 事件時的位置：瞬移只會有一個位置，平滑捲動會經過很多個。
    // 不用固定幀數取樣，是因為平行跑時點擊可能晚到，取樣會全落在捲動開始之前（實測會 flaky）。
    await body.evaluate((el) => {
      const w = window as unknown as { __scrollXs: number[] }
      w.__scrollXs = []
      el.addEventListener('scroll', () => w.__scrollXs.push(el.scrollLeft))
    })
    await page.getByTestId('overview-today').click()
    await expect.poll(() => body.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await expect
      .poll(() => page.evaluate(() => new Set((window as unknown as { __scrollXs: number[] }).__scrollXs).size))
      .toBeGreaterThan(2)
  })

  test('A6 / A22 下拉選項、排序選項與成員勾選框的勾選態有過渡', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.openDropdown('status')
    expect(await hasMotion(ov.dropdown('status').locator('.dd-item').first())).toBe(true)
    await page.keyboard.press('Escape')
    await ov.openDropdown('pm')
    expect(await hasMotion(ov.dropdown('pm').locator('.mp-box').first())).toBe(true)
    await page.keyboard.press('Escape')
    await page.locator('[data-view-panel="cards"] .sort-trigger').click()
    expect(await hasMotion(page.locator('[data-view-panel="cards"] .sort-option').first())).toBe(true)
  })

  test('A23 成員觸發鈕的頭像疊增減有過渡', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    // 沒勾人時顯示前三位；勾了成員10 之後頭像疊換成只有成員10，舊頭像離場、新頭像進場
    expect(await seesClass(page, 'ov-av-leave-active', () => ov.pickPm('m10'))).toBe(true)
  })

  test('A27 時間軸展開時，選取列與速覽之間的連接框淡入', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    expect(await seesClass(page, 'qv-cap ov-fade-enter-active', () => ov.row('pmis').locator('.p-row').click())).toBe(true)
  })

  test('A28 展開畫面底部的卡片後，速覽會捲進畫面', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    const card = ov.card('vendor')
    // 讓卡片頂端落在畫面最下方 140px 內：展開後速覽一定超出畫面
    await card.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - (window.innerHeight - 140)))
    await card.locator('.card-name').click()
    const vh = page.viewportSize()!.height
    const wrap = ov.drawer('vendor')
    // 先等速覽完全展開（剛點下去時高度還是 0，底邊一定在畫面內，會假綠）
    await expect.poll(async () => (await wrap.boundingBox())!.height).toBeGreaterThan(200)
    await expect
      .poll(async () => {
        const box = (await wrap.boundingBox())!
        return box.y + box.height
      })
      .toBeLessThanOrEqual(vh + 2)
  })

  test('A29 切頁有 page-view 過渡', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    expect(await seesClass(page, 'page-view-leave-active', () => ov.card('pmis').getByRole('link', { name: /進入/ }).click())).toBe(true)
  })
})

/**
 * 重排時逐幀量元素到終點的距離：要有介於起點與終點之間的中間幀（有動畫、不是瞬移），
 * 而且過程中離終點的最大距離不超過起點距離（位移沒有被巢狀 TransitionGroup 算兩次、不會回彈）。
 * 取樣 1.2 秒（重排 0.26 秒）：平行跑時點擊可能晚到，留足時間窗。
 * 這兩種壞法 T10 實機都遇過：元件模板開頭有註解時沒有動畫；巢狀 FLIP 時先跳到終點再飄出去。
 */
async function trackMove(page: Page, selector: string, action: () => Promise<void>): Promise<number[]> {
  const frames = page.evaluate(
    (sel) =>
      new Promise<number[][]>((resolve) => {
        const out: number[][] = []
        const t0 = performance.now()
        const tick = () => {
          const el = document.querySelector(sel)
          if (el) {
            const r = el.getBoundingClientRect()
            out.push([r.x, r.y])
          }
          if (performance.now() - t0 < 1200) requestAnimationFrame(tick)
          else resolve(out)
        }
        requestAnimationFrame(tick)
      }),
    selector,
  )
  await action()
  const xs = await frames
  const [ex, ey] = xs[xs.length - 1]!
  return xs.map(([x, y]) => Math.hypot(x! - ex!, y! - ey!))
}

/**
 * 逐幀離終點的距離是否一路不增加（容 2px 取樣誤差）。
 * maxDist 抓不到「先跳到終點附近、再往外走、最後回來」：往外走的最遠點仍可能小於起點距離。
 */
function monotonic(dist: number[]): boolean {
  return dist.every((d, i) => i === 0 || d <= dist[i - 1]! + 2)
}

/** 在 action 執行期間逐幀取某元素的 opacity（找不到元素的幀略過）。 */
async function trackOpacity(page: Page, selector: string, action: () => Promise<void>): Promise<number[]> {
  const frames = page.evaluate(
    (sel) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = []
        const t0 = performance.now()
        const tick = () => {
          const el = document.querySelector(sel)
          if (el) out.push(parseFloat(getComputedStyle(el).opacity))
          if (performance.now() - t0 < 1200) requestAnimationFrame(tick)
          else resolve(out)
        }
        requestAnimationFrame(tick)
      }),
    selector,
  )
  await action()
  return frames
}

/** 把逐幀距離整理成三個要斷言的量：起點距離、有沒有中間幀、途中離終點最遠多少。 */
function moveReport(dist: number[]): { start: number; hasMidFrame: boolean; maxDist: number } {
  const start = dist[0]!
  return {
    start,
    // 至少一幀在途中：離終點超過 10% 且少於 90% 的起點距離
    hasMidFrame: dist.some((d) => d > start * 0.1 && d < start * 0.9),
    maxDist: Math.max(...dist),
  }
}

test.describe('總覽 重排動畫（A8 / A9 / A20）', () => {
  test('卡片檢視：移掉「落後」排序，泳道換位置時卡片平順移動、不回彈', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    const dist = await trackMove(page, '[data-view-panel="cards"] [data-project="wiki"]', () =>
      page.locator('[data-view-panel="cards"] .chip-x').first().click(),
    )
    const r = moveReport(dist)
    expect(r.start).toBeGreaterThan(50)
    expect(r.hasMidFrame).toBe(true)
    // 不回彈：途中不會比起點離終點更遠（容 2px 誤差）
    expect(r.maxDist).toBeLessThanOrEqual(r.start + 2)
  })

  test('卡片檢視：泳道換位置、同時泳道內順序也變（金流介接移到 PMIS 前面），卡片平順移動、不回彈', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    const dist = await trackMove(page, '[data-view-panel="cards"] [data-project="payment"]', () =>
      page.locator('[data-view-panel="cards"] .chip-x').first().click(),
    )
    const r = moveReport(dist)
    expect(r.start).toBeGreaterThan(50)
    expect(r.hasMidFrame).toBe(true)
    // 不回彈：途中不會比起點離終點更遠（容 2px 誤差）
    expect(r.maxDist).toBeLessThanOrEqual(r.start + 2)
  })

  test('卡片檢視：泳道的 index 不變但整條上移（前面的泳道變矮），卡片不會位移兩倍', async ({ page }) => {
    // 640px 寬時泳道一列只放一張卡。只看成員8 / 5 / 9：成員8、成員5 各 2 張（各兩列），成員9 在最下面。
    // 再篩「需注意＝無」：成員8、成員5 各剩 1 張、泳道變矮，成員9 整條上移，index 仍是 2。
    // 用 index 猜「泳道有沒有動」的做法在這裡會把泳道的位移算兩次（review 抓到的情境）。
    await page.setViewportSize({ width: 640, height: 900 })
    const ov = new OverviewPage(page); await ov.goto()
    await ov.pickPm('m8', 'm5', 'm9')
    // 篩掉成員10 的泳道離場、其餘泳道重排都跑完才開始量，否則第一幀就在半途
    await page.waitForFunction(() => document.getAnimations().length === 0)
    const dist = await trackMove(page, '[data-view-panel="cards"] [data-project="dw"]', () =>
      ov.pick('alert', '無'),
    )
    const r = moveReport(dist)
    expect(r.start).toBeGreaterThan(50)
    expect(r.hasMidFrame).toBe(true)
    // 不回彈：途中不會比起點離終點更遠（容 2px 誤差）
    expect(r.maxDist).toBeLessThanOrEqual(r.start + 2)
  })

  /*
   * 泳道整條移動、同時泳道內「第一張卡」換位置：Vue TransitionGroup 探測內建 move 時會複製第一個子元素（含 inline style），
   * useRelativeFlip 先寫上的 inline transition 曾讓它誤判要跑內建 move、用絕對位移蓋掉相對位移——卡片先出現在終點再折返。
   */
  test('卡片檢視：清除篩選時留下的卡片從原位一路移到新位置，不先跳到終點', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.pick('status', '未開始')
    await page.waitForFunction(() => document.getAnimations().length === 0)
    const dist = await trackMove(page, '[data-view-panel="cards"] [data-project="vendor"]', () =>
      page.getByTestId('overview-clear').click(),
    )
    const r = moveReport(dist)
    expect(r.start).toBeGreaterThan(50)
    expect(r.hasMidFrame).toBe(true)
    expect(monotonic(dist)).toBe(true)
  })

  test('時間軸：清除篩選時留下的列從原位一路移到新位置，不先跳到終點', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    await ov.pick('status', '未開始')
    await page.waitForFunction(() => document.getAnimations().length === 0)
    const dist = await trackMove(page, '[data-view-panel="timeline"] [data-project="vendor"] .p-row', () =>
      page.getByTestId('overview-clear').click(),
    )
    const r = moveReport(dist)
    expect(r.start).toBeGreaterThan(50)
    expect(r.hasMidFrame).toBe(true)
    expect(monotonic(dist)).toBe(true)
  })

  test('卡片檢視：清除篩選時新進場的卡片淡入（opacity 有中間值），不是直接出現', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.pick('status', '未開始')
    await page.waitForFunction(() => document.getAnimations().length === 0)
    const ops = await trackOpacity(page, '[data-view-panel="cards"] [data-project="dw"]', () =>
      page.getByTestId('overview-clear').click(),
    )
    expect(ops.some((o) => o > 0.05 && o < 0.95)).toBe(true)
  })

  test('卡片檢視：展開中的卡片被篩掉時也淡出（is-open 的過渡不能蓋掉離場過渡）', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    // 報表資料倉儲（已完成）與供應商入口 v1（未開始）同在成員9 泳道：篩「未開始」時泳道留著，只有展開中的它離場
    // （整條泳道離場時淡出的是泳道本身，卡片自己的 opacity 不會變，量不到這個問題）
    await ov.cardMain('dw').click()
    await expect.poll(async () => (await ov.drawer('dw').boundingBox())?.height ?? 0).toBeGreaterThan(200)
    await page.waitForFunction(() => document.getAnimations().length === 0)
    await ov.openDropdown('status')
    const ops = await trackOpacity(page, '[data-view-panel="cards"] [data-project="dw"]', () =>
      ov.dropdown('status').getByRole('button', { name: '未開始', exact: true }).click(),
    )
    expect(ops.some((o) => o > 0.05 && o < 0.95)).toBe(true)
  })

  test('時間軸：移掉「落後」排序，群組換位置時列平順移動、不回彈', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const dist = await trackMove(page, '[data-view-panel="timeline"] [data-project="dw"] .p-row', () =>
      page.locator('[data-view-panel="timeline"] .chip-x').first().click(),
    )
    const r = moveReport(dist)
    expect(r.start).toBeGreaterThan(50)
    expect(r.hasMidFrame).toBe(true)
    // 不回彈：途中不會比起點離終點更遠（容 2px 誤差）
    expect(r.maxDist).toBeLessThanOrEqual(r.start + 2)
  })
})
