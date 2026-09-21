import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * README 的「怎麼接後端」是後端工程師唯一的入口文件（spec §目標 12）。
 *
 * 文件跟程式一樣會腐爛，而且腐爛得更安靜——`ProjectApi` 加一支方法、
 * README 的端點表沒跟上，後端就會漏做一支 API 而沒有人發現。
 * 這支測試把「表格第一欄的方法名」跟「`src/api/types.ts` 的 `ProjectApi` 方法集合」
 * 綁在一起，兩邊不一致就紅。
 */

const ROOT = process.cwd()

const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8')
const apiTypes = readFileSync(resolve(ROOT, 'src/api/types.ts'), 'utf8')

/** `export interface ProjectApi { ... }` 的內容（到第一個行首 `}` 為止）。 */
function projectApiBody(): string {
  const start = apiTypes.indexOf('export interface ProjectApi {')
  expect(start, '找不到 export interface ProjectApi').toBeGreaterThan(-1)
  const end = apiTypes.indexOf('\n}', start)
  expect(end, 'ProjectApi 沒有收尾的 }').toBeGreaterThan(start)
  return apiTypes.slice(start, end)
}

/** 介面裡宣告的方法名。註解行縮排後是 `*`，不會被這條 regex 命中。 */
function apiMethodNames(): string[] {
  return [...projectApiBody().matchAll(/^ {2}(\w+)\s*\(/gm)].map((m) => m[1]!).sort()
}

/** README 裡某個標題底下、緊接著的第一張表格的第一欄（去掉表頭與分隔列）。 */
function firstColumnUnder(heading: string): string[] {
  const lines = readme.split('\n')
  const at = lines.findIndex((l) => l.trim() === heading)
  expect(at, `README 找不到標題：${heading}`).toBeGreaterThan(-1)
  const rows: string[] = []
  let seen = false
  for (const line of lines.slice(at + 1)) {
    if (!line.trimStart().startsWith('|')) {
      if (seen) break
      continue
    }
    seen = true
    rows.push(line)
  }
  return rows
    .slice(2) // 表頭 + 分隔列
    .map((r) => r.split('|')[1]!.trim())
}

describe('README 的「怎麼接後端」', () => {
  it('有這一節', () => {
    expect(readme).toContain('## 怎麼接後端')
  })

  it.each([
    'ProjectApi',
    'ApiError',
    'VITE_API',
    'subscribe',
    'useProjectBoot',
    'crypto.randomUUID',
  ])('提到 %s', (keyword) => {
    expect(readme).toContain(keyword)
  })

  it('端點對照表列出的方法 = ProjectApi 的方法', () => {
    const documented = firstColumnUnder('### 端點對照表')
      .map((cell) => cell.replace(/`/g, '').replace(/\(.*$/, '').trim())
      .sort()
    expect(documented).toEqual(apiMethodNames())
  })

  it('錯誤碼表涵蓋所有 ApiErrorCode', () => {
    const codes = [...apiTypes.matchAll(/export type ApiErrorCode = ([^\n]+)/g)]
      .flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((c) => c[1]!))
      .sort()
    expect(codes.length, '沒解析到 ApiErrorCode').toBeGreaterThan(0)
    const documented = firstColumnUnder('### 錯誤碼對照表')
      .map((cell) => cell.replace(/`/g, '').trim())
      .sort()
    expect(documented).toEqual(codes)
  })
})
