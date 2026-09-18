/** 附件的圖示與配色，依副檔名分類。 */

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic']
const DOC_EXTS = ['doc', 'docx', 'txt', 'md']
const SHEET_EXTS = ['xlsx', 'xls', 'csv']
const CODE_EXTS = ['json', 'js', 'ts', 'zip', 'yml', 'yaml']

/** 取小寫副檔名；沒有點就是整個檔名（等同 legacy 的 split('.').pop()）。 */
function extOf(name: string): string {
  return String(name).split('.').pop()!.toLowerCase()
}

/** 附件的圖示字元與底色。legacy `fileKind` :2151 */
export function fileKind(name: string): { glyph: string; tint: string; bg: string } {
  const ext = extOf(name)
  if (IMAGE_EXTS.includes(ext)) return { glyph: '▣', tint: '#7c3aed', bg: '#f5f3ff' }
  if (ext === 'pdf') return { glyph: '▤', tint: '#dc2626', bg: '#fef2f2' }
  if (SHEET_EXTS.includes(ext)) return { glyph: '▦', tint: '#059669', bg: '#ecfdf5' }
  if (DOC_EXTS.includes(ext)) return { glyph: '▥', tint: '#2563eb', bg: '#eff6ff' }
  if (CODE_EXTS.includes(ext)) return { glyph: '◧', tint: '#b45309', bg: '#fffbeb' }
  return { glyph: '◻', tint: '#64748b', bg: '#f1f5f9' }
}

/**
 * 是不是圖片——決定要不要出縮圖 / 開 Lightbox。legacy `isImg` :2170。
 * 比 fileKind 多認 bmp（沿用 legacy 的兩份清單差異）。
 */
export function isImage(name: string): boolean {
  return [...IMAGE_EXTS, 'bmp'].includes(extOf(name))
}
