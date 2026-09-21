import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test, type Page } from '@playwright/test'
import { setFixedTime } from './clock'

/** 對照的兩個頁面：legacy 原型與改寫後的新頁。 */
export type PageKind = 'legacy' | 'vue'

const URL_OF: Record<PageKind, string> = {
  legacy: '/legacy/Dashboard.html',
  vue: '/',
}

/**
 * `[data-dd]` 觸發器在兩頁的共同索引（全部下拉關閉時的 DOM 順序）。
 * legacy :73 / :117 / :134 / :151 / :167 / :186 / :203 / :222 / :547 / :650 / :673。
 */
export const DD = {
  member: 0,
  status: 1,
  prio: 2,
  group: 3,
  issue: 4,
  icls: 5,
  ist: 6,
  fmode: 7,
  ksort: 8,
  igroup: 9,
  isort: 10,
} as const

/**
 * 固定時鐘後開指定頁面，等 30 條任務列都畫出來。
 * legacy 要先讓 @babel/standalone 把模板編出來，所以逾時放寬。
 */
export async function openDashboard(page: Page, kind: PageKind): Promise<void> {
  await setFixedTime(page)
  await page.goto(URL_OF[kind])
  await expect(page.locator('[data-rowtask]')).toHaveCount(30, { timeout: 30_000 })
  await settle(page)
}

/** 等到動畫（面板 .26s、卡片 .18s、FLIP .16s）與捲動補間都停下來。 */
export async function settle(page: Page, ms = 500): Promise<void> {
  await page.waitForTimeout(ms)
}

/**
 * 把畫面上的浮層（選項選單、日期選擇器、詳細視窗、相依編輯器…）標上 `data-e2e-float`。
 *
 * legacy 的浮層是行內 style 的 `position:fixed`（:1305、:1324、:1349、:1755…），
 * 新頁是 scoped class，沒有共同的選擇器可用；改用「算出來的 position 是 fixed」
 * 這個兩頁都成立的特徵打標記。只打在最外層，且只給有文字的（排除純遮罩）。
 * 標記本身不改變行為，兩頁一視同仁。
 */
export async function markFloating(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-e2e-float]')) {
      el.removeAttribute('data-e2e-float')
    }
    const fixed = [...document.querySelectorAll('body *')].filter((el) => {
      if (getComputedStyle(el).position !== 'fixed') return false
      const r = el.getBoundingClientRect()
      return r.width > 40 && r.height > 20 && (el.textContent ?? '').trim() !== ''
    })
    for (const el of fixed) {
      if (!fixed.some((other) => other !== el && other.contains(el))) {
        el.setAttribute('data-e2e-float', '1')
      }
    }
  })
}

// ── 共用操作 ────────────────────────────────────────────────────────────────

/** 點第 n 個 `[data-dd]` 觸發器（索引用 `DD`）。 */
export async function toggleDropdown(page: Page, index: number): Promise<void> {
  await page.locator('[data-dd]').nth(index).click()
  await settle(page, 250)
}

/**
 * 在剛打開的下拉面板裡點一個選項。
 * 面板在兩頁都緊接在觸發器後面，所以是 `[data-dd]` 的 index + 1。
 */
export async function pickDropdownOption(page: Page, index: number, label: string): Promise<void> {
  await page
    .locator('[data-dd]')
    .nth(index + 1)
    .getByText(label, { exact: true })
    .click()
  await settle(page, 250)
}

/** 甘特左欄任務列；點在名稱區（x=120）而不是把手或日期膠囊上。 */
export async function clickRow(page: Page, taskId: string): Promise<void> {
  await page.locator(`[data-rowtask="${taskId}"]`).click({ position: { x: 120, y: 17 } })
  await settle(page, 400)
}

/**
 * 把甘特橫向捲動固定在 x，兩頁都用「條的 offsetParent 的父層」找捲動容器
 * （legacy :472 的 ganttRef、新頁的 `.gantt-scroller` 都在同一個位置）。
 */
