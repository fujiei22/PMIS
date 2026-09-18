/** 可以產生 id 的資料種類：分類 / 任務 / Issue / 相依 / 留言 */
export type IdPrefix = 'g' | 't' | 'i' | 'd' | 'c'

/**
 * 前端暫時的流水號，從 100 起跳，避開 mocks 已經用掉的 g1…t30。
 * 接後端之後這些 id 改由 server 回填，這支檔案就只剩留言的樂觀更新會用到。
 */
let seq = 100

/**
 * 產生一個新 id。
 * 留言用時間戳（legacy 同樣做法），因為留言會樂觀插入、不跟其他資料共用號碼。
 */
export function nextId(prefix: IdPrefix): string {
  if (prefix === 'c') return 'c' + Date.now()
  return prefix + ++seq
}

/** 測試用：把流水號歸零回初始值。 */
export function resetIdSeq(): void {
  seq = 100
}
