<script setup lang="ts">
// 甘特左欄的分類列：把手、收合箭頭、分類名、工期天數、刪除鈕。
// legacy 對照：模板 :429-440，groupRows :2762-2813。
import { computed } from 'vue'
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
/** 重排拖曳中：被拖的那列抬起來，其他列淡化。legacy :2780-2784（S5 才會填 drag） */
const lifted = computed(() => ui.drag?.kind === 'greorder' && ui.drag.id === props.group.id)
const dimmed = computed(() => ui.drag?.kind === 'greorder' && ui.drag.id !== props.group.id)
/** 任務重排時經過這個分類 → 底色提示。legacy :2805 */
const dropOver = computed(
  () => ui.drag?.kind === 'reorder' && ui.drag.over?.id === props.group.id,
)

function onSelect(): void {
  selection.toggleGroup(props.group.id)
}

function onCaret(e: MouseEvent): void {
  e.stopPropagation()
  taskStore.toggleGroup(props.group.id)
}
</script>

<template>
  <div
    class="grow-row"
    :class="{ selected, lifted, dimmed, 'drop-over': dropOver }"
    :data-rowgroup="group.id"
    role="button"
    @click="onSelect"
  >
    <div class="grip" :class="{ grabbing: lifted }" @click.stop>⠿</div>
    <div class="caret" role="button" @click="onCaret">{{ group.collapsed ? '▶' : '▼' }}</div>
    <div class="name" :title="group.name">{{ group.name }}</div>
    <div class="span">{{ span }}d</div>
    <div class="del">✕</div>
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

.span {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.del {
  font-size: var(--fs-meta);
  color: var(--glyph-disabled);
  padding: 0 var(--r-2);
}
</style>
