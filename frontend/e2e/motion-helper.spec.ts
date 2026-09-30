import { expect, test } from '@playwright/test'
import { hasMid, openDashboard, peakThenFall, series, trace } from './helpers/motion'

test.use({ viewport: { width: 1920, height: 1080 } })

test('trace：過渡量得到中間值與祖先的透明度，瞬間切換量不到中間值', async ({ page }) => {
  await openDashboard(page)
  await page.evaluate(() => {
    const box = (id: string, css: string): HTMLElement => {
      const d = document.createElement('div')
      d.id = id
      d.style.cssText = `position:fixed;left:10px;top:10px;width:40px;height:40px;background:#000;${css}`
      document.body.appendChild(d)
      return d
    }
    box('probe-fade', 'transition:opacity 200ms linear')
    box('probe-snap', '')
    box('probe-parent', 'transition:opacity 200ms linear').appendChild(
      Object.assign(document.createElement('i'), { id: 'probe-child' }),
    )
  })
  const tr = await trace(page, { fade: '#probe-fade', snap: '#probe-snap', child: '#probe-child' }, () =>
    page.evaluate(() => {
      for (const id of ['probe-fade', 'probe-snap', 'probe-parent'])
        (document.getElementById(id) as HTMLElement).style.opacity = '0'
    }),
  )
  const o = (name: string): number[] => series(tr, name).map((b) => b.o)
  expect(tr.frames.length, '有錄到幀').toBeGreaterThan(20)
  expect(hasMid(o('fade')), '過渡有中間值').toBe(true)
  expect(hasMid(o('snap')), '瞬間切換沒有中間值').toBe(false)
  expect(hasMid(o('child')), '子元素吃得到父層的透明度').toBe(true)
  expect(peakThenFall(o('fade')).rises, '淡出一路往下').toBe(0)
})
