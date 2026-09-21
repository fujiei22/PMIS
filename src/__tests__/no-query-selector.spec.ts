import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 契約 F：執行期不再用 DOM 選擇器找元素，一律走 `useDomRegistry` 的登錄表。
 *
 * `data-*` 屬性回到「測試 / CSS 專用」的定位（spec §目標 9），
 * 所以 `src/**` 的產品程式碼不得出現 `querySelector` / `querySelectorAll` /
 * `getElementById` / `elementFromPoint`。`__tests__` 底下不在此限——
 * 單元測試要用選擇器檢查畫出來的 DOM。
 */

/** 唯一的執行期例外：`useClickOutside` 的 DOM hit-test（review M10，README 也標了同一條）。 */
const ALLOWLIST = ['composables/useClickOutside.ts']

const BANNED = ['querySelectorAll', 'querySelector', 'getElementById', 'elementFromPoint'] as const

const SRC = resolve(process.cwd(), 'src')

/** 走訪 `src/**` 的 .ts / .vue，跳過 `__tests__`。 */
function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue
      collect(full, out)
      continue
    }
    if (/\.(ts|vue)$/.test(name)) out.push(full)
  }
  return out
}

/** Windows 的反斜線轉成 `/`，白名單與失敗訊息才有一致的寫法。 */
function posix(file: string): string {
  return relative(SRC, file).split('\\').join('/')
}

describe('src 不留執行期 DOM 選擇器（契約 F）', () => {
  const files = collect(SRC)

  it('掃得到檔案（避免路徑寫錯時假綠）', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each(BANNED)('沒有任何檔案使用 %s', (token) => {
    const hits = files
      .filter((f) => !ALLOWLIST.includes(posix(f)))
      .filter((f) => readFileSync(f, 'utf8').includes(token))
      .map(posix)
    expect(hits).toEqual([])
  })
})
