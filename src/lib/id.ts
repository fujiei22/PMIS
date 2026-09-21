/** 可以產生 id 的資料種類：分類 / 任務 / Issue / 相依 / 留言 */
export type IdPrefix = 'g' | 't' | 'i' | 'd' | 'c'

/**
 * 前端暫時的流水號，從 100 起跳，避開 mocks 已經用掉的 g1…t30。
 * 接後端之後這些 id 改由 server 回填，這支檔案就只剩留言的樂觀更新會用到。
 */
let seq = 100

/**
 * 產生一個新 id；所有種類共用同一條流水號。
 *
 * review M5：留言原本跟 legacy :2196 一樣用 `'c' + Date.now()`，
 * 但固定時鐘（單元測試與 e2e 的 `page.clock`）下同一毫秒連送兩則會拿到同一個 id，
 * v-for 的 key 撞號、刪一則會連帶刪掉另一則。改成流水號，起點 100 也避開 mocks 的 c1…c5。
 */
export function nextId(prefix: IdPrefix): string {
  return prefix + ++seq
}

/** 測試用：把流水號歸零回初始值。 */
export function resetIdSeq(): void {
  seq = 100
}
