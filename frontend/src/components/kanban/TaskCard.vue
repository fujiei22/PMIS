<script setup lang="ts">
// 任務看板上的一張卡：分類、名稱、優先度、狀態、時程 / 完成日期、負責人、Issue 徽章。
// 唯讀時（F2）沒有刪除鈕與工期 ▲▼、不能拖，狀態 / 時程 / 完成日期只是顯示（點了不開選單）。
// 工期顯示有效工期（工作天），▲▼ 依排程規則停用並在 title 寫原因（規則見 docs/reference/scheduling.md）。
// legacy 對照：模板 :584-633，columns[].tasks :2999-3113。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import Pill from '@/components/common/Pill.vue'
import { useDomRegistry, registerEl } from '@/composables/useDomRegistry'
import { useMenus } from '@/composables/useMenus'
import {
  DELAYED,
  EDIT_BLOCK_TEXT,
  LATE_TITLE,
  OVERDUE_SHRINK_TEXT,
  PRIORITY,
  TASK_STATUS,
} from '@/constants/dashboard'
import { EMPTY_LABEL, fmtDate, fmtWorkdays, shortDate, stripYear, WORKDAY_UNIT } from '@/lib/format'
import { DURATION_MAX, durationOf, isLate, lateDays } from '@/lib/schedule'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import { useWorkCalendarStore } from '@/stores/workCalendar'
import type { Task } from '@/types/models'

const props = defineProps<{ task: Task }>()

const registry = useDomRegistry()

const calendar = useWorkCalendarStore()
const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const memberStore = useMemberStore()
const selection = useSelectionStore()
const { openOptionMenu, openTaskDatePicker, openIssueDatePicker } = useMenus()

const late = computed(() => isLate(props.task))
/** 延遲 chip 的 title：比的是哪一天、晚了幾個工作天。 */
const lateTitle = computed(() =>
  late.value
    ? LATE_TITLE(
        shortDate(props.task.baselineEnd),
        fmtWorkdays(lateDays(props.task, calendar.workdays)),
      )
    : '',
)
const status = computed(() => (late.value ? 'delayed' : props.task.status))
const st = computed(() => TASK_STATUS[props.task.status])
const pr = computed(() => PRIORITY[props.task.priority])

const selected = computed(() => selection.taskId === props.task.id)
const rel = computed<'up' | 'down' | 'group' | ''>(
  () => selection.related[props.task.id] ?? (selection.softHighlight[props.task.id] ? 'group' : ''),
)
const dimmed = computed(() => selection.hasSelection && !selected.value && !rel.value)

const groupName = computed(() => taskStore.groupById(props.task.groupId)?.name ?? '未分類')
/** 有效工期（工作天）：顯示與 ▲▼ 加減都以它為準（規則見 docs/reference/scheduling.md〈有效工期〉）。 */
const days = computed(() => durationOf(props.task, calendar.workdays))

/** 這張卡的編輯限制（`lib/editPolicy.ts`）；欄位沒變時是同一個物件，別的任務改了不會讓這張重算。 */
const policy = computed(() => taskStore.policyOf(props.task.id))

/** ▲ 的狀態：已完成停用（結束日就是完成日，title 寫原因）；到上限 DURATION_MAX 也停用。 */
const up = computed(() => {
  const block = policy.value.durationBlock
  if (block) return { disabled: true, title: EDIT_BLOCK_TEXT[block] }
  return { disabled: days.value >= DURATION_MAX, title: `加一個${WORKDAY_UNIT}` }
})

/**
 * ▼ 的狀態：已完成停用；逾期時停用（結束日暫定今天，減了也不會提早，title 寫原因）；
 * 只剩 1 工作天也停用。
 */
const down = computed(() => {
  const block = policy.value.durationBlock
  if (block) return { disabled: true, title: EDIT_BLOCK_TEXT[block] }
  if (policy.value.overdue) return { disabled: true, title: OVERDUE_SHRINK_TEXT }
  return { disabled: days.value <= 1, title: `減一個${WORKDAY_UNIT}` }
})
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

/**
 * 工期加一個工作天：以有效工期為準送 `{ duration }`，結束日與下游由排程推算。停用時不動作。
 * legacy `onDaysUp` :3081（legacy 是結束日加一個日曆天）
 */
function daysUp(): void {
  if (up.value.disabled) return
  taskStore.updateTask(props.task.id, { duration: days.value + 1 })
}

/** 工期減一個工作天；停用時（已完成、逾期、只剩 1 工作天）不動作。legacy `onDaysDown` :3082 */
function daysDown(): void {
  if (down.value.disabled) return
  taskStore.updateTask(props.task.id, { duration: days.value - 1 })
}

/** 刪除任務走兩步確認。legacy `onAskDelete` :3100 */
function askDelete(): void {
  ui.askDelete('task', props.task.id)
}

/** 工期格：可編輯時點了不選卡片（裡面是 ▲▼）；唯讀時沒有 ▲▼，點了當成點卡片。 */
function stopIfEditable(e: MouseEvent): void {
  if (ui.canEdit) e.stopPropagation()
}

