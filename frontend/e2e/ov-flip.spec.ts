import { expect, test, type Page } from '@playwright/test'
import { gotoOverview, idle, jumpCount, opacityJumps, pause, speedJumps, trace, type Trace } from './helpers/ovMotion'

/** 泳道內卡片的重排中斷（動畫稽核 R3：C2 a、T4、T5）。量卡片相對自己泳道 .lane-body 的位置：泳道本身的移動由 Task 4a 另外量。 */
test.use({ viewport: { width: 1920, height: 1080 } })

const P = '[data-view-panel="cards"]'
/** samplePortfolio 的 7 個專案（`src/mocks/samplePortfolio.ts`）。 */
const IDS = ['pmis', 'portal', 'payment', 'dw', 'app', 'wiki', 'vendor']

/** 每張卡與它所在的 .lane-body（`:has()` 找父層；卡片離場中仍是它的子元素）。 */
const TARGETS = Object.fromEntries(
  IDS.flatMap((id) => [
    [id, `${P} [data-project="${id}"]`],
    [`${id}:body`, `${P} .lane-body:has(> [data-project="${id}"])`],
  ]),
)

/** 卡片相對所在 .lane-body 的逐幀位置（x + y）與透明度；卡片或泳道不在畫面上的幀略過。 */
function relative(tr: Trace, id: string): { t: number; dt: number; v: number; o: number }[] {
  return tr.frames
    .filter((f) => f.boxes[id] && f.boxes[`${id}:body`])
    .map((f) => {
      const c = f.boxes[id]!
      const b = f.boxes[`${id}:body`]!
      return { t: f.t, dt: f.dt, v: c.y - b.y + (c.x - b.x), o: c.o }
    })
}

/** 現在（靜止時）卡片相對所在 .lane-body 的位置，算法同 relative。 */
function restingAt(page: Page, id: string): Promise<number> {
  return page.evaluate(
    ({ card, body }) => {
      const c = document.querySelector(card)!.getBoundingClientRect()
      const b = document.querySelector(body)!.getBoundingClientRect()
      return c.top - b.top + (c.left - b.left)
    },
    { card: TARGETS[id]!, body: TARGETS[`${id}:body`]! },
  )
}

/**
 * 同方向移動途中頓一下的次數：某一幀幾乎沒動（< 0.5px），前一步與接下來三步卻都朝同一方向動（> 2px）。
 * 篩選結果沒變的更新（打字多打一個字）若讓進行中的位移從頭起跳，曲線從 0 速重新加速，就是這個樣子；
 * 被打斷後折返（接下來往反方向動）不算。
 */
function stalls(pts: { v: number }[]): number {
  const steps = pts.map((p, i) => (i === 0 ? 0 : p.v - pts[i - 1]!.v))
  let n = 0
  for (let i = 2; i < steps.length; i++) {
    const before = steps[i - 1]!
    const after = steps.slice(i + 1, i + 4).reduce((a, b) => a + b, 0)
    if (Math.abs(steps[i]!) < 0.5 && Math.abs(before) > 2 && Math.abs(after) > 2 && Math.sign(after) === Math.sign(before)) n++
  }
  return n
}

async function typeThenDelete(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch)
    await pause(page, 80)
  }
  for (let i = 0; i < text.length; i++) {
    await page.keyboard.press('Backspace')
    await pause(page, 80)
  }
}

test('搜尋打一個字 80ms 內刪掉：移動中的卡從半路折返，不先瞬移到原本的終點（C2 a）', async ({ page }) => {
  await gotoOverview(page)
  const search = page.getByTestId('overview-search')
  // app 卡：打 p 之後同泳道的 portal 被篩掉，app 從第二格往第一格移；先量兩個靜止位置
  const start = await restingAt(page, 'app')
  await search.fill('p')
  await idle(page)
  const dest = await restingAt(page, 'app')
  await search.fill('')
  await idle(page)
  const dist = Math.abs(start - dest)
  expect(dist, '打 p 會讓 app 卡換位置').toBeGreaterThan(100)

  await search.focus()
  const tr = await trace(page, TARGETS, () => typeThenDelete(page, 'p'))
  const app = relative(tr, 'app')
  expect(Math.max(...app.map((p) => Math.abs(p.v - start))), '有在移動途中被打斷').toBeGreaterThan(0.1 * dist)
  // 修正前：起點不含進行中的位移，Backspace 那一幀先跳到原本的終點（第一格）再滑回第二格
  expect(Math.min(...app.map((p) => Math.abs(p.v - dest))), '先瞬移到原本的終點').toBeGreaterThan(0.1 * dist)
  // 一直留在畫面上的卡（符合 p 的兩張）都不瞬移。用速度判斷、不用 jumpCount（佔全距比例）：泳道原地收合後被打斷得早，
  // 全距只剩約 85px，一步正常的緩動（約 44px）就超過一半而被誤判；速度判斷只抓「這一幀比前後都快很多」的真瞬移。
  // 被篩掉又在離場中回來的卡（portal、payment…）是新元素，從舊卡當下的位置、透明度與大小接續（useFreezeReenter），
  // 在 ov-reenter.spec 量，不在這裡量。
  for (const id of ['pmis', 'app']) expect(speedJumps(relative(tr, id)), id).toBe(0)
})

test('逐字打 app（每字 80ms）再逐字刪：卡片不瞬移、移動途中不頓、透明度不跳', async ({ page }) => {
  await gotoOverview(page)
  await page.getByTestId('overview-search').focus()
  // 打 a 之後只剩 app；後面兩個 p 篩選結果不變，但每打一字泳道都會重新渲染，進行中的位移要照跑
  const tr = await trace(page, TARGETS, () => typeThenDelete(page, 'app'), { ms: 1200 })
  for (const id of IDS) {
    const r = relative(tr, id)
    expect(jumpCount(r), `${id} 瞬移`).toBe(0)
    expect(stalls(r), `${id} 移動途中頓一下`).toBe(0)
    expect(opacityJumps(r), `${id} 透明度跳`).toBe(false)
  }
})

test('清除篩選後 100ms 再篩：淡入中又被重排的卡，透明度不直接跳到 1（T5）', async ({ page }) => {
  await gotoOverview(page)
  const search = page.getByTestId('overview-search')
  await search.fill('金')
  await idle(page)
  const tr = await trace(page, TARGETS, async () => {
    // 成員5 的泳道在 09-18 是 payment、pmis（同落後，依到期日）。
    // 清除後 pmis 在 m5 泳道第二格淡入；100ms 後篩「pmis」：payment 被篩掉，淡入中的 pmis 移到第一格
    await page.getByTestId('overview-clear').click()
    await pause(page, 100)
    await search.fill('pmis')
  })
  const pmis = relative(tr, 'pmis')
  expect(Math.max(...pmis.map((p) => p.v)) - Math.min(...pmis.map((p) => p.v)), 'pmis 有被重排').toBeGreaterThan(100)
  for (const id of IDS) expect(opacityJumps(relative(tr, id)), id).toBe(false)
})
