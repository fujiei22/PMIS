import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import { useConfirmProps } from '@/composables/useConfirmProps'
import { sampleProject } from '@/mocks/sampleProject'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 四 kind × 兩 step 的文案逐字對照 legacy：
 * 任務 `legacy/Dashboard.html` :1512-1535、分類 :1385-1408、
 * 相依 :1459-1482、Issue :1486-1509。
 */

function stores() {
  return { ui: useUiStore(), taskStore: useTaskStore(), issueStore: useIssueStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  useTaskStore().load(structuredClone(sampleProject))
})

describe('useConfirmProps 文案', () => {
  it('ui.confirm 是 null 時回 null', () => {
    expect(useConfirmProps().value).toBeNull()
  })

  it('任務：step 1 / step 2', () => {
    const { ui, taskStore, issueStore } = stores()
    const view = useConfirmProps()
    const name = taskStore.taskById('t1')!.name
    const n = issueStore.byTask('t1').length

    ui.confirm = { kind: 'task', id: 't1', step: 1 }
    expect(view.value).toMatchObject({
      open: true,
      step: 1,
      title: '刪除任務？',
      body: `將刪除任務「${name}」，同時移除其 ${n} 筆 Issue 與所有串接關係。`,
      extra: undefined,
      confirmLabel: '繼續刪除',
    })

    ui.confirm = { kind: 'task', id: 't1', step: 2 }
    expect(view.value).toMatchObject({
      step: 2,
      title: '再次確認',
      body: `此操作無法復原。確定要永久刪除「${name}」嗎？`,
      extra: undefined,
      confirmLabel: '確認刪除',
    })
  })

  it('分類：step 1 / step 2（帶底下任務數）', () => {
    const { ui, taskStore } = stores()
    const view = useConfirmProps()
    const name = taskStore.groupById('g1')!.name
    const n = taskStore.tasks.filter((t) => t.groupId === 'g1').length
    expect(n).toBeGreaterThan(0)

    ui.confirm = { kind: 'group', id: 'g1', step: 1 }
    expect(view.value).toMatchObject({
      title: '刪除分類？',
      body: `將刪除分類「${name}」及其底下 ${n} 個任務（含這些任務的 Issue 與串接關係）。`,
      extra: undefined,
      confirmLabel: '繼續刪除',
    })

    ui.confirm = { kind: 'group', id: 'g1', step: 2 }
    expect(view.value).toMatchObject({
      title: '再次確認',
      body: `此操作無法復原。確定要刪除「${name}」與其中的 ${n} 個任務嗎？`,
      extra: undefined,
      confirmLabel: '確認刪除',
    })
  })

  it('相依：step 1 / step 2（用開啟端帶進來的 label，step 2 不寫「無法復原」）', () => {
    const { ui } = stores()
    const view = useConfirmProps()

    ui.confirm = { kind: 'dep', id: 'd1', step: 1, label: '甲 → 乙' }
    expect(view.value).toMatchObject({
      title: '刪除串接關係？',
      body: '將移除「甲 → 乙」的前後相依關係，任務本身不受影響。',
      extra: undefined,
      confirmLabel: '繼續刪除',
    })

    ui.confirm = { kind: 'dep', id: 'd1', step: 2, label: '甲 → 乙' }
    expect(view.value).toMatchObject({
      title: '再次確認',
      body: '確定要刪除「甲 → 乙」這條串接線嗎？',
      extra: undefined,
      confirmLabel: '確認刪除',
    })
  })

  it('Issue：step 1 / step 2', () => {
    const { ui, issueStore } = stores()
    const view = useConfirmProps()
    const title = issueStore.byId('i1')!.title

    ui.confirm = { kind: 'issue', id: 'i1', step: 1 }
    expect(view.value).toMatchObject({
      title: '刪除 Issue？',
      body: `將刪除「${title}」，其描述、對策與測試環境紀錄都會一併移除。`,
      extra: undefined,
      confirmLabel: '繼續刪除',
    })

    ui.confirm = { kind: 'issue', id: 'i1', step: 2 }
    expect(view.value).toMatchObject({
      title: '再次確認',
      body: `此操作無法復原。確定要永久刪除「${title}」嗎？`,
      extra: undefined,
      confirmLabel: '確認刪除',
    })
  })

  // R3 契約 E：指向不存在實體的 confirm 由 ui 的清理 watch 同步關掉，
  // 對話框不會停在一筆查不到名字的資料上（也不會炸）。
  it('找不到實體時 confirm 直接被清掉', () => {
    const { ui } = stores()
    const view = useConfirmProps()
    ui.confirm = { kind: 'task', id: '沒這個', step: 1 }
    expect(ui.confirm).toBeNull()
    expect(view.value).toBeNull()
  })
})

