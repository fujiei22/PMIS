import { describe, expect, it } from 'vitest'
import { safeRedirect } from '@/lib/redirect'

/** 登入後回原頁：只接受站內路徑，其他（外站、登入頁自己、奇怪的值）一律回首頁。 */
describe('safeRedirect', () => {
  it.each([
    ['/projects/pmis', '/projects/pmis'],
    ['/projects/pmis?x=1#timeline', '/projects/pmis?x=1#timeline'],
    ['/', '/'],
    ['/#timeline', '/#timeline'],
  ])('站內路徑 %s 原樣回去', (raw, want) => {
    expect(safeRedirect(raw)).toBe(want)
  })

  it.each([
    ['沒有', undefined],
    ['null', null],
    ['空字串', ''],
    ['不是 / 開頭', 'projects/pmis'],
    ['完整網址', 'https://evil.example/'],
    ['協定相對網址', '//evil.example'],
    ['反斜線', '/\\evil.example'],
    ['tab（瀏覽器會丟掉，變成 //）', '/\t/evil.example'],
    ['換行', '/\n/evil.example'],
    ['登入頁自己', '/login'],
    ['登入頁帶參數', '/login?redirect=/projects/pmis'],
  ])('%s → 首頁', (_name, raw) => {
    expect(safeRedirect(raw)).toBe('/')
  })

  it('陣列（?redirect=a&redirect=b）取第一個，一樣要檢查', () => {
    expect(safeRedirect(['/projects/a', '/projects/b'])).toBe('/projects/a')
    expect(safeRedirect(['//evil.example', '/projects/b'])).toBe('/')
  })

  it('登入頁開頭但不是登入頁的路徑照常放行', () => {
    expect(safeRedirect('/loginx')).toBe('/loginx')
  })
})
