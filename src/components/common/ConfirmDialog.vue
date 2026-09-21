<script setup lang="ts">
// 四種兩步刪除確認（任務 / 分類 / 相依 / Issue）共用一個對話框，由 ui.confirm 驅動。
// legacy 對照：模板 :1394-1531（四份同構的 sc-if），處置 :4006-4095。
import { computed } from 'vue'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()

const confirm = computed(() => ui.confirm)

/** 對話框裡要提到的名稱；相依用開啟時帶進來的 label（「A → B」）。 */
const label = computed(() => {
  const c = confirm.value
  if (!c) return ''
  switch (c.kind) {
    case 'task':
      return taskStore.taskById(c.id)?.name ?? ''
    case 'group':
      return taskStore.groupById(c.id)?.name ?? ''
    case 'issue':
      return issueStore.byId(c.id)?.title ?? ''
    default:
      return c.label ?? ''
  }
})

/** 會被一起刪掉的附帶項目數：任務算 Issue 筆數、分類算任務數。 */
const extraCount = computed(() => {
  const c = confirm.value
  if (!c) return 0
  if (c.kind === 'task') return issueStore.byTask(c.id).length
  if (c.kind === 'group') return taskStore.tasks.filter((t) => t.groupId === c.id).length
  return 0
})

const title = computed(() => {
  const c = confirm.value
  if (!c) return ''
  if (c.step === 2) return '再次確認'
  return { task: '刪除任務？', group: '刪除分類？', dep: '刪除串接關係？', issue: '刪除 Issue？' }[
    c.kind
  ]
})

const body = computed(() => {
  const c = confirm.value
  if (!c) return ''
  const n = extraCount.value
  if (c.step === 1) {
    switch (c.kind) {
      case 'task':
        return `將刪除任務「${label.value}」，同時移除其 ${n} 筆 Issue 與所有串接關係。`
      case 'group':
        return `將刪除分類「${label.value}」及其底下 ${n} 個任務（含這些任務的 Issue 與串接關係）。`
      case 'dep':
        return `將移除「${label.value}」的前後相依關係，任務本身不受影響。`
      default:
        return `將刪除「${label.value}」，其描述、對策與測試環境紀錄都會一併移除。`
    }
  }
  switch (c.kind) {
    case 'group':
      return `此操作無法復原。確定要刪除「${label.value}」與其中的 ${n} 個任務嗎？`
    case 'dep':
      return `確定要刪除「${label.value}」這條串接線嗎？`
    default:
      return `此操作無法復原。確定要永久刪除「${label.value}」嗎？`
  }
})

function cancel(): void {
  ui.confirm = null
}

/** 第一步的「繼續刪除」：只把步驟推到 2，不動資料。legacy :4012 等 */
function next(): void {
  if (ui.confirm) ui.confirm = { ...ui.confirm, step: 2 }
}

/** 第二步的「確認刪除」：真的刪，四種各自交給對應 store。legacy :4013 / :4066 / :4076 / :4082 */
function remove(): void {
  const c = ui.confirm
  if (!c) return
  ui.confirm = null
  switch (c.kind) {
    case 'task':
      taskStore.removeTask(c.id)
      break
    case 'group':
      taskStore.removeGroup(c.id)
      break
    case 'dep':
      taskStore.removeDep(c.id)
      break
    default:
      issueStore.removeIssue(c.id)
  }
}
</script>

<template>
  <div v-if="confirm" class="confirm-backdrop">
    <div class="confirm-dialog" role="dialog" aria-modal="true">
      <div class="confirm-title" :class="{ final: confirm.step === 2 }">{{ title }}</div>
      <div class="confirm-body">{{ body }}</div>
      <div class="confirm-actions">
        <button class="btn-cancel" @click="cancel()">取消</button>
        <button v-if="confirm.step === 1" class="btn-next" @click="next()">繼續刪除</button>
        <button v-else class="btn-danger" @click="remove()">確認刪除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  background: var(--backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: var(--sp-10);
  animation: fadeIn var(--t-pop) ease-out;
}

.confirm-dialog {
  width: 100%;
  max-width: 380px;
  background: var(--surface-1);
  border-radius: var(--r-modal);
  padding: var(--sp-10);
  box-shadow: var(--shadow-modal);
  animation: popIn var(--t-fast) ease-out;
}

.confirm-title {
  font-size: var(--fs-dialog);
  font-weight: var(--fw-bold);
  margin-bottom: var(--sp-4);
}

.confirm-title.final {
  color: var(--danger-text);
}

.confirm-body {
  font-size: var(--fs-month);
  line-height: var(--lh-loose);
  color: var(--text-3);
}

.confirm-actions {
  display: flex;
  gap: var(--sp-4);
  margin-top: var(--sp-9);
  justify-content: flex-end;
}

.confirm-actions button {
  padding: var(--sp-4) var(--sp-7);
  font-size: var(--fs-month);
  border-radius: var(--r-input);
  cursor: pointer;
}

.btn-cancel {
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  color: var(--text-2);
}

.btn-next {
  border: 1px solid var(--danger-bd);
  background: var(--danger-bg);
  color: var(--danger);
  font-weight: var(--fw-medium);
}

.btn-danger {
  border: 1px solid var(--danger);
  background: var(--danger);
  color: var(--surface-1);
  font-weight: var(--fw-medium);
}
</style>
