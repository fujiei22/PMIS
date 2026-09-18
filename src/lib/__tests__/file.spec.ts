import { describe, expect, it } from 'vitest'
import { fileKind, isImage } from '@/lib/file'

describe('file', () => {
  it('fileKind 依副檔名分六類', () => {
    expect(fileKind('a.png')).toEqual({ glyph: '▣', tint: '#7c3aed', bg: '#f5f3ff' })
    expect(fileKind('a.pdf')).toEqual({ glyph: '▤', tint: '#dc2626', bg: '#fef2f2' })
    expect(fileKind('a.xlsx')).toEqual({ glyph: '▦', tint: '#059669', bg: '#ecfdf5' })
    expect(fileKind('a.docx')).toEqual({ glyph: '▥', tint: '#2563eb', bg: '#eff6ff' })
    expect(fileKind('a.json')).toEqual({ glyph: '◧', tint: '#b45309', bg: '#fffbeb' })
    expect(fileKind('a.unknown')).toEqual({ glyph: '◻', tint: '#64748b', bg: '#f1f5f9' })
  })

  it('fileKind 不分大小寫', () => {
    expect(fileKind('封面.PNG').glyph).toBe('▣')
  })

  it('isImage 只認得圖片副檔名', () => {
    expect(isImage('a.jpeg')).toBe(true)
    expect(isImage('a.BMP')).toBe(true)
    expect(isImage('a.pdf')).toBe(false)
    expect(isImage('noext')).toBe(false)
  })
})
