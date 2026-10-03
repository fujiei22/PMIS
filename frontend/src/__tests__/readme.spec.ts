import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import { DURATION_MAX, isLate, isPlannedDone, lateDays, scheduleWithPlan } from '@/lib/schedule'
import { createWorkdays } from '@/lib/workdays'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import { sampleProject } from '@/mocks/sampleProject'

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
const models = readFileSync(resolve(ROOT, 'src/types/models.ts'), 'utf8')
/** 排程規則文件（repo 根目錄的 docs/）；還沒建立時是 ''，由「檔案存在」那則測試報紅，不讓整支檔案載入失敗。 */
const SCHEDULING_PATH = resolve(ROOT, '../docs/reference/scheduling.md')
const scheduling = existsSync(SCHEDULING_PATH) ? readFileSync(SCHEDULING_PATH, 'utf8') : ''

/** README 裡 Task 欄位對照表的標題。 */
const TASK_FIELDS_HEADING = '### Task 欄位對照表（前端 ↔ wire ↔ DB）'
/** scheduling.md 裡檢查點表的標題。 */
const CHECKPOINT_HEADING = '## 檢查點（測試向量）'

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

/**
 * 某份文件裡某個標題底下、緊接著的第一張表格：每一列切成儲存格（去掉表頭與分隔列、頭尾空白）。
 * 儲存格內容不能有 `|`（文件裡的表都沒有）。
 */
