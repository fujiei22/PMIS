import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPortfolio } from '@/api/mock/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

/**
 * 總覽派生層：篩選（成員照 Dashboard 語意、空＝全部）、多鍵排序、依 PM 分組與欄序、
 * 展開 / 群組收合 / 下拉互斥。今天固定 2026-09-22，PMIS 即時彙整後落後 10、延遲 3。
 */

describe('overview store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    useClockStore().now = new Date('2026-09-22T10:00:00').getTime()
    await usePortfolioStore().load(buildPortfolio(sampleProject, '2026-09-22'))
  })

  it('預設：全部 7 個、排序 ① 落後↓ ② 到期↑、欄序 成員10 / 成員8 / 成員5 / 成員9', () => {
    const ov = useOverviewStore()
    // PMIS 即時彙整後落後 10（Task 4），排在 portal(13) 之後、payment(4) 之前
    expect(ov.visibleRows.map((r) => r.p.id)).toEqual([
      'wiki',
      'portal',
      'pmis',
      'payment',
      'app',
      'dw',
      'vendor',
    ])
    expect(ov.groups.map((g) => g.pm.name)).toEqual(['成員10', '成員8', '成員5', '成員9'])
    expect(ov.counts).toEqual({ projects: 7, alerts: 3, pms: 4 })
    expect(ov.anyFilter).toBe(false)
  })

  it('篩成員5 + 成員8 且狀態 進行中 / 未開始 → 4 個、2 個需注意、2 位 PM', () => {
    const ov = useOverviewStore()
    ov.togglePm('m5')
    ov.togglePm('m8')
    ov.toggleStatus('doing')
    ov.toggleStatus('todo')
    expect(ov.visibleRows.map((r) => r.p.id)).toEqual(['portal', 'pmis', 'payment', 'app'])
    expect(ov.counts).toEqual({ projects: 4, alerts: 2, pms: 2 })
    expect(ov.anyFilter).toBe(true)
    ov.clearPms()
    expect(ov.pmIds).toEqual([])
    ov.clearFilters()
    expect(ov.visibleRows).toHaveLength(7)
    expect(ov.anyFilter).toBe(false)
  })

  it('搜尋「app」→ 只剩行動 App v2；只有空白不算篩選；清除篩選一併清掉搜尋字', () => {
    const ov = useOverviewStore()
    ov.setQuery('app')
    expect(ov.visibleRows.map((r) => r.p.id)).toEqual(['app'])
    expect(ov.counts).toEqual({ projects: 1, alerts: 0, pms: 1 })
    expect(ov.anyFilter).toBe(true)
    ov.setQuery('   ')
    expect(ov.visibleRows).toHaveLength(7)
    expect(ov.anyFilter).toBe(false)
    ov.setQuery('入口')
    ov.toggleStatus('doing')
    expect(ov.visibleRows.map((r) => r.p.id)).toEqual(['portal'])
    ov.clearFilters()
    expect(ov.query).toBe('')
    expect(ov.visibleRows).toHaveLength(7)
    expect(ov.anyFilter).toBe(false)
  })

  it('成員篩選語意照 Dashboard：沒勾＝全部；pms 只含當 PM 的成員', () => {
    const ov = useOverviewStore()
    expect(ov.pms.map((m) => m.id)).toEqual(['m5', 'm8', 'm9', 'm10'])
    expect(ov.pmOptionList.map((o) => [o.pm.name, o.doing, o.todo, o.hasAlert])).toEqual([
      ['成員5', 2, 0, true],
      ['成員8', 2, 0, true],
      ['成員9', 0, 1, false],
      ['成員10', 1, 0, true],
    ])
  })

  it('查不到 PM 的專案：不進任何欄、counts 不算它、console.warn 一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pf = usePortfolioStore()
    pf.projects[0]!.pmId = 'ghost'
    const ov = useOverviewStore()
    expect(ov.orphans).toEqual(['pmis'])
    expect(ov.counts.projects).toBe(6)
    expect(warn).toHaveBeenCalledWith('[overview] 找不到專案的 PM', ['pmis'])
    warn.mockRestore()
  })

  it('排序：bump 新鍵加在最後、再 bump 翻方向；drop 移除；reset 回預設', () => {
    const ov = useOverviewStore()
    ov.bumpSort('issues')
    expect(ov.sorts).toEqual([
      { k: 'gap', dir: 'desc' },
      { k: 'due', dir: 'asc' },
      { k: 'issues', dir: 'desc' },
    ])
    ov.bumpSort('gap')
    expect(ov.sorts[0]).toEqual({ k: 'gap', dir: 'asc' })
    ov.dropSort('gap')
    expect(ov.sorts.map((s) => s.k)).toEqual(['due', 'issues'])
    ov.resetSort()
    expect(ov.sorts).toEqual([
      { k: 'gap', dir: 'desc' },
      { k: 'due', dir: 'asc' },
    ])
  })

  it('展開可多個並存；群組收合各自獨立；下拉互斥', () => {
    const ov = useOverviewStore()
    ov.toggleExpanded('pmis')
    ov.toggleExpanded('portal')
    expect(ov.isExpanded('pmis') && ov.isExpanded('portal')).toBe(true)
    ov.toggleExpanded('pmis')
    expect(ov.isExpanded('pmis')).toBe(false)
    ov.toggleGroup('m5')
    expect([ov.isCollapsed('m5'), ov.isCollapsed('m8')]).toEqual([true, false])
    ov.toggleDropdown('pm')
    ov.toggleDropdown('status')
    expect(ov.openDropdown).toBe('status')
    ov.toggleDropdown('status')
    expect(ov.openDropdown).toBe(null)
  })

  it('卡片泳道：同泳道展開新的一張會收起其他張，別條泳道不受影響；再點一次收合', () => {
    const ov = useOverviewStore()
    const m8 = ['portal', 'app']
    ov.toggleExpanded('pmis')
    ov.toggleExpandedInLane('portal', m8)
    ov.toggleExpandedInLane('app', m8)
    expect(ov.expandedIds).toEqual(['pmis', 'app'])
    ov.toggleExpandedInLane('app', m8)
    expect(ov.expandedIds).toEqual(['pmis'])
  })

  it('從時間軸切回卡片：同泳道多張展開時只留最後展開的那張', () => {
    const ov = useOverviewStore()
    ov.toggleExpanded('app')
    ov.toggleExpanded('pmis')
    ov.toggleExpanded('portal')
    ov.keepLastExpandedInLane(['portal', 'app'])
    expect(ov.expandedIds).toEqual(['pmis', 'portal'])
    ov.keepLastExpandedInLane(['pmis', 'payment'])
    expect(ov.expandedIds).toEqual(['pmis', 'portal'])
  })

  it('setView 切換檢視並關掉下拉', () => {
    const ov = useOverviewStore()
    ov.toggleDropdown('sort')
    ov.setView('timeline')
    expect([ov.view, ov.openDropdown]).toEqual(['timeline', null])
  })

  it('range 涵蓋所有專案（06-01 ～ 2027-01-31），不受篩選影響', () => {
    const ov = useOverviewStore()
    ov.toggleStatus('todo')
    expect(ov.range.months[0]!.iso).toBe('2026-06')
    expect(ov.range.months[ov.range.months.length - 1]!.iso).toBe('2027-01')
  })
})
