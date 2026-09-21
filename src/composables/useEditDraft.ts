import { onBeforeUnmount } from 'vue'
import { useUiStore } from '@/stores/ui'

/** 送出前等多久沒有新輸入（ms）。契約 B-2 */
const DEBOUNCE_MS = 300

export interface EditDraft {
  /** 每一鍵都呼叫：本地立即生效，api 走 trailing debounce。 */
  onInput: (v: string) => void
  /** 離開編輯（Enter / Esc / blur / 卸載）時立刻把還沒送的送出去。 */
  flush: () => Promise<void>
  /** 放棄還沒送出的那一次（不還原本地）。 */
  cancel: () => void
}

/**
 * 逐鍵編輯的草稿（契約 B-2）。
 *
 * legacy 的 onChange 是逐鍵寫進狀態的（GanttTaskRow :2882、IssueCard :3176…），
 * 48 條 e2e 也靠這個行為；接後端之後不能每一鍵打一次 api，所以拆成兩段：
 * **本地每一鍵立即 apply**，**api 用 trailing debounce 300ms + 離開編輯時 flush**。
 *
 * 失敗的判定：`commit`（走 `runOptimistic`）永不 throw，失敗時它會把本地還原成
 * server 值。所以送出後「沒有新輸入、但本地跟送出的值不一樣」就是失敗了 ——
 * 此時結束編輯狀態（契約 B-2），使用者看到的是還原後的值加上錯誤條。
 */
export function useEditDraft(opts: {
  get: () => string
  applyLocal: (v: string) => void
  commit: (v: string) => Promise<void>
  debounceMs?: number
}): EditDraft {
  const ui = useUiStore()
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 最後一次輸入的值；null = 這一輪還沒有人打字。 */
  let latest: string | null = null
  /** 有沒有還沒送出的變更。 */
  let dirty = false

  function onInput(v: string): void {
    latest = v
    dirty = true
    opts.applyLocal(v)
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), opts.debounceMs ?? DEBOUNCE_MS)
  }

  async function flush(): Promise<void> {
    clearTimeout(timer)
    if (!dirty) return
    dirty = false
    const sent = latest ?? opts.get()
    await opts.commit(sent)
    if (dirty) {
      // 飛行途中又打了字：回應的對齊可能把本地蓋回送出的值，把最新的草稿放回去
      if (latest !== null && opts.get() !== latest) opts.applyLocal(latest)
      return
    }
    if (opts.get() !== sent) ui.editing = null
  }

  function cancel(): void {
    clearTimeout(timer)
    latest = null
    dirty = false
  }

  // 元件被卸載（收合面板、關詳情）時打到一半的字還是要送出去
  onBeforeUnmount(() => void flush())

  return { onInput, flush, cancel }
}
