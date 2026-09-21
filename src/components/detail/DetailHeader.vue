<script setup lang="ts">
// 詳細視窗的標題列：堆疊返回鈕、可雙擊編輯的標題、關閉 ✕。
// legacy 對照：模板 :865-881，titleEdit / titleKey :3796-3803。
import { computed, nextTick, ref, watch } from 'vue'
import { visualLen } from '@/lib/format'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  /** 目前顯示的名稱（任務 name 或 Issue title）。 */
  name: string
  /** 編輯狀態要綁的 id；就是 ui.detail.id。 */
  editId: string
  /** 從任務堆疊進來時的來源任務名；null 代表不顯示返回鈕。 */
  stackTitle: string | null
  /** 任務 ↔ Issue 切換動畫的 class，由 DetailModal 算好傳進來。 */
  paneClass: string
}>()

const emit = defineEmits<{ 'update:name': [string] }>()

const ui = useUiStore()

/** 編輯中的判定沿用全域 editing，kind 'dt' 專指詳情標題。legacy :3796 */
const editing = computed(() => ui.editing?.kind === 'dt' && ui.editing.id === props.editId)

/** 標題 textarea 要幾行：以視覺寬度 30 為一行估。legacy `nameRows` :3038 */
const rows = computed(() => Math.max(1, Math.ceil(visualLen(props.name) / 30)))

const inputEl = ref<HTMLTextAreaElement | null>(null)

/**
 * 進編輯就把焦點與游標放進 textarea，做法跟 GanttTaskRow 的就地編輯一致。
 *
 * review M4：原本靠 HTML `autofocus`，那個屬性每份文件只生效一次，
 * 第二次雙擊標題就不會聚焦（`ref="input"` 也沒人接、是死碼）。
 */
watch(editing, async (on) => {
  if (!on) return
  await nextTick()
  const el = inputEl.value
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
})

function startEdit(): void {
  ui.editing = { kind: 'dt', id: props.editId }
}

function endEdit(): void {
  if (ui.editing?.kind === 'dt') ui.editing = null
}

/** Enter 結束編輯、Shift+Enter 換行（沿用 legacy 的 textarea 行為 :3800）；Esc 也只是關框。 */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    ;(e.target as HTMLTextAreaElement).blur()
    ui.editing = null
  }
  if (e.key === 'Escape') ui.editing = null
}
</script>

<template>
  <div class="detail-head">
    <div class="head-main" :class="paneClass">
      <div
        v-if="stackTitle !== null"
        class="detail-back"
        role="button"
        title="返回任務"
        @click="ui.detailBack()"
      >
        <span class="back-arrow">←</span>
        <span class="back-title">{{ stackTitle }}</span>
      </div>

      <div v-if="!editing" class="detail-title" @dblclick="startEdit()">{{ name }}</div>
      <textarea
        v-else
        ref="inputEl"
        class="detail-title-input"
        :value="name"
        :rows="rows"
        @input="emit('update:name', ($event.target as HTMLTextAreaElement).value)"
        @blur="endEdit()"
        @keydown="onKey"
        @click.stop
      ></textarea>
    </div>

    <div class="detail-close" role="button" title="關閉" @click="ui.closeDetail()">✕</div>
  </div>
</template>

<style scoped>
.detail-head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-6);
  padding: var(--sp-9) var(--sp-10) var(--sp-7);
  border-bottom: 1px solid var(--border-hair);
}

.head-main {
  flex: 1;
  min-width: 0;
}

.detail-back {
  display: inline-flex;
  align-items: center;
  gap: var(--r-badge);
  max-width: 100%;
  margin-bottom: 7px;
  padding: var(--sp-1) 9px var(--sp-1) 7px;
  border: 1px solid var(--border-1);
  border-radius: var(--r-pill);
  background: var(--surface-2);
  cursor: pointer;
  transition:
    background var(--t-fast) ease,
    border-color var(--t-fast) ease;
}

.detail-back:hover {
  background: var(--surface-3);
  border-color: var(--text-placeholder);
}

.back-arrow {
  font-size: var(--fs-pill);
  color: var(--text-muted);
  flex: 0 0 auto;
}

.back-title {
  font-size: var(--fs-date);
  color: var(--text-3);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-title {
  display: inline-block;
  max-width: 100%;
  padding: var(--r-2) var(--r-badge);
  font-size: var(--fs-modal);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  border: 1px solid transparent;
  border-radius: var(--r-badge);
  color: var(--text-1);
  overflow-wrap: anywhere;
  cursor: text;
}

.detail-title:hover {
  background: var(--surface-3);
}

.detail-title-input {
  width: 100%;
  padding: var(--r-2) var(--sp-2);
  font-size: var(--fs-modal);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  border: 1px solid var(--border-control);
  border-radius: var(--r-badge);
  color: var(--text-1);
  background: var(--surface-1);
  font-family: inherit;
  resize: none;
  overflow: hidden;
  overflow-wrap: anywhere;
}

/* 表單 focus 與 legacy 一致：藍框、無 outline（:877） */
.detail-title-input:focus {
  border-color: var(--accent);
  outline: none;
}

.detail-close {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: var(--r-input);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--fs-14);
  cursor: pointer;
}

.detail-close:hover {
  background: var(--surface-3);
  color: var(--text-1);
}

.pane-in {
  animation: paneIn var(--t-layout) var(--ease);
}

.pane-back {
  animation: paneBack var(--t-layout) var(--ease);
}
</style>
