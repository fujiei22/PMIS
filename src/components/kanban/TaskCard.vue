<script setup lang="ts">
// 任務看板上的一張卡：分類、名稱、優先度、狀態、時程 / 完成日期、負責人、Issue 徽章。
// legacy 對照：模板 :584-633，columns[].tasks :2999-3113。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import Pill from '@/components/common/Pill.vue'
import { DELAYED, PRIORITY, TASK_STATUS } from '@/constants/dashboard'
import { lengthOf } from '@/lib/date'
import { EMPTY_LABEL, fmtDate, stripYear } from '@/lib/format'
import { isLate } from '@/lib/schedule'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Task } from '@/types/models'

const props = defineProps<{ task: Task }>()

const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const memberStore = useMemberStore()
const selection = useSelectionStore()

const late = computed(() => isLate(props.task, ui.todayIdx))
const status = computed(() => (late.value ? 'delayed' : props.task.status))
const st = computed(() => TASK_STATUS[props.task.status])
const pr = computed(() => PRIORITY[props.task.priority])

const selected = computed(() => selection.taskId === props.task.id)
const rel = computed<'up' | 'down' | 'group' | ''>(
  () => selection.related[props.task.id] ?? (selection.softHighlight[props.task.id] ? 'group' : ''),
)
const dimmed = computed(() => selection.hasSelection && !selected.value && !rel.value)

const groupName = computed(() => taskStore.groupById(props.task.groupId)?.name ?? '未分類')
const days = computed(() => lengthOf(props.task))
const rangeShort = computed(
  () => `${stripYear(fmtDate(props.task.start))} → ${stripYear(fmtDate(props.task.end))}`,
)
const rangeFull = computed(() => `${fmtDate(props.task.start)} → ${fmtDate(props.task.end)}`)
const doneLabel = computed(() => (props.task.done ? fmtDate(props.task.done) : EMPTY_LABEL.dash))
const createdLabel = computed(() => fmtDate(props.task.created || props.task.start))

const assignees = computed(() =>
  props.task.assigneeIds.map((id) => memberStore.byId(id)).filter((m) => !!m),
)

const issues = computed(() => issueStore.byTask(props.task.id))
const openIssues = computed(() => issueStore.openCount(props.task.id))
/** 有未結 Issue 顯示紅色 `!N`，全結案顯示綠色 `✓N`。legacy :3003-3006 */
const issueBadge = computed(() => ({
  open: openIssues.value > 0,
  mark: openIssues.value ? '!' : '✓',
  count: openIssues.value || issues.value.length,
}))
</script>

<template>
  <div
    class="card"
    :class="{ selected, dimmed, late, [`rel-${rel}`]: !!rel }"
    :data-card="task.id"
    :data-selected="String(selected)"
    :data-rel="rel"
    :data-status="status"
    draggable="true"
    role="button"
    @click.stop="selection.toggleTask(task.id, 'card')"
  >
    <div class="del" role="button" @click.stop>✕</div>
    <div class="group" :title="groupName">{{ groupName }}</div>

    <div class="title-row">
      <div class="title">{{ task.name }}</div>
      <div class="prio" :style="{ background: pr.color }">{{ pr.label }}</div>
    </div>

    <div class="chips">
      <div
        class="st"
        :style="{
          color: st.bar,
          background: `color-mix(in srgb, ${st.bar} 12%, transparent)`,
        }"
        role="button"
        @click.stop
      >
        <span class="st-dot" :style="{ background: st.bar }"></span>
        <span>{{ st.label }}</span>
        <span class="st-caret">▼</span>
      </div>
      <div v-if="late" class="late-chip">
        <span class="late-dot"></span><span>{{ DELAYED.label }}</span>
      </div>
    </div>

    <div class="dates">
      <span class="range-pill">
        <span class="range-main" :title="rangeFull">
          <span class="range-label">時程</span>
          <span class="range-value" :class="{ late }">{{ rangeShort }}</span>
        </span>
        <span class="range-sep"></span>
        <span class="range-days" title="工期（天）">
          <span class="days-num">{{ days }}</span>
          <span class="days-step">
            <span class="step" title="加一天">▲</span>
            <span class="step" title="減一天">▼</span>
          </span>
        </span>
      </span>
      <Pill label="完成日期" caret clickable>
        <span :class="task.done ? 'done-on' : 'done-off'">{{ doneLabel }}</span>
      </Pill>
    </div>

    <div class="foot">
      <div class="avatars">
        <Avatar
          v-for="m in assignees"
          :key="m.id"
          :member="m"
          :size="20"
          :ring="2"
          :overlap="6"
          expandable
        />
      </div>
      <div class="foot-gap"></div>
      <div class="created" :title="`建立於 ${createdLabel}`">{{ createdLabel }}</div>
      <div v-if="issues.length" class="issue-badge" :class="{ open: issueBadge.open }">
        <span>{{ issueBadge.mark }}</span><span>{{ issueBadge.count }}</span>
      </div>
      <div class="caret" role="button" @click.stop>⤢</div>
    </div>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
  border: 1px solid var(--border-1);
  border-radius: var(--r-card-sm);
  padding: var(--pad-kanban-card);
  cursor: pointer;
  background: var(--surface-1);
  box-shadow: none;
  opacity: 1;
  transition:
    background var(--t-base) ease,
    border-color var(--t-base) ease,
    box-shadow var(--t-base) ease,
    opacity var(--t-base) ease,
    transform var(--t-base) var(--ease);
}