export async function freezeGantt(page: Page, x: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const at = await page.evaluate((v) => {
      const bar = document.querySelector('[data-taskid]') as HTMLElement | null
      const sc = bar?.offsetParent?.parentElement
      if (!sc) return NaN
      sc.scrollLeft = v
      return sc.scrollLeft
    }, x)
    await page.waitForTimeout(150)
    if (Math.abs(at - x) < 1) return
  }
  throw new Error('甘特水平捲動一直停不下來')
}

// ── 快照 ────────────────────────────────────────────────────────────────────

/** 兩頁可比對的文字 / 結構快照。只用契約 E 標 ✓ 的屬性與畫面上的文字。 */
export interface DomSnapshot {
  /** 四張摘要卡的文字。 */
  summary: string
  /** 三個面板標題列的文字（含「共 N 個任務」、排序 chip）。 */
  heads: string[]
  /** 甘特左欄的列順序，分類列前綴 `G:`。 */
  order: string[]
  /** 分類列：`id|文字`。 */
  groups: string[]
  /** 任務列：`id|opacity|文字`。 */
  rows: string[]
  /** 甘特條：`id|opacity|文字`。 */
  bars: string[]
  /** 看板卡：`欄|序號|opacity|文字`（legacy 的 data-card 值固定是 1，只能靠位置認）。 */
  cards: string[]
  /** Issue 卡：`id|opacity|文字`。 */
  issues: string[]
  /** 全部 `[data-dd]` 的文字（順序 = DD 索引）。 */
  dd: string[]
  /** 浮層（選單 / 對話框 / 詳細視窗）的文字。 */
  float: string[]
  /** 整頁文字。上面那些欄位漏掉的地方（頂部列、尺規、工具列…）由它兜底。 */
  body: string
  /** 所有表單控制項的值：`序號|標籤|type|value`。 */
  fields: string[]
}

/** 取一次文字快照；呼叫前若畫面上有浮層要先跑 `markFloating`。 */
export function domSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
    const op = (el: Element): string => Number(getComputedStyle(el).opacity).toFixed(2)
    const all = (sel: string): Element[] => [...document.querySelectorAll(sel)]

    /**
     * 不算進文字的標籤：
     * legacy 的模板與 `DCLogic` 原始碼是內嵌 `<script type="text/babel">`，也是文字節點；
     * textarea 的值 legacy 寫成子文字節點、Vue 用 value property，兩邊取到的不一樣
     * 但畫面相同——表單的值改由 `fields` 直接比 value。
     */
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA'])

    /**
     * 元素底下的文字，依文件順序串起來後**把所有空白拿掉**。
     *
     * 兩頁的文字節點切法不同，直接比 `textContent` 會全錯：
     * legacy 由 dc-runtime 從 HTML 模板產生，元素之間留著原始縮排的空白節點，
     * Vue 的模板編譯器會壓掉；legacy 又把每個 `{{ }}` 包成一層元素，
     * Vue 是純文字節點。去掉全部空白後兩邊才落在同一個基準上。
     *
     * 代價：看不出「字之間空白」的差異。字級 / 間距這類視覺差異改由幾何量測把關。
     */
    const textOf = (root: Element | null | undefined): string => {
      if (!root) return ''
      let out = ''
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          SKIP_TAGS.has(n.parentElement?.tagName ?? '')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      })
      for (let n = walk.nextNode(); n; n = walk.nextNode()) out += n.nodeValue ?? ''
      return out.replace(/\s+/g, '')
    }

    // 摘要卡：四張卡標題的最小共同祖先就是那一排 grid。
    const leaves = all('div,span,h1,h2,h3').filter((e) => e.children.length === 0)
    const anchors = ['專案總時長', '整體進度', '任務狀態', 'Issue 統計']
      .map((t) => leaves.find((e) => norm(e.textContent) === t))
      .filter((e): e is Element => !!e)
    let region: Element | null = anchors[0] ?? null
    while (region && !anchors.every((a) => region!.contains(a))) region = region.parentElement

    // 面板標題列：從計數標籤（「共 N 個任務 / 共 N 筆 Issue」）往上找到含面板名稱的那一層。
    // 不能只取 parentElement——legacy 會把 `{{ }}` 多包一層元素。
    const headOf = (leaf: Element): Element | null => {
      let el = leaf.parentElement
      while (el) {
        const t = textOf(el)
        // 一次含兩個以上面板名稱＝已經爬過頭（爬到整頁）。
        if ((t.match(/專案時程|任務看板|Issue看板/g) ?? []).length > 1) return null
        if (/專案時程|任務看板|Issue看板/.test(t)) return el
        el = el.parentElement
      }
      return null
    }
    const heads = leaves
      .filter((e) => /^共\s*\d+\s*(個任務|筆\s*Issue)$/.test(norm(e.textContent)))
      .map((e) => textOf(headOf(e)))

    return {
      summary: textOf(region),
      heads,
      order: all('[data-rowtask],[data-rowgroup]').map(
        (el) => el.getAttribute('data-rowtask') ?? `G:${el.getAttribute('data-rowgroup')}`,
      ),
      groups: all('[data-rowgroup]').map(
        (el) => `${el.getAttribute('data-rowgroup')}|${textOf(el)}`,
      ),
      rows: all('[data-rowtask]').map(
        (el) => `${el.getAttribute('data-rowtask')}|${op(el)}|${textOf(el)}`,
      ),
      bars: all('[data-taskid]').map(
        (el) => `${el.getAttribute('data-taskid')}|${op(el)}|${textOf(el)}`,
      ),
      cards: all('[data-col]').flatMap((col) =>
        [...col.querySelectorAll('[data-card]')].map(
          (c, i) => `${col.getAttribute('data-col')}|${i}|${op(c)}|${textOf(c)}`,
        ),
      ),
      issues: all('[data-issuerow]').map(
        (el) => `${el.getAttribute('data-issuerow')}|${op(el)}|${textOf(el)}`,
      ),
      dd: all('[data-dd]').map((el) => textOf(el)),
      float: all('[data-e2e-float]').map((el) => textOf(el)),
      body: textOf(document.body),
      fields: [...document.querySelectorAll('input,textarea,select')].map((el, i) => {
        const f = el as HTMLInputElement
        return `${i}|${f.tagName}|${f.type}|${norm(f.value)}`
      }),
    }
  })
}

