import { expect, test, type Page } from '@playwright/test'
import { idle, openDashboard, pause } from './helpers/motion'

/** 看板卡片負責人頭像的 hover 展開 / 收合節奏（動畫稽核 G14）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

const SEL = '[data-card] .avatar.expandable'
type Run = { t0: number; out: [number, number][]; stop: boolean; off: () => void }

/** 執行 act，以 max-width 過渡開始（transitionrun）為 0 點逐幀記寬度。 */
async function widthRun(page: Page, act: () => Promise<void>): Promise<[number, number][]> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement
    const run: Run = { t0: -1, out: [], stop: false, off: () => {} }
    const onRun = (e: TransitionEvent): void => {
      if (e.propertyName === 'max-width' && run.t0 < 0) run.t0 = e.timeStamp
    }
    el.addEventListener('transitionrun', onRun)
    run.off = () => el.removeEventListener('transitionrun', onRun)
    ;(window as unknown as { __run: Run }).__run = run
    const tick = (): void => {
      run.out.push([performance.now(), el.getBoundingClientRect().width])
      if (!run.stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, SEL)
  await act()
  await pause(page, 450)
  return page.evaluate(() => {
    const run = (window as unknown as { __run: Run }).__run
    run.stop = true
    run.off()
    if (run.t0 < 0) throw new Error('沒有 max-width 過渡')
    return run.out.map(([t, w]) => [t - run.t0, w] as [number, number])
  })
}

/** 寬度第一次走到全程 p 的時間（相鄰兩幀線性內插；過渡是時間的函數，掉幀也準）。 */
function crossAt(s: [number, number][], p: number): number {
  const w0 = s[0]![1]
  const w1 = s[s.length - 1]![1]
  const target = w0 + (w1 - w0) * p
  for (let i = 1; i < s.length; i++) {
    const [ta, wa] = s[i - 1]!
    const [tb, wb] = s[i]!
    if ((wb - target) * Math.sign(w1 - w0) >= 0) return wb === wa ? tb : ta + ((target - wa) / (wb - wa)) * (tb - ta)
  }
  return Infinity
}

test('G14 頭像 hover 展開 / 收合：寬度變化分布在整段過渡裡，終點寬度不變', async ({ page }) => {
  await openDashboard(page)
  const av = page.locator(SEL).first()
  await av.scrollIntoViewIfNeeded()
  await idle(page)
  const b = (await av.boundingBox())!

  const grow = await widthRun(page, () => page.mouse.move(b.x + b.width / 2, b.y + b.height / 2))
  // 終點 = 縮寫 + 姓名 + 右側留白 + 框線（與現況相同）
  const full = await page.locator(SEL).first().evaluate((el) => {
    const cs = getComputedStyle(el)
    const [glyph, name] = [el.querySelector('.glyph') as HTMLElement, el.querySelector('.name') as HTMLElement]
    return glyph.offsetWidth + name.offsetWidth + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)
  })
  expect(Math.abs(grow[grow.length - 1]![1] - full), '展開終點寬度').toBeLessThanOrEqual(0.5)
  // --t-layout 240ms、--ease：寬度過半應在 ~95ms；現況 max-width 目標 160px 遠大於內容，~60ms 就過半（實測 61 / 98ms）
  expect(crossAt(grow, 0.5), '展開過半的時間（ms）').toBeGreaterThanOrEqual(80)

  const shrink = await widthRun(page, () => page.mouse.move(5, 1075))
  // 收合縮掉四分之一應在 ~45ms；現況前 100ms 只縮右側留白（實測 115 / 47ms）
  expect(crossAt(shrink, 0.25), '收合縮掉四分之一的時間（ms）').toBeLessThanOrEqual(80)
})