describe('useConfirmProps 行為', () => {
  it('onCancel 關掉、onNext 只把步驟推到 2（不動資料）', () => {
    const { ui, taskStore } = stores()
    const view = useConfirmProps()
    const before = taskStore.tasks.length

    ui.confirm = { kind: 'task', id: 't1', step: 1 }
    view.value!.onNext()
    expect(ui.confirm).toEqual({ kind: 'task', id: 't1', step: 2 })
    expect(taskStore.tasks.length).toBe(before)

    view.value!.onCancel()
    expect(ui.confirm).toBeNull()
  })

  it('onConfirm 四種各自呼叫對應 store action 並關掉對話框', () => {
    const { ui, taskStore, issueStore } = stores()
    const view = useConfirmProps()

    ui.confirm = { kind: 'task', id: 't1', step: 2 }
    view.value!.onConfirm()
    expect(taskStore.taskById('t1')).toBeUndefined()
    expect(ui.confirm).toBeNull()

    const gone = taskStore.tasks.filter((t) => t.groupId === 'g2').map((t) => t.id)
    expect(gone.length).toBeGreaterThan(0)
    ui.confirm = { kind: 'group', id: 'g2', step: 2 }
    view.value!.onConfirm()
    expect(taskStore.groupById('g2')).toBeUndefined()
    expect(taskStore.tasks.some((t) => gone.includes(t.id))).toBe(false)

    const depId = taskStore.deps[0]!.id
    ui.confirm = { kind: 'dep', id: depId, step: 2 }
    view.value!.onConfirm()
    expect(taskStore.deps.some((d) => d.id === depId)).toBe(false)

    ui.confirm = { kind: 'issue', id: 'i1', step: 2 }
    view.value!.onConfirm()
    expect(issueStore.byId('i1')).toBeUndefined()
    expect(ui.confirm).toBeNull()
  })
})

// 基準鎖：上鎖一步（第一步的按鈕直接執行）、解鎖兩步（重新上鎖會覆蓋原本的基準，無法復原）
describe('useConfirmProps 基準鎖', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('上鎖一步：文案與按鈕「鎖定」，按下就呼叫 lockBaseline 並關掉', () => {
    const { ui, taskStore } = stores()
    const lock = vi.spyOn(taskStore, 'lockBaseline').mockResolvedValue()
    const view = useConfirmProps()
    ui.confirm = { kind: 'baselineLock', step: 1 }
    expect(view.value).toMatchObject({
      open: true,
      step: 1,
      title: '鎖定計畫基準？',
      body: '把目前的排程鎖成基準，之後晚於基準的任務會標成已延遲。',
      confirmLabel: '鎖定',
    })
    expect(view.value!.extra).toBeUndefined()
    view.value!.onNext()
    expect(lock).toHaveBeenCalledTimes(1)
    expect(ui.confirm).toBeNull()
  })

  it('解鎖兩步：第一步寫目前延遲幾個任務，第二步說明會覆蓋原本的基準', () => {
    const { ui, taskStore } = stores()
    const unlock = vi.spyOn(taskStore, 'unlockBaseline').mockResolvedValue()
    const view = useConfirmProps()
    ui.confirm = { kind: 'baselineUnlock', step: 1 }
    expect(view.value).toMatchObject({
      step: 1,
      title: '解除基準鎖？',
      body: '解鎖後基準跟著排程走，不再標示延遲。',
      extra: '目前 2 個任務已延遲',
      confirmLabel: '繼續',
    })
    view.value!.onNext()
    expect(unlock).not.toHaveBeenCalled()
    expect(view.value).toMatchObject({
      step: 2,
      title: '再次確認',
      body: '重新上鎖時，原本的基準會被覆蓋，無法復原。',
      confirmLabel: '確認解鎖',
    })
    view.value!.onConfirm()
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(ui.confirm).toBeNull()
  })
})