// ── 幾何量測 ────────────────────────────────────────────────────────────────

/** 一筆幾何量測：`key` 是識別字串，`v` 是要用 ±1px 比對的數值。 */
export interface Metric {
  key: string
  v: number[]
}

/** 幾何快照。座標一律取相對值，避免頁面捲動位置造成假差異。 */
export interface GeoSnapshot {
  /** 任務列：相對第一列左上角的位移 + 尺寸。 */
  rows: Metric[]
  /** 甘特條：相對畫布（offsetParent）左上角的位移 + 尺寸。 */
  bars: Metric[]
  /** 看板卡：相對所屬欄左上角的位移 + 尺寸。 */
  cards: Metric[]
  /** 看板四欄本身的尺寸與頁面座標。 */
  cols: Metric[]
  /** Issue 卡：相對第一張 Issue 卡左上角的位移 + 尺寸。 */
  issues: Metric[]
  /** 每個 `[data-dd]`（下拉觸發器與面板）的尺寸。 */
  dd: Metric[]
  /** 甘特左欄寬、畫布寬、整頁高。 */
  page: Metric[]
  /** 浮層（選單 / 對話框 / 詳細視窗）本身與其直屬子元素的尺寸。 */
  floats: Metric[]
  /** 所有表單控制項的尺寸（詳細視窗左欄 textarea 區的 1-2px 差異靠這裡判定）。 */
  forms: Metric[]
}

