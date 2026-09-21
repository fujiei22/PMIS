import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ===== store 分層規則（契約 E、spec 目標 6）=====
 *
 * 三層，只能由上往下依賴：
 *
 * 1. **時鐘層** `clock` —— 所有層都可以讀。
 * 2. **資料層** `member / task / issue / comment`（加上它們共用的
 *    `_optimistic` 與事件入口 `_sync`）—— 專案資料的唯一擁有者。
 * 3. **派生層** `rows / filter / selection / ui` —— 讀資料層算出畫面要的東西。
 *
 * 資料層**不知道派生層存在**：
 * - 不讀 selection / filter 算預設值 → 預設值由 `composables/useTaskActions.ts` 算好傳進來。
 * - 不寫 ui → 懸空 id 由 `selection.ts` / `ui.ts` 各自的 `watch(flush:'sync')` 清；
 *   api 失敗的錯誤條由 `_optimistic.setErrorSink()` 注入的 sink 送出去。
 *
 * 這條規則靠這支測試守著：直接讀原始碼的 import 敘述，不靠執行期。
 * 豁免 `import type`（型別在編譯後就消失，不構成執行期依賴）；
 * 禁 barrel（`@/stores` / `@/stores/index`）——它會把整層一次拖進來。
 *
 * 派生層之間不做環檢：Pinia 的 `useX()` 是延遲呼叫，`ui ↔ selection`
 * 這種互相引用在執行期沒有問題（review C4）。
 */

/** 受檢查的檔（資料層 + 它們的共用機制）。 */
const DATA_LAYER = [
  'member.ts',
  'task.ts',
  'issue.ts',
  'comment.ts',
  '_optimistic.ts',
  '_sync.ts',
] as const

/** 資料層可以 import 的 `@/` 路徑。 */
const ALLOWED = [
  /^@\/api(\/.*)?$/,
  /^@\/lib\/.*$/,
  /^@\/types\/.*$/,
  /^@\/stores\/clock$/,
  /^@\/stores\/(member|task|issue|comment)$/,
  /^@\/stores\/_optimistic$/,
  /^@\/stores\/_sync$/,
]

/** `import ... from '<spec>'` / `export ... from '<spec>'`；`type` 前綴另外抓。 */
const FROM_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([\s\S]*?)\s*from\s+'([^']+)'/g

interface Dep {
  spec: string
  typeOnly: boolean
}

function depsOf(file: string): Dep[] {
  const src = readFileSync(resolve(process.cwd(), 'src/stores', file), 'utf8')
  const out: Dep[] = []
  for (const m of src.matchAll(FROM_RE)) {
    const typeOnly = !!m[1]
    // 相對路徑一律當成同層 store，避免用 './ui' 繞過白名單
    const raw = m[3]!
    const spec = raw.startsWith('.') ? `@/stores/${raw.replace(/^\.+\//, '')}` : raw
    out.push({ spec, typeOnly })
  }
  return out
}

describe('store 分層（契約 E）', () => {
  it.each(DATA_LAYER)('%s 只 import 白名單內的模組', (file) => {
    const bad = depsOf(file)
      .filter((d) => !d.typeOnly && d.spec.startsWith('@/'))
      .filter((d) => !ALLOWED.some((re) => re.test(d.spec)))
      .map((d) => d.spec)
    expect(bad).toEqual([])
  })

  it.each(DATA_LAYER)('%s 不從 barrel 匯入', (file) => {
    const barrel = depsOf(file)
      .map((d) => d.spec)
      .filter((s) => s === '@/stores' || s === '@/stores/index' || s === '@/stores/index.ts')
    expect(barrel).toEqual([])
  })

  it('派生層的 rows 才是 visibleRows 的家', () => {
    const task = depsOf('task.ts').map((d) => d.spec)
    expect(task).not.toContain('@/stores/rows')
  })
})
