<script setup lang="ts">
// 甘特左欄的分類列：把手、收合箭頭、分類名、工期天數、刪除鈕。
// legacy 對照：模板 :429-440，groupRows :2762-2813。
import { computed, nextTick, ref, watch } from 'vue'
import { useEditDraft } from '@/composables/useEditDraft'
import { usePointerDragContext } from '@/composables/usePointerDrag'
import { dayIndex } from '@/lib/date'
import { useFilterStore } from '@/stores/filter'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Group } from '@/types/models'

const props = defineProps<{ group: Group }>()

const ui = useUiStore()
const taskStore = useTaskStore()
const filter = useFilterStore()
const selection = useSelectionStore()
const drag = usePointerDragContext()

/** 這個分類底下、通過篩選的任務。legacy :2763 */
const tasks = computed(() =>
  taskStore.tasks.filter((t) => t.groupId === props.group.id && filter.passTask(t)),
)

/** 從最早 start 到最晚 end 的天數；沒有任務就 0。legacy :2764-2766 */
const span = computed(() => {
  if (!tasks.value.length) return 0
  const starts = tasks.value.map((t) => dayIndex(t.start))
  const ends = tasks.value.map((t) => dayIndex(t.end))
  return Math.max(...ends) - Math.min(...starts) + 1
})

const selected = computed(() => selection.groupId === props.group.id)
/** 收合狀態在 ui，不在 Group 上（review C5）。 */
const collapsed = computed(() => ui.collapsedGroups.has(props.group.id))
/** 重排拖曳中：被拖的那列抬起來，其他列淡化。legacy :2780-2784（S5 才會填 drag） */
const lifted = computed(() => ui.drag?.kind === 'greorder' && ui.drag.id === props.group.id)
const dimmed = computed(() => ui.drag?.kind === 'greorder' && ui.drag.id !== props.group.id)
/** 任務重排時經過這個分類 → 底色提示。legacy :2805 */
const dropOver = computed(() => ui.drag?.kind === 'reorder' && ui.drag.over?.id === props.group.id)

function onSelect(): void {
  selection.toggleGroup(props.group.id)
}

function onCaret(e: MouseEvent): void {
  e.stopPropagation()
  ui.toggleGroup(props.group.id)
}

/** 雙擊分類名進就地編輯。legacy `onEdit` :2793 */
const editing = computed(() => ui.editing?.kind === 'g' && ui.editing.id === props.group.id)
const inputEl = ref<HTMLInputElement | null>(null)

watch(editing, async (on) => {
  if (!on) return
  await nextTick()
  const el = inputEl.value
  if (!el) return
  el.focus()
  // 游標放最後，接著打字是附加而不是覆蓋（legacy autoFocus 的行為）
  el.setSelectionRange(el.value.length, el.value.length)
})

function startEdit(e: MouseEvent): void {
  e.stopPropagation()
  ui.editing = { kind: 'g', id: props.group.id }
}

/**
 * 每一鍵就寫進 store，legacy 的 onChange 也是逐鍵觸發（:2799）；
 * api 由 `useEditDraft` 做 300ms debounce，離開編輯時 flush（契約 B-2）。
 */
const nameDraft = useEditDraft({
  get: () => props.group.name,
  applyLocal: (v) => taskStore.renameGroupLocal(props.group.id, v),
  commit: (v) => taskStore.commitGroupPatch(props.group.id, { name: v }),
})

function onRename(e: Event): void {
  nameDraft.onInput((e.target as HTMLInputElement).value)
}

/** Enter / Esc / blur 都只結束編輯，不還原（legacy :2795-2798）；離開前先送出草稿。 */
function endEdit(): void {
  void nameDraft.flush()
  if (editing.value) ui.editing = null
}

function onEditKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  if (e.key === 'Escape') {
    void nameDraft.flush()
    ui.editing = null
  }
}

/** 刪除分類走兩步確認。legacy `onDelete` :2809 */
function askDelete(e: MouseEvent): void {
  e.stopPropagation()
  ui.confirm = { kind: 'group', id: props.group.id, step: 1 }
}

/** 看板卡片拖到分類列 → 搬進這個分類（放在第一筆之前）。legacy `onDrop` :2813 */
function onDrop(e: DragEvent): void {
  e.preventDefault()
  e.stopPropagation()
  const raw = e.dataTransfer?.getData('text/plain') ?? ''
  if (!raw.startsWith('task:')) return
  taskStore.moveTaskTo(raw.slice(5), { kind: 'g', id: props.group.id })
}
</script>

<template>
  <div
    class="grow-row"
    :class="{ selected, lifted, dimmed, 'drop-over': dropOver }"
    :data-rowgroup="group.id"
    role="button"
    @click="onSelect"
    @dragover.prevent
    @drop="onDrop"
  >
    <div
      class="grip"
      :class="{ grabbing: lifted }"
      @click.stop
      @pointerdown="drag.startGroupReorder($event, group.id)"
    >
      ⠿
    </div>
    <div class="caret" role="button" @click="onCaret">{{ collapsed ? '▶' : '▼' }}</div>
    <div v-if="!editing" class="name" :title="group.name" @dblclick="startEdit">
      {{ group.name }}
    </div>
    <input
      v-else
      ref="inputEl"
      class="name-input"
      :value="group.name"
      @click.stop
      @input="onRename"
      @blur="endEdit"
      @keydown="onEditKey"
    />
    <div class="span">{{ span }}d</div>
    <div class="del" role="button" title="刪除分類" @click="askDelete">✕</div>
  </div>
</template>

<style scoped>
.grow-row {
  position: relative;
  height: var(--gantt-row);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 var(--sp-5) 0 var(--sp-6);
  background: var(--surface-group);
  border-bottom: 1px solid var(--border-hair);
  cursor: pointer;
  opacity: 1;
  scale: 1;
  box-shadow: none;
  z-index: 1;
  transition:
    opacity var(--t-fast) ease,
    scale var(--t-fast) ease,
    box-shadow var(--t-fast) ease;
}

.grow-row.drop-over {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.grow-row.selected {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.grow-row.dimmed {
  opacity: 0.5;
}

.grow-row.lifted {
  scale: 1.02;
  box-shadow: var(--shadow-lift);
  z-index: 6;
}

.grip {
  cursor: grab;
  color: var(--glyph-disabled);
  font-size: var(--fs-meta);
  line-height: 1;
  letter-spacing: 1px;
}

.grip.grabbing {
  cursor: grabbing;
}

.caret {
  width: 14px;
  font-size: var(--fs-pill);
  color: var(--text-muted);
  cursor: pointer;
}

.name {
  font-size: var(--fs-record);
  font-weight: var(--fw-bold);
  color: var(--text-2);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: var(--r-2) var(--sp-2);
}

.grow-row.selected .name {
  color: var(--accent);
}

.name-input {
  font-size: var(--fs-record);
  font-weight: var(--fw-bold);
  color: var(--text-2);
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  border-radius: var(--r-badge);
  padding: var(--r-2) var(--sp-2);
}

/* 表單 focus 與 legacy 一致（spec §設計方向 表單慣例） */
.name-input:focus {
  border-color: var(--accent);
  outline: none;
}

.span {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.del {
  font-size: var(--fs-meta);
  color: var(--glyph-disabled);
  padding: 0 var(--r-2);
  cursor: pointer;
}

.del:hover {
  color: var(--danger);
}
</style>