/** 取一次幾何快照。 */
export function geoSnapshot(page: Page): Promise<GeoSnapshot> {
  return page.evaluate(() => {
    const all = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)]
    const r = (el: Element): DOMRect => el.getBoundingClientRect()
    const round = (n: number): number => Math.round(n * 10) / 10

    const rows = all('[data-rowtask]')
    const base = rows[0] ? r(rows[0]) : new DOMRect()
    const chart = all('[data-taskid]')[0]?.offsetParent ?? null

    return {
      rows: rows.map((el) => {
        const b = r(el)
        return {
          key: el.getAttribute('data-rowtask') ?? '',
          v: [round(b.x - base.x), round(b.y - base.y), round(b.width), round(b.height)],
        }
      }),
      bars: all('[data-taskid]').map((el) => {
        const b = r(el)
        const c = chart ? r(chart) : new DOMRect()
        return {
          key: el.getAttribute('data-taskid') ?? '',
          v: [round(b.x - c.x), round(b.y - c.y), round(b.width), round(b.height)],
        }
      }),
      cards: all('[data-col]').flatMap((col) => {
        const c = r(col)
        return [...col.querySelectorAll('[data-card]')].map((el, i) => {
          const b = r(el)
          return {
            key: `${col.getAttribute('data-col')}#${i}`,
            v: [round(b.x - c.x), round(b.y - c.y), round(b.width), round(b.height)],
          }
        })
      }),
      cols: all('[data-col]').map((el) => ({
        key: el.getAttribute('data-col') ?? '',
        v: [round(r(el).width), round(r(el).height), round(r(el).y + window.scrollY)],
      })),
      issues: (() => {
        const list = all('[data-issuerow]')
        const first = list[0] ? r(list[0]) : new DOMRect()
        return list.map((el) => {
          const b = r(el)
          return {
            key: el.getAttribute('data-issuerow') ?? '',
            v: [round(b.x - first.x), round(b.y - first.y), round(b.width), round(b.height)],
          }
        })
      })(),
      dd: all('[data-dd]').map((el, i) => ({
        key: `dd${i}`,
        v: [round(r(el).width), round(r(el).height)],
      })),
      page: [
        { key: 'leftCol', v: [round(base.width)] },
        { key: 'chart', v: chart ? [round(r(chart).width), round(r(chart).height)] : [] },
        { key: 'doc', v: [document.documentElement.scrollHeight] },
      ],
      floats: all('[data-e2e-float]').flatMap((f, i) => [
        { key: `float${i}`, v: [round(r(f).width), round(r(f).height)] },
        ...[...f.children].map((c, j) => ({
          key: `float${i}/child${j}`,
          v: [round(r(c).width), round(r(c).height)],
        })),
      ]),
      forms: [...document.querySelectorAll('input,textarea,select')].map((el, i) => ({
        key: `${i}|${el.tagName}`,
        v: [round(r(el).width), round(r(el).height)],
      })),
    }
  })
}

/** 幾何比對：key 序列要完全一樣，數值允許 ±tol px。 */
export function expectGeoClose(actual: Metric[], expected: Metric[], label: string, tol = 1): void {
  expect(
    actual.map((m) => m.key),
    `${label}：元素序列`,
  ).toEqual(expected.map((m) => m.key))
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].v.length, `${label}：${expected[i].key} 量測項數`).toBe(expected[i].v.length)
    for (let j = 0; j < expected[i].v.length; j++) {
      // 超出容許誤差才用 toBe 斷言，讓失敗訊息直接顯示兩邊的實際數值。
      if (Math.abs(actual[i].v[j] - expected[i].v[j]) > tol) {
        expect(actual[i].v[j], `${label}：${expected[i].key}[${j}]（容許 ±${tol}px）`).toBe(
          expected[i].v[j],
        )
      }
    }
  }
}

/**
 * 整頁文字比對。
 * 直接 `toBe` 會把兩份上萬字的字串整個印出來，改成只指出第一個不同的位置與前後文。
 */
export function expectBodyEqual(actual: string, expected: string, label: string): void {
  if (actual === expected) return
  let i = 0
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++
  const around = (s: string): string => `…${s.slice(Math.max(0, i - 40), i + 60)}…`
  expect(around(actual), `${label}：整頁文字第 ${i} 個字起不同（新頁 / legacy）`).toBe(
    around(expected),
  )
}

/** 幾何快照整體比對。 */
export function expectGeoEqual(actual: GeoSnapshot, expected: GeoSnapshot, label: string): void {
  expectGeoClose(actual.rows, expected.rows, `${label} 任務列`)
  expectGeoClose(actual.bars, expected.bars, `${label} 甘特條`)
  expectGeoClose(actual.cards, expected.cards, `${label} 看板卡`)
  expectGeoClose(actual.cols, expected.cols, `${label} 看板欄`)
  expectGeoClose(actual.issues, expected.issues, `${label} Issue 卡`)
  expectGeoClose(actual.dd, expected.dd, `${label} 下拉`)
  expectGeoClose(actual.page, expected.page, `${label} 整頁`)
  expectGeoClose(actual.floats, expected.floats, `${label} 浮層`)
  expectGeoClose(actual.forms, expected.forms, `${label} 表單控制項`)
}

