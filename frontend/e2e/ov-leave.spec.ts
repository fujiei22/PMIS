import { expect, test } from '@playwright/test'
import { endSnap, gotoOverview, jumpCount, series, speedJumps, trace } from './helpers/ovMotion'

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
