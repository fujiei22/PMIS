<script setup lang="ts">
// 甘特左欄的任務列：把手、狀態點、任務名、起訖日期 + 工期、hover 才出現的快捷鈕。
// legacy 對照：模板 :442-466，groupRows[].tasks :2814-2877。
import { computed } from 'vue'
import { DELAYED, TASK_STATUS } from '@/constants/dashboard'
import { lengthOf } from '@/lib/date'
import { fmtDate, stripYear } from '@/lib/format'
import { isLate } from '@/lib/schedule'
import { useSelectionStore } from '@/stores/selection'
import { useUiStore } from '@/stores/ui'
import type { Task } from '@/types/models'

const props = defineProps<{ task: Task }>()

const ui = useUiStore()
const selection = useSelectionStore()

const late = computed(() => isLate(props.task, ui.todayIdx))
/** 延遲蓋掉原本的狀態，供 CSS 變數與測試使用（契約 E）。 */
const status = computed(() => (late.value ? 'delayed' : props.task.status))
const statusDot = computed(() => (late.value ? DELAYED.bar : TASK_STATUS[props.task.status].bar))

const selected = computed(() => selection.taskId === props.task.id)
/** 前置 / 後續；沒有相依但同屬選取分類（或 soft 篩選命中）時算 group。legacy :2908 */
const rel = computed<'up' | 'down' | 'group' | null>(
  () => selection.related[props.task.id] ?? (selection.softHighlight[props.task.id] ? 'group' : null),
)
/** 有選取且自己不相關 → 淡化。legacy `rowOp` :2820 */
const dimmed = computed(() => selection.hasSelection && !selected.value && !rel.value)

const lifted = computed(() => ui.drag?.kind === 'reorder' && ui.drag.id === props.task.id)
const othersLifted = computed(() => ui.drag?.kind === 'reorder' && ui.drag.id !== props.task.id)
const dropOver = computed(() => ui.drag?.kind === 'reorder' && ui.drag.over?.id === props.task.id)

const hovered = computed(() => ui.rowHoverId === props.task.id)
/** hover 時省掉年份，讓快捷鈕擠得進來。legacy `rangeRow` :2825 */
const rangeText = computed(() => {
  const a = fmtDate(props.task.start)
  const b = fmtDate(props.task.end)
  return hovered.value ? `${stripYear(a)} → ${stripYear(b)}` : `${a} → ${b}`
})
const rangeTitle = computed(() => `${fmtDate(props.task.start)} → ${fmtDate(props.task.end)}`)
const days = computed(() => lengthOf(props.task))
/** 這一列正在開日期選擇器 → 日期膠囊亮起來。legacy `dateBd` :2844 */
const calOpen = computed(() => ui.taskDatePicker?.id === props.task.id)

function onSelect(): void {
  selection.toggleTask(props.task.id)
}
</script>

<template>
  <div
    class="task-row"
    :class="{ selected, dimmed, lifted, 'others-lifted': othersLifted, 'drop-over': dropOver }"
    :data-rowtask="task.id"
    :data-selected="String(selected)"
    :data-status="status"
    :data-rel="rel ?? ''"
    role="button"
    @click="onSelect"
    @mouseenter="ui.rowHoverId = task.id"
    @mouseleave="ui.rowHoverId === task.id && (ui.rowHoverId = null)"
  >
    <div class="grip" :class="{ grabbing: lifted }" @click.stop>⠿</div>
    <div class="st-dot" :style="{ background: statusDot }"></div>
    <div class="name" :title="task.name">{{ task.name }}</div>
    <div class="date" :class="{ open: calOpen }">
      <div class="date-range" :title="rangeTitle">
        <span class="date-text" :class="{ late }">{{ rangeText }}</span>
      </div>
      <span class="date-sep"></span>
      <div class="date-days" title="工期（天）"><span class="days-num">{{ days }}</span></div>
    </div>
    <div class="actions" :class="{ shown: hovered }" @click.stop>
      <span class="act act-step" title="工期加一天">▲</span>
      <span class="act act-step" title="工期減一天">▼</span>
      <span class="act act-dep" title="相依設定">⇄</span>
      <span class="act act-del" title="刪除任務">✕</span>
    </div>
  </div>
