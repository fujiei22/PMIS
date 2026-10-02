import { expect, test } from '@playwright/test'
import { setFixedTime } from './helpers/clock'
import { OverviewPage } from './helpers/overviewPage'

test.describe('總覽 頂欄', () => {
  test('成員選項顯示進行中 / 未開始數，有需注意的 PM 有紅點', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.openDropdown('pm')
    const opt = (id: string) => ov.dropdown('pm').locator(`[data-pm-option="${id}"]`)
    await expect(opt('m5')).toContainText('進行中 2')
    await expect(opt('m9')).toContainText('未開始 1')
    await expect(opt('m5').locator('.alert-dot')).toBeVisible()
    await expect(opt('m9').locator('.alert-dot')).toHaveCount(0)
  })

  test('篩成員5、成員8 → 計數與卡片跟著變；清除篩選回全部', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await expect(ov.count()).toHaveText('7 個專案 · 3 個需要注意 · 4 位 PM')
    await ov.pickPm('m5', 'm8')
    await expect(ov.count()).toHaveText('4 個專案 · 2 個需要注意 · 2 位 PM')
    await expect.poll(() => ov.cardIds()).toEqual(['portal', 'app', 'pmis', 'payment'])
    await page.getByTestId('overview-clear').click()
    await expect(ov.count()).toHaveText('7 個專案 · 3 個需要注意 · 4 位 PM')
  })

  test('狀態篩「未開始」只剩供應商入口', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.pick('status', '未開始')
    await expect.poll(() => ov.cardIds()).toEqual(['vendor'])
  })

  test('Esc 關閉下拉後焦點回到觸發鈕', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.openDropdown('status')
    await page.keyboard.press('Escape')
    await expect(ov.dropdown('status').locator('.dd-menu')).toHaveCount(0)
    await expect(ov.dropdown('status').locator('button.dd-trigger')).toBeFocused()
  })

  test('搜尋專案名稱：卡片與時間軸只剩符合的專案；搜不到顯示空狀態，清除篩選連搜尋字一起清', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    const search = page.getByTestId('overview-search')
    await search.fill('app')
    await expect(ov.count()).toHaveText('1 個專案 · 0 個需要注意 · 1 位 PM')
    await expect.poll(() => ov.cardIds()).toEqual(['app'])
    // 切到時間軸：搜尋字保留，同樣只剩一列
    await page.locator('[data-view-switch="timeline"]').click()
    await expect(page.locator('[data-view-panel="timeline"] [data-project]')).toHaveCount(1)
    await expect(ov.row('app')).toBeVisible()
    await expect(search).toHaveValue('app')
    await search.fill('不存在的專案')
    await expect(page.getByTestId('overview-empty')).toBeVisible()
    await page.getByTestId('overview-empty').getByRole('button', { name: '清除篩選' }).click()
    await expect(search).toHaveValue('')
    await expect(page.locator('[data-view-panel="timeline"] [data-project]')).toHaveCount(7)
  })
})

