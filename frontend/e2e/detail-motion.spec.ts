import { expect, test, type Page } from '@playwright/test'
import { idle, openDashboard, openTaskDetail, pause, peakThenFall, series, trace, ui, type Trace } from './helpers/motion'
import { withPremise } from './helpers/ovMotion'

/** 詳情 Modal 的開關銜接（動畫稽核 G2 / G3 / G4 / G10 / G13）。 */
test.use({ viewport: { width: 1920, height: 1080 } })

test('G13 平滑捲動途中開詳情：背景停在開啟當下，關閉後不跳', async ({ page }) => {
  await openDashboard(page)
  await page.locator('.top-bar .board-link', { hasText: 'Issue' }).click()
  // 確認真的還在平滑捲動（捲完了這條就沒有鑑別力）
  const moving = await page.evaluate(async () => {
    const a = scrollY
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return scrollY !== a
  })
  expect(moving, '開詳情前還在捲').toBe(true)
  await ui(page, 'openDetail', 't3', 'task')
  await expect(page.locator('.detail-modal')).toBeVisible()
  const atOpen = await page.evaluate(() => scrollY)
  await pause(page, 600)
  expect(await page.evaluate(() => scrollY), '開著的期間背景不再捲').toBe(atOpen)
  await page.locator('.detail-close').click()
  await expect(page.locator('.detail-modal')).toHaveCount(0)
  expect(Math.abs((await page.evaluate(() => scrollY)) - atOpen), '關閉後沒有跳回半途').toBeLessThanOrEqual(1)
})

test('G2 關閉動畫期間，點擊直接落到底下的元素', async ({ page }) => {
  await openDashboard(page)
  await openTaskDetail(page, 't3')
  const hits = await page.evaluate(async () => {
    // 頂欄右側的使用者膠囊一定在遮罩底下
    const target = document.querySelector('.top-bar .me') as HTMLElement
    const r = target.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    ;(document.querySelector('.detail-close') as HTMLElement).click()
    const out: boolean[] = []
    await new Promise<void>((done) => {
      const tick = (): void => {
        if (!document.querySelector('.detail-modal')) return done()
        out.push(target.contains(document.elementFromPoint(x, y)))
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    return out
  })
  expect(hits.length, '關閉動畫確實跑了幾幀').toBeGreaterThan(3)
  expect(hits.every(Boolean), '關閉動畫期間點得到底下的元素').toBe(true)
})

test('G2 關閉中再點一下，不會延長卸載', async ({ page }) => {
  await openDashboard(page)
  await openTaskDetail(page, 't3')
  const ms = await page.evaluate(async () => {
    const t0 = performance.now()
    ;(document.querySelector('.detail-backdrop') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 60))
    // 使用者在左下角再點一下：點擊落在那個位置最上層的元素（現況是還在淡出的遮罩，會重設 hold）
    ;(document.elementFromPoint(5, 1075) as HTMLElement | null)?.click()
    await new Promise<void>((done) => {
      const tick = (): void => (document.querySelector('.detail-modal') ? void requestAnimationFrame(tick) : done())
      tick()
    })
    return performance.now() - t0
  })
  // 關閉動畫 --t-modal 170ms；現況第二下重設 320ms 的 hold，約 380ms 才卸載
  expect(ms).toBeLessThan(280)
})

/**
 * 頁內點開 t3 詳情，逐幀看 Modal 的透明度，淡入走到 0.15 以上的那一幀就點遮罩關閉（不用固定 60ms：機器忙時計時器晚到，
 * Modal 已經開到接近全亮，峰值本來就會 ≥ 0.98）。回傳錄影與關閉時的透明度。
 */
async function openThenCloseMidway(page: Page): Promise<{ tr: Trace; at: number }> {
  let at = 1
  const tr = await trace(page, { modal: '.detail-modal', backdrop: '.detail-backdrop' }, async () => {
    at = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          ;(document.querySelector('[data-card="t3"] .caret') as HTMLElement).click()
          const start = performance.now()
          const tick = (): void => {
            const m = document.querySelector('.detail-modal')
            const o = m ? parseFloat(getComputedStyle(m.closest('.detail-layer') ?? m).opacity) * parseFloat(getComputedStyle(m).opacity) : 0
            if (o > 0.15) {
              ;(document.querySelector('.detail-backdrop') as HTMLElement | null)?.click()
              resolve(o)
            } else if (performance.now() - start > 2000) reject(new Error('詳情 2 秒內沒有開始淡入'))
            else requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
    )
  })
  return { tr, at }
}

test('G10 開到一半就關：Modal 與遮罩的透明度不先閃全亮、最亮之後一路往下', async ({ page }) => {
  // 前提：關閉時 Modal 還在淡入途中（< 0.7）；那一幀剛好卡住、一次亮太多就重開頁面重來
  const { tr } = await withPremise(async () => {
    await openDashboard(page)
    await page.locator('[data-card="t3"]').scrollIntoViewIfNeeded()
    await idle(page)
    const r = await openThenCloseMidway(page)
    return { value: r, valid: r.at < 0.7, why: `關閉時 Modal 已亮到 ${r.at.toFixed(2)}` }
  })
  for (const name of ['modal', 'backdrop']) {
    const r = peakThenFall(series(tr, name).map((b) => b.o))
    expect(r.peak, `${name} 被打斷了，最亮不到全亮`).toBeLessThan(0.98)
    expect(r.rises, `${name} 過了最亮之後又變亮的幀數`).toBe(0)
  }
})

test('G3 從任務點進的 Issue 關閉：返回膠囊與標題一路維持到淡出完', async ({ page }) => {
  await openDashboard(page)
  await openTaskDetail(page, 't3')
  await page.locator('.detail-issue-row').first().click()
  await expect(page.locator('.detail-back')).toBeVisible()
  await idle(page)
  const tr = await trace(page, { modal: '.detail-modal', back: '.detail-back', title: '.detail-title' }, () =>
    page.locator('.detail-close').click(),
  )
  const seen = tr.frames.filter((f) => f.boxes.modal && f.boxes.modal.o >= 0.05)
  expect(seen.length).toBeGreaterThan(2)
  expect(seen.every((f) => f.boxes.back !== null), '看得見的每一幀返回膠囊都在').toBe(true)
  // 標題只隨關閉動畫的縮放微動（scale 0.975，最陡一幀約 4px）；現況第一幀整段左移 106px
  const xs = seen.map((f) => f.boxes.title!.x)
  expect(xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1]!) < 8), '標題單幀跳位').toBe(true)
})