</template>

<style scoped>
.task-row {
  position: relative;
  height: var(--gantt-row);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-4) 0 9px;
  border-bottom: 1px solid var(--border-hair);
  border-left: 3px solid transparent;
  cursor: pointer;
  background: transparent;
  opacity: 1;
  scale: 1;
  box-shadow: none;
  z-index: 1;
  transition:
    opacity var(--t-fast) ease,
    scale var(--t-fast) ease,
    box-shadow var(--t-fast) ease,
    background var(--t-fast) ease;
}

/* 底色 / 左側色條：選取 > 相關 > 拖曳落點（legacy :2818-2819） */
.task-row.drop-over {
  background: var(--surface-3);
}

.task-row[data-rel='up'],
.task-row[data-rel='down'],
.task-row[data-rel='group'] {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
  border-left-color: color-mix(in srgb, var(--accent) 40%, transparent);
}

.task-row.selected {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-left-color: var(--accent);
}

.task-row.dimmed {
  opacity: 0.45;
}

.task-row.others-lifted {
  opacity: 0.5;
}

.task-row.lifted {
  opacity: 1;
  scale: 1.025;
  box-shadow: var(--shadow-lift);
  background: var(--surface-1);
  z-index: 6;
}

.grip {
  flex: 0 0 auto;
  cursor: grab;
  color: var(--glyph-disabled);
  font-size: var(--fs-meta);
  line-height: 1;
  letter-spacing: 1px;
}

.grip.grabbing {
  cursor: grabbing;
}

.st-dot {
  width: var(--sp-3);
  height: var(--sp-3);
  flex: 0 0 var(--sp-3);
  border-radius: 50%;
}

.name {
  font-size: var(--fs-record);
  color: var(--text-1);
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.date {
  display: inline-flex;
  align-items: center;
  height: 22px;
  border-radius: var(--r-pill);
  border: 1px solid transparent;
  background: transparent;
  flex: 0 0 auto;
}

.date:hover {
  background: var(--surface-3);
}

.date.open {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.date-range {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--r-badge) 0 7px;
  flex: 0 0 auto;
  cursor: pointer;
  transition: filter var(--t-fast) ease;
}

.date-range:hover {
  filter: var(--hover-dim);
}

.date-text {
  font-size: var(--fs-pill);
  font-family: var(--font-mono);
  color: var(--text-3);
  font-weight: var(--fw-regular);
  white-space: nowrap;
  flex: 0 0 auto;
}

.date-text.late {
  color: var(--danger-text);
  font-weight: var(--fw-bold);
}

.date-sep {
  width: 1px;
  height: var(--sp-6);
  background: var(--border-control);
  flex: 0 0 auto;
}

.date-days {
  display: inline-flex;
  align-items: center;
  gap: var(--r-2);
  height: 20px;
  padding: 0 var(--sp-2);
  flex: 0 0 auto;
}

.days-num {
  font-size: var(--fs-pill);
  font-family: var(--font-mono);
  color: var(--text-2);
  font-weight: var(--fw-medium);
  width: 29px;
  padding: 0 var(--sp-1);
  text-align: right;
  flex: 0 0 auto;
  box-sizing: border-box;
}

/* hover 才把快捷鈕撐開（legacy actW / actOp / actPE :2837） */
.actions {
  display: flex;
  align-items: center;
  gap: var(--r-2);
  flex: 0 0 auto;
  max-width: 0;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
  transition:
    max-width var(--t-bar) var(--ease),
    opacity var(--t-fast) ease;
}

.actions.shown {
  max-width: 80px;
  opacity: 1;
  pointer-events: auto;
}

.act {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: var(--r-4);
}

.act-step {
  width: 15px;
  height: 16px;
  font-size: var(--fs-7);
  color: var(--text-placeholder);
  line-height: 1;
}

.act-step:hover {
  background: var(--border-1);
  color: var(--text-2);
}

.act-dep,
.act-del {
  width: 17px;
  height: 18px;
  font-size: var(--fs-meta);
  color: var(--glyph-disabled);
}

.act-dep:hover {
  color: var(--accent);
  background: var(--surface-3);
}

.act-del:hover {
  color: var(--danger);
  background: var(--danger-bg);
}
</style>