test.describe('總覽 卡片檢視', () => {
  test('預設泳道順序與泳道內卡片順序依排序', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await expect.poll(() => ov.columnIds()).toEqual(['m10', 'm8', 'm5', 'm9'])
    await expect.poll(() => ov.cardIds()).toEqual(['wiki', 'portal', 'app', 'pmis', 'payment', 'dw', 'vendor'])
  })

  test('移掉「落後」排序、只剩到期日 → 泳道順序跟著變', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await page.locator('[data-view-panel="cards"] .chip-x').first().click()
    // 到期日最早的是 dw（09-12，成員9），其次 wiki（09-30，成員10）、portal（10-16，成員8）、payment（10-31，成員5）
    await expect.poll(() => ov.columnIds()).toEqual(['m9', 'm10', 'm8', 'm5'])
  })

  test('點卡片展開速覽四組；再點收合；點進入到 Dashboard', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.cardMain('pmis').click()
    await expect(ov.cardMain('pmis')).toHaveAttribute('aria-expanded', 'true')
    await expect(ov.drawer('pmis').locator('.qb-title')).toHaveText(['進度與任務數', '時程', '風險項目', '成員與近期任務'])
    await ov.card('pmis').locator('.card-name').click()
    await expect(ov.cardMain('pmis')).toHaveAttribute('aria-expanded', 'false')
    await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
    await expect(page).toHaveURL(/\/projects\/pmis$/)
    await expect(page.locator('[data-panel="gantt"]')).toBeVisible()
  })

  test('列下展開：同一列的另一張卡不動，速覽插在該列正下方、橫跨整列', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    // 成員8 的 portal 與 app 同一列
    const app0 = (await ov.card('app').boundingBox())!
    await ov.card('portal').locator('.card-name').click()
    const drawer = ov.drawer('portal')
    await expect.poll(async () => (await drawer.boundingBox())!.height).toBeGreaterThan(200)
    const portal = (await ov.card('portal').boundingBox())!
    const app = (await ov.card('app').boundingBox())!
    const box = (await drawer.boundingBox())!
    // 同一列（被點的卡 hover 時會上浮 1px，所以容許 2px）
    expect(Math.abs(app.y - portal.y)).toBeLessThan(2)
    expect(app.x).toBeCloseTo(app0.x, 0)
    expect(box.y).toBeGreaterThan(portal.y + portal.height)
    // 橫跨整列：左緣對齊第一張卡、右緣超過同列最後一張卡
    expect(box.x).toBeCloseTo(portal.x, 0)
    expect(box.x + box.width).toBeGreaterThanOrEqual(app.x + app.width - 1)
    // 展開中 hover 卡片不上浮，箭頭才會一直貼著速覽
    await ov.card('portal').hover()
    await expect(ov.card('portal')).toHaveCSS('translate', 'none')
    // 抽屜標頭沒有收合鈕，再點一次卡片關掉它
    await expect(drawer.locator('.btn-quick')).toHaveCount(0)
    await ov.card('portal').locator('.card-name').click()
    await expect(ov.cardMain('portal')).toHaveAttribute('aria-expanded', 'false')
    await expect(drawer).toBeHidden()
    // 再展開一次要照常長出來（抽屜在 TransitionGroup 裡，曾被離場處理釘成 absolute、高度 0）
    await ov.card('portal').locator('.card-name').click()
    await expect.poll(async () => (await drawer.boundingBox())?.height ?? 0).toBeGreaterThan(200)
    await expect(drawer).toHaveCSS('position', 'static')
  })

  test('每條泳道只展開一張：同一列換一張時抽屜不收、交叉淡化換內容；別條泳道不受影響', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.card('pmis').locator('.card-name').click()
    await ov.card('portal').locator('.card-name').click()
    await expect.poll(async () => (await ov.drawer('portal').boundingBox())?.height ?? 0).toBeGreaterThan(200)
    // 換成同一列的 app：逐幀量抽屜高度，途中都不能收起來
    const minH = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let min = Infinity
          const t0 = performance.now()
          const tick = () => {
            const d = document.querySelector('[data-pm-col="m8"] .drawer')!
            min = Math.min(min, d.getBoundingClientRect().height)
            if (performance.now() - t0 < 600) requestAnimationFrame(tick)
            else resolve(min)
          }
          requestAnimationFrame(tick)
        }),
    )
    await ov.card('app').locator('.card-name').click()
    expect(await minH).toBeGreaterThan(200)
    // 同列換卡是交叉淡化：舊內容淡出期間新舊兩份都在，等舊的拿掉再讀
    await expect(ov.drawer('app').locator('.qv-name')).toHaveCount(1)
    await expect(ov.drawer('app').locator('.qv-name')).toHaveText('行動 App v2')
    await expect(ov.cardMain('portal')).toHaveAttribute('aria-expanded', 'false')
    await expect(ov.cardMain('app')).toHaveAttribute('aria-expanded', 'true')
    // 成員5 的泳道照舊展開
    await expect(ov.cardMain('pmis')).toHaveAttribute('aria-expanded', 'true')
    await expect(ov.drawer('pmis')).toBeVisible()
  })

  test('一列只放一張時換一張：先收起，再到新那張的下方展開', async ({ page }) => {
    // 640px 寬：標頭在卡片上方，卡片區仍不到兩張卡寬，一列一張
    await page.setViewportSize({ width: 640, height: 900 })
    const ov = new OverviewPage(page); await ov.goto()
    await ov.card('portal').locator('.card-name').click()
    await expect.poll(async () => (await ov.drawer('portal').boundingBox())?.height ?? 0).toBeGreaterThan(200)
    await ov.card('app').locator('.card-name').click()
    const drawer = ov.drawer('app')
    await expect.poll(async () => (await drawer.boundingBox())?.height ?? 0).toBeGreaterThan(200)
    const app = (await ov.card('app').boundingBox())!
    const box = (await drawer.boundingBox())!
    expect(box.y).toBeGreaterThan(app.y + app.height)
    await expect(ov.cardMain('portal')).toHaveAttribute('aria-expanded', 'false')
  })

  test('滑到右緣「進入」直條卡片不浮起；滑到主體才浮起', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    const card = ov.card('app')
    await card.locator('.enter-edge').hover()
    await expect(card).toHaveCSS('translate', 'none')
    await card.locator('.card-name').hover()
    await expect(card).toHaveCSS('translate', '0px -1px')
  })

  test('落後 / 需注意的卡片不換底色與框色，狀態只看 pill 與進度條', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    // wiki 落後、portal 需注意、app 進行中：三張卡同樣白底、--border-1 框
    for (const id of ['wiki', 'portal', 'app']) {
      await expect(ov.card(id)).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(ov.card(id)).toHaveCSS('border-top-color', 'rgb(226, 232, 240)')
    }
    await expect(ov.card('wiki').locator('.pill')).toHaveClass(/pill-late/)
  })

  test('鍵盤：卡片主體上按 Enter 展開；在「進入」上按 Enter 只導頁', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.cardMain('wiki').focus()
    await page.keyboard.press('Enter')
    await expect(ov.cardMain('wiki')).toHaveAttribute('aria-expanded', 'true')
    await ov.card('portal').getByRole('link', { name: /進入/ }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/projects\/portal$/)
  })
})

