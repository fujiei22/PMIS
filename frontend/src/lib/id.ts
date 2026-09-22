/**
 * 新實體的 id 一律由前端產生（契約 A：`id` 由 client 產、create 帶 id、重複回 409）。
 *
 * 為什麼是 UUID 而不是流水號：接後端之後同時有多個 client 在建立資料，
 * 「本地遞增」必然撞號；UUID 讓樂觀更新可以先用最終 id 畫上去，
 * 不必等 server 回填、也不用做 tempId → realId 的替換。
 * mocks 既有的 g1 / t1 / i1 / d1 / c1 保持原樣（spec 目標 4）。
 */

/**
 * 產生一個新 id（UUID v4 字串）。
 *
 * review M9：`crypto.randomUUID` 只在 secure context（https / localhost）才有，
 * 內網用 http 開的話會是 undefined，所以退回 `crypto.getRandomValues` 自己組一個 v4。
 */
export function newId(): string {
  return globalThis.crypto.randomUUID?.() ?? v4FromGetRandomValues()
}

/** 用 16 個亂數位元組組 UUID v4：第 7 位元組的高 4 bits 填 4、第 9 位元組的高 2 bits 填 10。 */
function v4FromGetRandomValues(): string {
  const b = new Uint8Array(16)
  globalThis.crypto.getRandomValues(b)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
