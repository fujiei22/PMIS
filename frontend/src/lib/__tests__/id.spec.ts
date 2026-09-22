import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'

/** UUID v4：第 13 個 hex 固定 4、第 17 個是 8/9/a/b。 */
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 暫時把 crypto.randomUUID 換掉（不能直接指派，jsdom 的 Crypto 是唯讀屬性）。 */
function stubRandomUUID(value: Crypto['randomUUID'] | undefined): void {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value, configurable: true, writable: true })
}

const original = globalThis.crypto.randomUUID

describe('newId', () => {
  afterEach(() => {
    stubRandomUUID(original)
  })

  it('newId 回 UUID v4 格式，連兩次不同', () => {
    const a = newId()
    const b = newId()
    expect(a).toMatch(V4)
    expect(b).toMatch(V4)
    expect(a).not.toBe(b)
  })

  // review M9：舊瀏覽器 / 非 secure context 沒有 randomUUID，退回 getRandomValues 自己組。
  it('crypto.randomUUID 不存在時退回 getRandomValues，仍是合法 v4', () => {
    stubRandomUUID(undefined)
    const ids = new Set(Array.from({ length: 50 }, () => newId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(V4)
  })
})
