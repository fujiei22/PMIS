import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const css = readFileSync('src/assets/tokens.css', 'utf8')

describe('tokens.css', () => {
  it('tokens 依 spec 決定調整', () => {
    // Issue 狀態：blocked 改名 paused、文字色以程式值為準
    expect(css).toMatch(/--ist-paused-fg:\s*#b45309/)
    expect(css).not.toMatch(/--ist-blocked/)
    expect(css).toMatch(/--ist-open-fg:\s*#64748b/)
    expect(css).toMatch(/--ist-doing-fg:\s*#2563eb/)
    expect(css).toMatch(/--ist-closed-fg:\s*#059669/)

    // 成員色由資料提供，不建 token
    expect(css).not.toMatch(/--m[1-7]:/)

    // 契約 F 與 spec §設計方向 要補的 token
    for (const t of [
      '--bg-late',
      '--bg-weekend',
      '--bg-today',
      '--t-bar',
      '--fs-6',
      '--r-2',
      '--r-999',
    ])
      expect(css).toContain(t + ':')
  })

  it('補齊程式有用到但原本沒定義的字級與圓角', () => {
    for (const t of [
      '--fs-7',
      '--fs-7-5',
      '--fs-8-5',
      '--fs-9',
      '--fs-10',
      '--fs-10-2',
      '--fs-14',
      '--fs-19',
    ])
      expect(css).toContain(t + ':')
    for (const t of ['--r-2', '--r-3', '--r-4', '--r-6', '--r-999']) expect(css).toContain(t + ':')
  })

  it('契約 F 列的色彩、陰影與動效 token 齊備', () => {
    for (const t of [
      '--bg-late',
      '--bg-weekend',
      '--bg-weekend-head',
      '--bg-today',
      '--focus-soft',
      '--backdrop-modal',
      '--backdrop-lightbox',
      '--shadow-left-col',
      '--shadow-bar',
      '--drag-ghost',
      '--t-bar',
      '--t-progress',
      '--t-hover',
      '--t-menu',
    ])
      expect(css).toContain(t + ':')
  })
})