function tableUnder(doc: string, heading: string, name = 'README'): string[][] {
  const lines = doc.split('\n')
  const at = lines.findIndex((l) => l.trim() === heading)
  expect(at, `${name} 找不到標題：${heading}`).toBeGreaterThan(-1)
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
    .map((r) =>
      r
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
}

/** README 裡某個標題底下、緊接著的第一張表格的第一欄（去掉表頭與分隔列）。 */
function firstColumnUnder(heading: string): string[] {
  return tableUnder(readme, heading).map((cells) => cells[0]!)
}

/** `export interface Task { ... }` 宣告的欄位名（註解行縮排後是 `*`，不會被命中）。 */
function taskFieldNames(): string[] {
  const start = models.indexOf('export interface Task {')
  expect(start, '找不到 export interface Task').toBeGreaterThan(-1)
  const end = models.indexOf('\n}', start)
  return [...models.slice(start, end).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!).sort()
}

/** 某個標題到下一個同級（或更高級）標題之間的內容。 */
function sectionUnder(heading: string): string {
  const at = readme.indexOf(`\n${heading}\n`)
  expect(at, `README 找不到標題：${heading}`).toBeGreaterThan(-1)
  const rest = readme.slice(at + heading.length + 2)
  const next = rest.search(/\n#{1,3} /)
  return next < 0 ? rest : rest.slice(0, next)
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

  // review F14：這幾條是後端 / adapter 最容易漏掉的硬規則，寫死在測試裡免得又被改掉
  it('「事件與 response 兩種順序 client 都正確」是端點表旁的硬規則', () => {
    expect(sectionUnder('### 端點對照表')).toContain('後端不必保證')
  })

  it('錯誤條「同 label 合併」的視窗寫在錯誤碼那一節', () => {
    expect(sectionUnder('### 錯誤碼對照表')).toContain('60 秒 tick')
  })

  it.each([
    ['重連的 project.reloaded 由 adapter 自己造', '由 adapter 自己造'],
    ['事件 payload 也要走 adapter 轉換', '事件的 payload 也要走 adapter 轉換'],
    ['updateTasks 的語意是整批 PUT', '整批 PUT'],
    ['每支端點後端自己做 authn / authz', 'authn / authz'],
    ['PATCH 要用 schema 白名單擋 mass-assignment', 'mass-assignment'],
    ['本地 dirty 不保護 server 端', '不保護 server 端'],
  ])('寫到「%s」', (_name, needle) => {
    expect(readme).toContain(needle)
  })

  it('端點對照表列出的方法 = ProjectApi 的方法', () => {
    const documented = firstColumnUnder('### 端點對照表')
      .map((cell) => cell.replace(/`/g, '').replace(/\(.*$/, '').trim())
      .sort()
    expect(documented).toEqual(apiMethodNames())
  })

  /**
   * 後端做任務 API 時照這張表對欄位（前端名 ↔ wire ↔ tasks 表的欄）。
   * `interface Task` 加減欄位而表沒跟上就紅；表裡多出不存在的欄位也紅（比的是整個集合）。
   */
  it('Task 欄位對照表的第一欄 = interface Task 的每個欄位', () => {
    const documented = firstColumnUnder(TASK_FIELDS_HEADING)
      .map((cell) => cell.replace(/`/g, '').trim())
      .sort()
    expect(documented).toEqual(taskFieldNames())
  })

  it('錯誤碼表涵蓋所有 ApiErrorCode', () => {
    // 宣告到第一個空行為止：成員一多，Prettier 會把 union 拆成一行一個
    const decl = apiTypes.match(/export type ApiErrorCode =([\s\S]*?)\n\s*\n/)
    const codes = [...(decl?.[1] ?? '').matchAll(/'([^']+)'/g)].map((c) => c[1]!).sort()
    expect(codes.length, '沒解析到 ApiErrorCode').toBeGreaterThan(0)
    const documented = firstColumnUnder('### 錯誤碼對照表')
      .map((cell) => cell.replace(/`/g, '').trim())
      .sort()
    expect(documented).toEqual(codes)
  })
})

/**
 * 目錄結構那一節的 composables 清單：`src/composables/` 底下每一支都要被提到。
 * review（動畫稽核批次 A）：新增 useRowMotion 時 README 沒跟上；清單目前是逐一列名，漏了就紅。
 */
describe('README 的目錄結構', () => {
  it('composables 清單提到 src/composables/ 底下的每一支', () => {
    const tree = sectionUnder('## 目錄結構')
    const files = readdirSync(resolve(ROOT, 'src/composables'))
      .filter((f) => /\.ts$/.test(f))
      .map((f) => f.replace(/\.ts$/, ''))
    expect(files.length, '沒讀到 composables').toBeGreaterThan(10)
    expect(files.filter((name) => !tree.includes(name))).toEqual([])
  })
})

/**
 * `docs/reference/scheduling.md` 是排程規則的唯一出處，檢查點表是後端移植排程時要跑的測試向量。
 * 表上的數字跟「範例資料在那天照程式推算」的結果綁在一起：改了規則、範例或日曆而沒更新文件就紅。
 * 數字從程式算、不寫死在這裡——寫死的那一份在 `mocks/__tests__/consistency.spec.ts`。
 */
describe('docs/reference/scheduling.md 的檢查點', () => {
  const WD = createWorkdays(sampleCalendar)

  it('檔案存在', () => {
    expect(existsSync(SCHEDULING_PATH), `找不到 ${SCHEDULING_PATH}`).toBe(true)
  })

  it('檢查點表依序是 2026-09-18、09-19、09-22（每列以日期開頭）', () => {
    const dates = tableUnder(scheduling, CHECKPOINT_HEADING, 'scheduling.md').map(
      (cells) => cells[0]!.match(/^\d{4}-\d{2}-\d{2}/)?.[0],
    )
    expect(dates).toEqual(['2026-09-18', '2026-09-19', '2026-09-22'])
  })

  it('每一列的延遲任務、晚幾個工作天、計畫應完成數、專案結束日 = 範例在那天的推算結果', () => {
    const rows = tableUnder(scheduling, CHECKPOINT_HEADING, 'scheduling.md')
    expect(rows.length, '檢查點表是空的').toBeGreaterThan(0)
    for (const [dateCell, lateCell, lateByCell, plannedCell, endCell] of rows) {
      const today = dateCell!.slice(0, 10)
      const idx = dayIndex(today)
      const tasks = scheduleWithPlan(sampleProject.tasks, sampleProject.deps, WD, idx)
      const late = tasks.filter((t) => isLate(t))
      const ends = tasks.map((t) => t.end).sort()
      expect(lateCell!.match(/t\d+/g) ?? [], `${today} 的延遲任務`).toEqual(late.map((t) => t.id))
      expect(
        [...lateByCell!.matchAll(/(t\d+)：(\d+)/g)].map((m) => `${m[1]}:${m[2]}`),
        `${today} 的晚幾個工作天（寫成「t3：2、t13：5」）`,
      ).toEqual(late.map((t) => `${t.id}:${lateDays(t, WD)}`))
      expect(Number(plannedCell), `${today} 的計畫應完成數`).toBe(
        tasks.filter((t) => isPlannedDone(t, idx)).length,
      )
      expect(endCell, `${today} 的專案結束日`).toBe(ends[ends.length - 1])
    }
  })
})

/**
 * 工期上限前後端各寫一份：前端 `DURATION_MAX`（夾值、日期選擇器），後端 `TASK_DURATION_MAX`（tasks.duration_days 的 CHECK）。
 * 改一邊忘了另一邊時，超出的工期會在寫回時被後端拒絕。
 */
describe('工期上限前後端一致', () => {
  it('backend/app/models.py 的 TASK_DURATION_MAX 等於前端的 DURATION_MAX', () => {
    const models = readFileSync(resolve(ROOT, '../backend/app/models.py'), 'utf8')
    const m = /^TASK_DURATION_MAX = (\d+)$/m.exec(models)
    expect(m, 'models.py 找不到 TASK_DURATION_MAX').not.toBeNull()
    expect(Number(m![1])).toBe(DURATION_MAX)
  })
})