// ── 情境執行器 ──────────────────────────────────────────────────────────────

/** 情境把每一步的快照交給 `capture`；同一組操作在兩頁各跑一次。 */
export type Capture = (label: string) => Promise<void>
export type Scenario = (page: Page, capture: Capture) => Promise<void>

/** 一步的結果：文字快照 + 幾何快照。 */
export interface Step {
  label: string
  dom: DomSnapshot
  geo: GeoSnapshot
}

/** 在一個頁面上跑完情境，回傳每一步的快照。 */
export async function runScenario(page: Page, kind: PageKind, scenario: Scenario): Promise<Step[]> {
  await openDashboard(page, kind)
  const steps: Step[] = []
  const capture: Capture = async (label) => {
    await markFloating(page)
    steps.push({ label, dom: await domSnapshot(page), geo: await geoSnapshot(page) })
  }
  await scenario(page, capture)
  return steps
}

/**
 * 新建立的實體，id 在兩頁一定不一樣：legacy 用 100 起跳的流水號（g101 / t101…），
 * 新頁改成 UUID v4（spec 目標 4）。比對前把這類 id 換成出現順序的代號（NEW1、NEW2…），
 * 「順序與結構一致」才是要比的東西，id 字面值不是。
 * mocks 既有的 g1 / t30 / c5 是一到兩位數，不會被換掉。
 */
const GENERATED_ID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[gtidc]\d{3,}\b/g

/** 同一步的 dom + geo 共用一份對照表，兩頁各自按首次出現的順序編號。 */
function normaliseIds(step: Step): Step {
  const seen = new Map<string, string>()
  const text = JSON.stringify(step).replace(GENERATED_ID, (hit) => {
    let token = seen.get(hit)
    if (!token) {
      token = `NEW${seen.size + 1}`
      seen.set(hit, token)
    }
    return token
  })
  return JSON.parse(text) as Step
}

/**
 * 同一組操作在 legacy 與新頁各跑一次並逐步比對。
 *
 * `options.geo` 設 false 就只比文字（拖曳中途之類的步驟用）。
 * 設環境變數 `COMPARE_DUMP=<目錄>` 會把兩邊的原始快照寫成 JSON，方便人工比對差異。
 */
export async function compareScenario(
  page: Page,
  scenario: Scenario,
  options: { geo?: boolean } = {},
): Promise<void> {
  const legacy = (await runScenario(page, 'legacy', scenario)).map(normaliseIds)
  const vue = (await runScenario(page, 'vue', scenario)).map(normaliseIds)

  const dumpDir = process.env.COMPARE_DUMP
  if (dumpDir) {
    const name = test.info().title.replace(/[^\p{L}\p{N}]+/gu, '_')
    await mkdir(dumpDir, { recursive: true })
    await writeFile(join(dumpDir, `${name}.legacy.json`), JSON.stringify(legacy, null, 2), 'utf8')
    await writeFile(join(dumpDir, `${name}.vue.json`), JSON.stringify(vue, null, 2), 'utf8')
  }

  expect(
    vue.map((s) => s.label),
    '兩頁的步驟數要一樣',
  ).toEqual(legacy.map((s) => s.label))

  for (let i = 0; i < legacy.length; i++) {
    const label = legacy[i].label
    // 先比細項（訊息好讀），整頁文字最後才比。
    const { body: legacyBody, ...legacyRest } = legacy[i].dom
    const { body: vueBody, ...vueRest } = vue[i].dom
    expect(vueRest, `步驟「${label}」的文字 / 結構`).toEqual(legacyRest)
    expectBodyEqual(vueBody, legacyBody, `步驟「${label}」`)
    if (options.geo !== false) expectGeoEqual(vue[i].geo, legacy[i].geo, `步驟「${label}」`)
  }
}
