import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * task store 的 `inputs` 是存的值（上次寫回的起訖、使用者設定的開始日），畫面要讀推算後的 `tasks`
 * （規則見 docs/reference/scheduling.md〈存與算的分工〉）。兩者型別一樣、讀錯會靜默算出舊日期，
 * 所以用守衛擋：`.inputs` 只准出現在 `stores/` 與測試裡。
 */
const SRC = resolve(process.cwd(), 'src')

/** src 底下所有 .ts / .vue（不含測試目錄）。 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sources(full)
    return /\.(ts|vue)$/.test(name) ? [full] : []
  })
}

describe('task store 的 inputs 只在 stores 裡用', () => {
  it('stores/ 以外的正式程式碼不讀 .inputs', () => {
    const offenders = sources(SRC)
      .filter((f) => !relative(SRC, f).startsWith('stores'))
      .filter((f) => /\.inputs\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
    expect(offenders).toEqual([])
  })
})
