import type { Member } from '@/types/models'

/** 由資料算出來的顏色；token 管得到的顏色寫在 tokens.css，不走這裡。 */

/**
 * 色碼加透明度。legacy `rgba` :2383。
 * 支援 3 碼與 6 碼、有沒有 # 都行；空值退回 accent 藍（同 legacy）。
 */
export function rgba(hex: string, a: number): string {
  const h = (hex || '#2563eb').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}

/** 頭像上的字：名字裡有數字就用數字，否則取第一個字。legacy `initialOf` :2003 */
export function initialOf(m: Member | undefined): string {
  if (!m) return '?'
  const d = String(m.name).match(/\d+/)
  return d ? d[0] : String(m.name).slice(0, 1)
}