/** 開始拖卡片；`task:<id>` 是甘特列與分類列認得的格式。legacy `onCardDragStart` :3090 */
function onDragStart(e: DragEvent): void {
  e.dataTransfer?.setData('text/plain', `task:${props.task.id}`)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

/** ⤢ 開 / 關任務詳情（視窗本體由 S6 做）。legacy `onToggleExpand` :3064 */
function toggleDetail(): void {
  if (ui.detail?.kind === 'task' && ui.detail.id === props.task.id) ui.closeDetail()
  else ui.openDetail(props.task.id, 'task')
}
</script>

<template>
  <div
    class="card"
    :class="{ selected, dimmed, late, [`rel-${rel}`]: !!rel, readonly: !ui.canEdit }"
    :ref="registerEl(registry.cards, task.id)"
    :data-card="task.id"
    :data-selected="String(selected)"
    :data-rel="rel"
    :data-status="status"
    :draggable="ui.canEdit"
    role="button"
    @click.stop="selection.toggleTask(task.id, 'card')"
    @dragstart="onDragStart"
  >
    <div v-if="ui.canEdit" class="del" role="button" title="刪除任務" @click.stop="askDelete()">
      ✕
    </div>
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
        @click="openOptionMenu($event, task.id, 'status')"
      >
        <span class="st-dot" :style="{ background: st.bar }"></span>
        <span>{{ st.label }}</span>
        <span v-if="ui.canEdit" class="st-caret">▼</span>
      </div>
      <div v-if="late" class="late-chip" :title="lateTitle">
        <span class="late-dot"></span><span>{{ DELAYED.label }}</span>
      </div>
    </div>

    <div class="dates">
      <span class="range-pill">
        <span
          class="range-main"
          :title="rangeFull"
          role="button"
          @click="openTaskDatePicker($event, task.id)"
        >
          <span class="range-label">時程</span>
          <span class="range-value" :class="{ late }">{{ rangeShort }}</span>
        </span>
        <span class="range-sep"></span>
        <!-- 卡片放不下「N 工作天」（平板四欄時 ▲▼ 會被擠出膠囊）：畫面只放數字，單位寫在 title 與 aria-label -->
        <span class="range-days" :title="`工期（${WORKDAY_UNIT}）`" @click="stopIfEditable">
          <span class="days-num" :aria-label="fmtWorkdays(days)">{{ days }}</span>
          <span v-if="ui.canEdit" class="days-step">
            <span
              class="step"
              :class="{ disabled: up.disabled }"
              role="button"
              :aria-disabled="up.disabled ? 'true' : undefined"
              :title="up.title"
              @click.stop="daysUp()"
              >▲</span
            >
            <span
              class="step"
              :class="{ disabled: down.disabled }"
              role="button"
              :aria-disabled="down.disabled ? 'true' : undefined"
              :title="down.title"
              @click.stop="daysDown()"
              >▼</span
            >
          </span>
        </span>
      </span>
      <Pill
        label="完成日期"
        :caret="ui.canEdit"
        :clickable="ui.canEdit"
        @click="openIssueDatePicker($event, task.id, 'done', task.done, 'task')"
      >
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
        <span>{{ issueBadge.mark }}</span
        ><span>{{ issueBadge.count }}</span>
      </div>
      <div class="caret" role="button" title="開啟詳細" @click.stop="toggleDetail()">⤢</div>
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

/* 唯讀（F2）：狀態與時程只是顯示，拿掉 hover；點了等於點卡片（選取），游標跟卡片一樣 */
.card.readonly .st,
.card.readonly .range-main {
  cursor: inherit;
}

.card.readonly .st:hover {
  filter: none;
  box-shadow: none;
}

.card.readonly .range-main:hover {
  filter: none;
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

/* 停用（已完成、逾期的 ▼、到上下限）：同列選單 :disabled 的字色，游標不變、沒有 hover */
.step.disabled,
.step.disabled:hover {
  background: transparent;
  color: var(--glyph-disabled);
  cursor: default;
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

/* 空間不夠時先縮它（截成 …），右側的 Issue 數與「開啟詳細」才不會被擠出卡片外框 */
.created {
  display: block;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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

/*
 * 手指操作（pointer: coarse）：原本的 ✕ / ⤢ 20px、工期 ▲▼ 13×9px、狀態膠囊 18px 高，手指點不準。
 * ✕ / ⤢ 用看不見的外擴熱區（外觀不變）；▲▼ 與膠囊在 overflow: hidden 的日期膠囊裡，只能把本體加大。
 */
@media (pointer: coarse) {
  .del::after,
  .caret::after {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--sp-3));
  }

  .caret {
    position: relative;
  }

  .st {
    padding: var(--sp-2) var(--sp-4);
  }

  .range-pill,
  .range-main {
    height: 28px;
  }

  /* ▲▼ 維持上下疊（橫向四欄時卡片只有約 215px，左右並排放不下），各加大到 24×14 */
  .step {
    width: 24px;
    height: 14px;
    font-size: var(--fs-7);
  }
}

/* 平板直向是兩欄、卡片夠寬：▲▼ 改左右並排，各佔滿膠囊高度（24×28） */
@media (pointer: coarse) and (max-width: 899px) {
  .days-step {
    flex-direction: row;
  }

  .step {
    height: 28px;
  }
}
</style>
