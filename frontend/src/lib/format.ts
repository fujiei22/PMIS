import type { ISODate } from '@/types/models'

/** 顯示用的字串格式化；legacy 對照行號標在各函式上。 */

/** 補零成 'YYYY/MM/DD'；空值顯示成日期選擇器的提示字。legacy `fmtDate` :2009 */
export function fmtDate(iso: ISODate | ''): string {
  if (!iso) return EMPTY_LABEL.pickDate
  const p = iso.split('-')
  return (p[0] ?? '') + '/' + pad2(p[1]) + '/' + pad2(p[2])
}

/** 甘特條與卡片上的短日期 'MM/DD'。legacy `shortDate` :2691 */
export function shortDate(iso: ISODate): string {
  const p = String(iso).split('-')
  return pad2(p[1]) + '/' + pad2(p[2])
}

/** 把 fmtDate 的結果去掉年份：'2026/09/08' → '09/08'。 */
export function stripYear(s: string): string {
  return s.replace(/^\d{4}\//, '')
}

/**
 * 視覺寬度：中日韓與全形字算 1，其餘算 0.5。legacy `visualLen` :2685。
 * 用來估任務名要佔幾行。
 */
export function visualLen(s: string): number {
  let n = 0
  for (const ch of String(s ?? '')) n += /[　-鿿＀-￯]/.test(ch) ? 1 : 0.5
  return n
}

/** 檔案大小三段換算。legacy `fileSize` :2145 */
export function fileSize(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
  return (n / 1048576).toFixed(1) + ' MB'
}

/** legacy 各處寫死的空值字樣，集中在這裡免得各元件各寫一份。 */
export const EMPTY_LABEL = {
  dash: '—',
  notFilled: '未填寫',
  setDue: '設定期限',
  pickDate: '選擇日期',
  unassigned: '未指派',
} as const

/** 個位數補成兩位；legacy 的 pad 內嵌在 fmtDate / shortDate 裡。 */
function pad2(v: string | undefined): string {
  const s = String(Number(v ?? 0))
  return s.length < 2 ? '0' + s : s
}

/** 金額：'$50,000'；負數把負號放在 $ 前面（'-$500'）。 */
export function fmtMoney(n: number): string {
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US')
}

/** 卡片空間小時用：未滿 10 億同 `fmtMoney`，之後改縮寫（'$123.5B'、'-$2.5T'），完整金額另放 title。 */
export function fmtMoneyShort(n: number): string {
  if (Math.abs(n) < 1e9) return fmtMoney(n)
  const short = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Math.abs(n))
  return (n < 0 ? '-' : '') + '$' + short
}
