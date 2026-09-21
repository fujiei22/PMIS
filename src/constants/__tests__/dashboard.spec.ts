import { describe, expect, it } from 'vitest'
import { ISSUE_STATUS, TASK_STATUS } from '@/constants/dashboard'

/**
 * review m2：Issue 狀態 → 小圓點顏色的對照表原本在四個元件裡各抄一份
 * （SummaryCards / IssuePanel / TopBar / TaskProperties）。搬進常數後用這支鎖住值。
 * legacy 對照：`ST[{open:'todo',doing:'doing',paused:'paused',closed:'done'}[k]].dot`
 *（:3563 / :3632 / :3750），任務狀態表 `ST` 在 :1707。
 */
describe('ISSUE_STATUS.dot', () => {
  it('四個狀態的圓點沿用 legacy 對到的任務狀態 dot', () => {
    expect(ISSUE_STATUS.open.dot).toBe(TASK_STATUS.todo.dot)
    expect(ISSUE_STATUS.doing.dot).toBe(TASK_STATUS.doing.dot)
    expect(ISSUE_STATUS.paused.dot).toBe(TASK_STATUS.paused.dot)
    expect(ISSUE_STATUS.closed.dot).toBe(TASK_STATUS.done.dot)
  })

  it('鎖住 legacy :1707 的實際色值', () => {
    expect(ISSUE_STATUS.open.dot).toBe('#94a3b8')
    expect(ISSUE_STATUS.doing.dot).toBe('#3b82f6')
    expect(ISSUE_STATUS.paused.dot).toBe('#f59e0b')
    expect(ISSUE_STATUS.closed.dot).toBe('#10b981')
  })

  it('原本的 label / bg / fg / bd 不受影響', () => {
    expect(ISSUE_STATUS.open.label).toBe('待處理')
    expect(ISSUE_STATUS.doing.label).toBe('處理中')
    expect(ISSUE_STATUS.paused.label).toBe('暫停中')
    expect(ISSUE_STATUS.closed.label).toBe('已解決')
    expect(ISSUE_STATUS.closed.bg).toBe('#ecfdf5')
    expect(ISSUE_STATUS.closed.fg).toBe('#059669')
    expect(ISSUE_STATUS.closed.bd).toBe('#a7f3d0')
  })
})
