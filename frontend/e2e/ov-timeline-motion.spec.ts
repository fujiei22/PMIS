import { expect, test, type Page } from '@playwright/test'
import { gotoOverview, idle, pause } from './helpers/ovMotion'

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
