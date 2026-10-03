import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 編輯限制只有一份（`lib/editPolicy.ts`，規則見 docs/reference/scheduling.md〈編輯限制〉）：
 * 畫面讀 task store 的 `policyOf`，不自己拿狀態、前置、逾期組判斷——各自組會漏
 * （整理前左把手擋今天、整條拖不擋，就是這樣來的）。
 * 守衛的範圍：`isOverdue` 只准出現在 lib/schedule.ts（定義）與 lib/editPolicy.ts（使用）；
 * `hasPred` 只准出現在 lib/editPolicy.ts 與 stores/task.ts（store 不公開它）。測試目錄不掃。
 */
const SRC = resolve(process.cwd(), 'src')

/** src 底下所有 .ts / .vue（不含測試目錄）；同 task-inputs.spec.ts 的寫法。 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sources(full)
    return /\.(ts|vue)$/.test(name) ? [full] : []
  })
}

/** 用到某個名字、但不在白名單裡的檔（相對 src、斜線統一成 /）。 */
function offenders(pattern: RegExp, allowed: string[]): string[] {
  return sources(SRC)
    .map((f) => relative(SRC, f).replace(/\\/g, '/'))
    .filter((f) => !allowed.includes(f))
    .filter((f) => pattern.test(readFileSync(join(SRC, f), 'utf8')))
}

describe('編輯限制只在 lib/editPolicy.ts 判斷', () => {
  it('isOverdue 只在 lib/schedule.ts、lib/editPolicy.ts', () => {
    expect(
      offenders(/\bisOverdue\b/, ['lib/schedule.ts', 'lib/editPolicy.ts']),
      '改讀 taskStore.policyOf(id).overdue',
    ).toEqual([])
  })

  it('hasPred 只在 lib/editPolicy.ts、stores/task.ts', () => {
    expect(
      offenders(/\bhasPred\b/, ['lib/editPolicy.ts', 'stores/task.ts']),
      '改讀 taskStore.policyOf(id)',
    ).toEqual([])
  })
})