test.describe('總覽 時間軸', () => {
  test('切到時間軸；可同時展開兩列速覽；標頭有專案名、PM、進入', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await page.locator('[data-view-switch="timeline"]').click()
    await expect(page.locator('[data-view-panel="timeline"]')).toBeVisible()
    await ov.row('pmis').locator('.p-row').click()
    await ov.row('portal').locator('.p-row').click()
    await expect(ov.row('pmis').locator('.qv-head')).toContainText('PMIS 專案管理系統')
    await expect(ov.row('pmis').locator('.qv-head')).toContainText('成員5')
    await expect(ov.row('portal').locator('.qv-head')).toBeVisible()
    await expect(ov.row('pmis').locator('.c-pct')).toHaveText('13% / 20%')
    await expect(ov.row('pmis').locator('.c-gap')).toHaveText('7%')
    await ov.row('portal').locator('.qv-head').getByRole('link', { name: /進入/ }).click()
    await expect(page).toHaveURL(/\/projects\/portal$/)
  })

  test('速覽標頭沒有收合鈕，再點一次列收起', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    await ov.row('wiki').locator('.p-row').click()
    await expect(ov.row('wiki').locator('.qv-head')).toBeVisible()
    await expect(ov.row('wiki').locator('.btn-quick')).toHaveCount(0)
    await ov.row('wiki').locator('.p-row').click()
    await expect(ov.row('wiki').locator('.p-row')).toHaveAttribute('aria-expanded', 'false')
  })

  test('群組列名字旁的膠囊顯示專案數，篩選後跟著變', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const count = page.locator('[data-pm-group="m9"] .pm-count')
    await expect(count).toHaveText('2')
    await expect(count).toHaveAttribute('aria-label', '2 個專案')
    // 成員9 一個已完成、一個未開始
    await ov.pick('status', '已完成')
    await expect(count).toHaveText('1')
  })

  test('群組收合後出現摘要 bar，專案列隱藏', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const g = page.locator('[data-pm-group="m5"]')
    await g.click()
    await expect(g).toHaveAttribute('aria-expanded', 'false')
    await expect(g.locator('.g-sum')).toBeVisible()
    await expect(ov.row('pmis')).toBeHidden()
  })

  test('橫向捲動時左欄固定（sticky 沒被 clip 層弄壞）', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const left = ov.row('pmis').locator('.p-left')
    const body = page.locator('.tl-body')
    await body.evaluate((el) => { el.scrollLeft = 0 })
    const x0 = (await left.boundingBox())!.x
    await body.evaluate((el) => { el.scrollLeft = 400 })
    await expect.poll(async () => (await left.boundingBox())!.x).toBeCloseTo(x0, 0)
  })

  test('畫布上按住拖曳左右平移，放手不會展開該列', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const body = page.locator('.tl-body')
    await body.evaluate((el) => { el.scrollLeft = 300 })
    const canvas = ov.row('pmis').locator('.p-canvas')
    const box = (await canvas.boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 300, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 250, y, { steps: 5 })
    await page.mouse.move(box.x + 200, y, { steps: 5 })
    await page.mouse.up()
    await expect.poll(() => body.evaluate((el) => el.scrollLeft)).toBe(400)
    await expect(ov.row('pmis').locator('.p-row')).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => page.locator('.tl-hbar').evaluate((el) => el.scrollLeft)).toBe(400)
  })

  test('今天按鈕把今天線捲進可見範圍', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto('#timeline')
    const body = page.locator('.tl-body')
    await body.evaluate((el) => { el.scrollLeft = 0 })
    await page.getByTestId('overview-today').click()
    await expect.poll(() => body.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await expect(page.locator('.today-tag')).toBeInViewport()
  })
})