/** 點下 clickSel（頁內直接點，不等 Playwright 往返）後逐幀記左右欄全文，直到 Modal 卸載。 */
async function textsWhileClosing(page: import('@playwright/test').Page, clickSel: string) {
  return page.evaluate(async (clickSel) => {
    ;(document.querySelector(clickSel) as HTMLElement).click()
    const out: { o: number; left: string | null; right: string | null }[] = []
    await new Promise<void>((done) => {
      const tick = (): void => {
        const modal = document.querySelector('.detail-modal')
        if (!modal) return done()
        let o = 1
        for (let n: Element | null = modal; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity)
        out.push({
          o,
          left: document.querySelector('.detail-left')?.textContent ?? null,
          right: document.querySelector('.detail-right')?.textContent ?? null,
        })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    return out
  }, clickSel)
}

const panes = (page: import('@playwright/test').Page) =>
  page.evaluate(() => [document.querySelector('.detail-left')!.textContent, document.querySelector('.detail-right')!.textContent])

test('G4 在詳情裡刪除 Issue：淡出期間左右欄維持刪除前的內容', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openDashboard(page)
  await openTaskDetail(page, 't3')
  await page.locator('.detail-issue-row').first().click()
  await expect(page.locator('.delete-issue')).toBeVisible()
  await idle(page)
  const [left, right] = await panes(page)
  const seen = (await textsWhileClosing(page, '.delete-issue')).filter((f) => f.o >= 0.05)
  expect(seen.length).toBeGreaterThan(2)
  for (const f of seen) {
    expect(f.left).toBe(left)
    expect(f.right).toBe(right)
  }
  expect(errors).toEqual([])
})

test('G4 在詳情裡刪除任務（兩步確認）：淡出期間左右欄維持刪除前的內容', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openDashboard(page)
  await openTaskDetail(page, 't3')
  const [left, right] = await panes(page)
  await page.locator('.delete-task').click()
  await page.locator('.confirm-dialog .btn-next').click()
  await expect(page.locator('.confirm-dialog .btn-danger')).toBeVisible()
  const seen = (await textsWhileClosing(page, '.confirm-dialog .btn-danger')).filter((f) => f.o >= 0.05)
  expect(seen.length).toBeGreaterThan(2)
  for (const f of seen) {
    expect(f.left).toBe(left)
    expect(f.right).toBe(right)
  }
  expect(errors).toEqual([])
})

test('關閉途中再開另一筆：舊的立即讓位、畫面上只有一個 Modal，內容是新的那筆', async ({ page }) => {
  await openDashboard(page)
  const t4 = await page.locator('[data-card="t4"] .title').innerText()
  await openTaskDetail(page, 't3')
  const tr = await trace(page, { modal: '.detail-modal' }, () =>
    page.evaluate(() => {
      ;(document.querySelector('.detail-close') as HTMLElement).click()
      setTimeout(() => {
        const app = (document.querySelector('#app') as unknown as {
          __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, { openDetail: (id: string, kind: string) => void }> } } } }
        }).__vue_app__
        app.config.globalProperties.$pinia._s.get('ui')!.openDetail('t4', 'task')
      }, 60)
    }),
  )
  expect(Math.max(...series(tr, 'modal').map((b) => b.n)), '同時存在的 Modal 數').toBe(1)
  await expect(page.locator('.detail-modal')).toContainText(t4)
})