.card:hover {
  border-color: var(--text-placeholder);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

/* 延遲的卡整張泛紅（legacy cardBg / cardBd :3007） */
.card.late {
  background: var(--bg-late);
  border-color: var(--danger-bd);
}

/* 相關任務用虛線框（legacy cardBdStyle :3009） */
.card.rel-up,
.card.rel-down,
.card.rel-group {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
}

.card.selected {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-style: solid;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.card.dimmed {
  opacity: 0.45;
}

.del {
  position: absolute;
  top: var(--sp-3);
  right: var(--sp-3);
  width: var(--sp-10);
  height: var(--sp-10);
  border-radius: var(--r-6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--glyph-disabled);
  font-size: var(--fs-date);
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}

.del:hover {
  color: var(--danger);
  background: var(--danger-bg);
}

.group {
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: var(--tracking-overline);
  line-height: 14px;
  padding-right: var(--sp-12);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.title-row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
}

.title {
  font-size: var(--fs-record);
  font-weight: var(--fw-medium);
  line-height: 19px;
  min-height: 38px;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.prio {
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  color: var(--surface-1);
  border-radius: var(--r-badge);
  padding: 1px var(--sp-3);
  white-space: nowrap;
  flex: 0 0 auto;
}

.chips {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  flex-wrap: wrap;
  min-height: var(--sp-10);
  margin-top: -4px;
}

.st {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 0 auto;
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  border-radius: var(--r-pill);
  padding: 1px 7px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    filter var(--t-fast) ease,
    box-shadow var(--t-fast) ease;
}

.st:hover {
  filter: var(--hover-dim);
  box-shadow: var(--ring-node);
}

.st-dot {
  width: var(--r-badge);
  height: var(--r-badge);
  flex: 0 0 var(--r-badge);
  border-radius: 50%;
}

.st-caret {
  font-size: var(--fs-7-5);
  opacity: 0.6;
}

.late-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 0 auto;
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  color: var(--danger);
  background: var(--danger-bg);
  border: 1px solid var(--danger-bd);
  border-radius: var(--r-pill);
  padding: 1px 7px;
  white-space: nowrap;
}

.late-dot {
  width: var(--r-badge);
  height: var(--r-badge);
  flex: 0 0 var(--r-badge);
  border-radius: 50%;
  background: var(--today);
}

.dates {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  flex-wrap: wrap;
}

.range-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  min-width: 0;
  overflow: hidden;
}

.range-main {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  height: 22px;
  padding: 0 9px 0 var(--sp-4);
  flex: 0 0 auto;
  cursor: pointer;
  transition: filter var(--t-fast) ease;
}

.range-main:hover {
  filter: var(--hover-dim);
}

.range-label {
  font-size: var(--fs-micro);
  font-weight: var(--fw-bold);
  color: var(--text-placeholder);
  letter-spacing: 0.04em;
  flex: 0 0 auto;
}

.range-value {
  font-size: var(--fs-date);
  font-family: var(--font-mono);
  color: var(--text-3);
  font-weight: var(--fw-regular);
  white-space: nowrap;
  flex: 0 0 auto;
  width: 94px;
}

.range-value.late {
  color: var(--danger-text);
  font-weight: var(--fw-bold);
}

.range-sep {
  width: 1px;
  height: var(--sp-6);
  background: var(--border-control);
  flex: 0 0 auto;
}

.range-days {
  display: inline-flex;
  align-items: center;
  gap: var(--r-2);
  height: 22px;
  padding: 0 var(--sp-2);
  flex: 0 0 auto;
}

.days-num {
  font-size: var(--fs-date);
  font-family: var(--font-mono);
  color: var(--text-2);
  font-weight: var(--fw-medium);
  width: var(--sp-10);
  padding: 0 var(--r-2);
  text-align: right;
  flex: 0 0 auto;
  box-sizing: border-box;
}

.days-step {
  display: inline-flex;
  flex-direction: column;
  flex: 0 0 auto;
}

.step {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 9px;
  font-size: var(--fs-6);
  color: var(--text-placeholder);
  cursor: pointer;
  line-height: 1;
}

.step:first-child {
  border-radius: var(--r-3) var(--r-3) 0 0;
}

.step:last-child {
  border-radius: 0 0 var(--r-3) var(--r-3);
}

.step:hover {
  background: var(--border-1);
  color: var(--text-2);
}

.done-on {
  color: var(--success-text);
}

.done-off {
  color: var(--text-placeholder);
}

.foot {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  padding-top: 7px;
  border-top: 1px solid var(--border-hair);
}

.avatars {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  padding-right: var(--sp-4);
}

.foot-gap {
  flex: 1;
  min-width: var(--sp-2);
}

.created {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  font-size: var(--fs-caption);
  font-family: var(--font-mono);
  color: var(--text-placeholder);
  white-space: nowrap;
}

.issue-badge {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  color: var(--success-text);
  background: var(--success-bg);
  border-radius: var(--r-pill);
  padding: 1px var(--sp-3);
  flex: 0 0 auto;
}

.issue-badge.open {
  color: var(--danger-text);
  background: var(--danger-bg);
}

.caret {
  width: var(--sp-10);
  height: var(--sp-10);
  flex: 0 0 var(--sp-10);
  border-radius: var(--r-6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--fs-meta);
  cursor: pointer;
}

.caret:hover {
  background: var(--surface-3);
  color: var(--text-2);
}
</style>