test.describe('總覽 頁面', () => {
  test('檢視切換：卡片 ↔ 時間軸', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await page.locator('[data-view-switch="timeline"]').click()
    await expect(page.locator('[data-view-panel="cards"]')).toHaveCount(0)
    await page.locator('[data-view-switch="cards"]').click()
    await expect(page.locator('[data-view-panel="cards"]')).toBeVisible()
  })

  test('空狀態：已完成 + 落後 沒有專案；面板還在；清除篩選回來', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await ov.pick('status', '已完成')
    await ov.pick('alert', '落後')
    await expect(page.getByTestId('overview-empty')).toBeVisible()
    await expect(page.locator('[data-view-panel="cards"] .panel-head')).toBeVisible()
    await page.getByTestId('overview-empty').getByRole('button', { name: '清除篩選' }).click()
    await expect.poll(() => ov.cardIds()).toHaveLength(7)
  })

  test('載入失敗顯示重試，按下後載入成功', async ({ page }) => {
    // 寫法照 interactions.spec.ts 的同名測試：攔截 __mockApi 的賦值，注入一次失敗
    await page.addInitScript(() => {
      Object.defineProperty(window, '__mockApi', {
        configurable: true,
        set(value: Window['__mockApi']) {
          delete window.__mockApi
          window.__mockApi = value
          value?.failNext('listProjects')
        },
        get() {
          return undefined
        },
      })
    })
    const ov = new OverviewPage(page)
    // 不用 ov.goto()：它會等面板出現，這條測試第一次載入失敗，面板不會出現
    await setFixedTime(page)
    await page.goto('/')
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))
    await expect(page.locator('[data-load-error]')).toHaveText('連線失敗')
    await page.getByRole('button', { name: '重試' }).click()
    await expect.poll(() => ov.cardIds()).toHaveLength(7)
  })

  test('進 Dashboard 再按上一頁，總覽回到原本的捲動位置（spec 7b）', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    // 展開一張卡讓頁面夠長，捲到底，再把要點的連結捲進畫面。
    // 位置要在點擊「之前」量：Playwright 的 click 會自動捲動讓元素可見，router 存的是點擊當下的位置。
    await ov.cardMain('wiki').click()
    // 等速覽展開完（高度動畫結束）才量：頁面還在長高時量到的位置，點擊前就會變掉
    await expect.poll(async () => (await ov.drawer('wiki').boundingBox())!.height).toBeGreaterThan(200)
    // 頁面高度連續兩幀不變＝展開動畫結束
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const h = document.documentElement.scrollHeight
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.documentElement.scrollHeight === h)))
            }),
        ),
      )
      .toBe(true)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const link = ov.card('dw').getByRole('link', { name: /進入/ })
    await link.scrollIntoViewIfNeeded()
    // 在頁面裡同一個 task 讀捲動位置並點連結：router 存的就是這個值。分兩步（先問再點）時中間隔一次往返，
    // 機器忙時速覽展開後的平滑捲動（A28）可能還在走，存下的位置和量到的差幾 px（平行跑實測 404 → 409）
    const y = await link.evaluate((el) => {
      const at = window.scrollY
      ;(el as HTMLElement).click()
      return at
    })
    expect(y).toBeGreaterThan(100)
    await expect(page.locator('[data-panel="gantt"]')).toBeVisible()
    await page.goBack()
    await expect(ov.card('wiki')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y)
  })

  test('Dashboard 改了資料，回總覽就看得到，而且沒有閃出載入中', async ({ page }) => {
    const ov = new OverviewPage(page); await ov.goto()
    await expect(ov.card('pmis').locator('.hero')).toHaveText('13%')
    await ov.card('pmis').getByRole('link', { name: /進入/ }).click()
    await expect(page.locator('[data-panel="gantt"]')).toBeVisible()
    // 直接透過 mock 把一個未完成任務改成完成（等同在 Dashboard 操作），4/30 → 5/30
    // eslint-disable-next-line playwright/no-skipped-test -- 條件式跳過，不是暫時關掉的測試
    test.skip(!(await page.evaluate(() => !!window.__mockApi)))
    await page.evaluate(async () => {
      const api = window.__mockApi!
      const t = (await api.loadProject('pmis')).tasks.find((x) => x.status !== 'done')!
      await api.updateTask(t.id, { status: 'done', done: '2026-09-18' })
    })
    // 記錄回總覽過程中有沒有出現過載入畫面
    await page.evaluate(() => {
      ;(window as unknown as { __sawLoading: boolean }).__sawLoading = false
      new MutationObserver(() => {
        if (document.querySelector('[data-view="overview"] [data-loadstate]')) (window as unknown as { __sawLoading: boolean }).__sawLoading = true
      }).observe(document.body, { subtree: true, childList: true })
    })
    await page.getByRole('link', { name: '所有專案' }).click()
    await expect(ov.card('pmis').locator('.hero')).toHaveText('17%')
    expect(await page.evaluate(() => (window as unknown as { __sawLoading: boolean }).__sawLoading)).toBe(false)
  })
})

