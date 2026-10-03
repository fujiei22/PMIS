<script setup lang="ts">
// 詳細視窗左欄（任務）：負責人、分類、時程、工期、計畫基準、建立、完成日、優先度、執行狀態、相依、Issue 清單。
// 唯讀時（F2）沒有指派 / 移除負責人、編輯相依、開立 Issue、刪除，膠囊只是顯示（點了不開選單）。
// legacy 對照：模板 :887-1007，欄位來源是看板卡片那份 view-model（columns[].tasks :2999-3113）。
// 工期、計畫基準兩列 legacy 沒有（排程規則見 docs/reference/scheduling.md）。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'
import { useMenus } from '@/composables/useMenus'
import { useTaskActions } from '@/composables/useTaskActions'
import {
  BASELINE_ROW_TEXT,
  DELAYED,
  ISSUE_LEVEL,
  ISSUE_STATUS,
  LATE_TITLE,
  PRIORITY,
  TASK_STATUS,
} from '@/constants/dashboard'
import { EMPTY_LABEL, fmtDate, fmtWorkdays, shortDate } from '@/lib/format'
import { durationOf, isLate, isLateIssue, lateDays } from '@/lib/schedule'
import { useClockStore } from '@/stores/clock'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useProjectStore } from '@/stores/project'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import { useWorkCalendarStore } from '@/stores/workCalendar'
import type { Task } from '@/types/models'

const props = defineProps<{ task: Task }>()

const actions = useTaskActions()
const clock = useClockStore()
const calendar = useWorkCalendarStore()
const project = useProjectStore()
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
const st = computed(() => TASK_STATUS[props.task.status])
const pr = computed(() => PRIORITY[props.task.priority])

const groupName = computed(() => taskStore.groupById(props.task.groupId)?.name ?? '未分類')
/** 時程列只寫推算起訖；工期另起一列（工作天），不再跟日曆天的「· Nd」擠在一起。 */
const rangeLabel = computed(() => `${fmtDate(props.task.start)} → ${fmtDate(props.task.end)}`)
/**
 * 工期列：有效工期（完成＝實際工作天；進行中／暫停逾期時含延長；未開始＝輸入值）。
 * 跟甘特、卡片、排序同一個 durationOf，數字才會處處一致。
 */
const durationLabel = computed(() => fmtWorkdays(durationOf(props.task, calendar.workdays)))

// ── 計畫基準 ──────────────────────────────────────────────────────────────────
/** 基準鎖是整個專案一把：鎖定日有值＝上鎖。 */
const locked = computed(() => !!project.meta.baselineLockedOn)
/**
 * 解鎖時存的基準（props 的 task 是畫面看的值，解鎖時基準已換成推算起訖，原本的要另外讀）。
 * 上鎖時不用：畫面上的基準就是存的。
 */
const stored = computed(() => (locked.value ? null : taskStore.storedBaseline(props.task.id)))
/**
 * 基準列要顯示什麼：
 * - planning：規劃中、有原基準。原基準保留，上鎖時才決定更新或沿用；不比延遲。
 * - unlocked：規劃中、還沒有基準（解鎖期間新增的），上鎖時用當下的排程。
 * - none：上鎖了但這筆沒有基準（舊資料），不算延遲，寫「未設定」。
 * - set：基準起訖；延遲時另外標出晚幾個工作天。
 */
const baselineState = computed<'planning' | 'unlocked' | 'none' | 'set'>(() => {
  if (!locked.value) return stored.value ? 'planning' : 'unlocked'
  return props.task.baselineStart && props.task.baselineEnd ? 'set' : 'none'
})
const baselineText = computed(() => {
  if (baselineState.value === 'planning')
    return BASELINE_ROW_TEXT.planning(
      `${fmtDate(stored.value!.start)} → ${fmtDate(stored.value!.end)}`,
    )
  if (baselineState.value === 'unlocked') return BASELINE_ROW_TEXT.unlocked
  if (baselineState.value === 'none') return BASELINE_ROW_TEXT.none
  return `${fmtDate(props.task.baselineStart)} → ${fmtDate(props.task.baselineEnd)}`
})
/** 膠囊的 title：上鎖時補上鎖定日、規劃中補上鎖時怎麼處理；文字被截斷時也看得到全文。 */
const baselineTitle = computed(() =>
  baselineState.value === 'set'
    ? `${baselineText.value}｜${BASELINE_ROW_TEXT.lockedOn(fmtDate(project.meta.baselineLockedOn))}`
    : baselineState.value === 'planning'
      ? `${baselineText.value}｜${BASELINE_ROW_TEXT.planningTitle}`
      : baselineText.value,
)
/** 「晚 N 工作天」：看得見的說明（觸控看不到 title），延遲 chip 的 title 只是補充。 */
const lateLabel = computed(() =>
  late.value ? BASELINE_ROW_TEXT.late(fmtWorkdays(lateDays(props.task, calendar.workdays))) : '',
)
const createdLabel = computed(() => fmtDate(props.task.created || props.task.start))
const donePill = computed(() =>
  props.task.done ? fmtDate(props.task.done) : EMPTY_LABEL.notFilled,
)

// ── 負責人（chips + 可展開的選擇器）──────────────────────────────────────────
const assigned = computed(() =>
  props.task.assigneeIds.map((id) => memberStore.byId(id)).filter((m) => !!m),
)
/** ＋指派可以選的人：沒停用、還沒指派的（已指派的停用者照樣在上面的標籤裡，可以移除）。 */
const available = computed(() =>
  memberStore.assignable().filter((m) => !props.task.assigneeIds.includes(m.id)),
)
const pickerOpen = computed(() => ui.pickerFor === props.task.id)
/** 收起時仍保留 DOM 讓 grid-template-rows 有東西可補間。legacy `pickerMounted` :3063 */
const pickerMounted = useDelayedUnmount(pickerOpen, 220)

/** 展開 / 收合負責人選擇器。legacy `onTogglePicker` :3077 */
function togglePicker(): void {
  ui.toggleAssigneePicker(props.task.id)
}

function removeAssignee(id: string): void {
  taskStore.updateTask(props.task.id, {
    assigneeIds: props.task.assigneeIds.filter((x) => x !== id),
  })
}

function addAssignee(id: string): void {
  taskStore.updateTask(props.task.id, { assigneeIds: props.task.assigneeIds.concat([id]) })
}

// ── 相依 ────────────────────────────────────────────────────────────────────
const predLabel = computed(() => {
  const names = taskStore.predecessors(props.task.id).map((t) => t.name)
  return names.length ? names.join('、') : '無'
})
const succLabel = computed(() => {
  const names = taskStore.successors(props.task.id).map((t) => t.name)
  return names.length ? names.join('、') : '無'
})

// ── Issue 清單（legacy issueRows :3039）──────────────────────────────────────
const issues = computed(() => issueStore.byTask(props.task.id))

/** 點 Issue 列：推進堆疊（帶 from 讓返回鈕出現）。legacy :3046 */
function openIssue(issueId: string): void {
  ui.openDetail(issueId, 'issue', props.task.id)
  // legacy 只設 selIssue，不動 selTask，也不重播捲動（:3049）
  selection.issueId = issueId
}

/** ＋ 開立 Issue。legacy `onAddIssue` :3109 */
function addIssue(): void {
  actions.addIssueForTask(props.task.id)
}

/** 刪任務走兩步確認；刪完 removeTask 會清 ui.detail 讓視窗正常關閉。legacy `onAskDelete` :3099 */
function askDelete(): void {
  ui.askDelete('task', props.task.id)
}
</script>

<template>
  <div class="props task-props" :class="{ readonly: !ui.canEdit }">
    <!-- 負責人 -->
    <div class="row">
      <div class="label"><span class="glyph">◍</span><span>負責人</span></div>
      <div class="chips">
        <div v-for="m in assigned" :key="m.id" class="chip">
          <Avatar :member="m" :size="16" />
          <span>{{ m.name }}</span>
          <span v-if="ui.canEdit" class="chip-x" role="button" @click.stop="removeAssignee(m.id)"
            >✕</span
          >
        </div>
        <div v-if="ui.canEdit" class="chip-add" role="button" @click.stop="togglePicker()">
          ＋ 指派
        </div>
      </div>
    </div>
    <div class="picker-wrap" :style="{ gridTemplateRows: pickerOpen ? '1fr' : '0fr' }">
      <div class="picker-clip">
        <div v-if="pickerMounted" class="picker">
          <div
            v-for="m in available"
            :key="m.id"
            class="picker-chip"
            role="button"
            @click.stop="addAssignee(m.id)"
          >
            <Avatar :member="m" :size="15" />
            <span>{{ m.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 分類 -->
    <div class="row">
      <div class="label"><span class="glyph">▤</span><span>分類</span></div>
      <div class="pill pill-plain" role="button" @click="openOptionMenu($event, task.id, 'group')">
        <span class="pill-text">{{ groupName }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 時程 -->
    <div class="row">
      <div class="label"><span class="glyph">▦</span><span>時程</span></div>
      <div class="pill pill-plain mono" role="button" @click="openTaskDatePicker($event, task.id)">
        <span class="pill-text">{{ rangeLabel }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 工期（有效工期，工作天）：點了開同一個日期選擇器，在裡面改工期 -->
    <div class="row">
      <div class="label"><span class="glyph">◔</span><span>工期</span></div>
      <div class="pill pill-plain mono" role="button" @click="openTaskDatePicker($event, task.id)">
        <span class="pill-text">{{ durationLabel }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 計畫基準：只顯示，改基準要整個專案解鎖再上鎖（甘特面板的基準鎖） -->
    <div class="row">
      <div class="label">
        <span class="glyph">▭</span><span>{{ BASELINE_ROW_TEXT.label }}</span>
      </div>
      <div class="pill-static mono baseline" :title="baselineTitle">
        <svg
          v-if="baselineState === 'set'"
          class="lock-icon"
          viewBox="0 0 12 12"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" />
          <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
        </svg>
        <span class="pill-text">{{ baselineText }}</span>
      </div>
      <span v-if="lateLabel" class="late-days" :title="lateTitle">{{ lateLabel }}</span>
    </div>

    <!-- 建立 -->
    <div class="row">
      <div class="label"><span class="glyph">◷</span><span>建立</span></div>
      <div class="pill-static mono">{{ createdLabel }}</div>
    </div>

    <!-- 完成日 -->
    <div class="row">
      <div class="label"><span class="glyph">✓</span><span>完成日</span></div>
      <div
        class="pill pill-plain mono"
        role="button"
        @click="openIssueDatePicker($event, task.id, 'done', task.done, 'task')"
      >
        <span class="pill-text">{{ donePill }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 優先度 -->
    <div class="row">
      <div class="label"><span class="glyph">⚑</span><span>優先度</span></div>
      <div
        class="pill pill-prio"
        :style="{ background: pr.color }"
        role="button"
        @click="openOptionMenu($event, task.id, 'priority')"
      >
        <span class="pill-text">{{ pr.label }}</span
        ><span class="pill-caret on-solid">▼</span>
      </div>
    </div>

    <!-- 執行狀態 -->
    <div class="row">
      <div class="label"><span class="glyph">▶</span><span>執行狀態</span></div>
      <div
        class="pill pill-status"
        :style="{
          color: st.bar,
          background: `color-mix(in srgb, ${st.bar} 12%, transparent)`,
        }"
        role="button"
        @click="openOptionMenu($event, task.id, 'status')"
      >
        <span class="status-dot" :style="{ background: st.bar }"></span>
        <span class="pill-text">{{ st.label }}</span
        ><span class="pill-caret on-tint">▼</span>
      </div>
      <div v-if="late" class="late-chip" :title="lateTitle">
        <span class="late-dot"></span><span>{{ DELAYED.label }}</span>
      </div>
    </div>

    <!-- 相依 -->
    <div class="row row-top">
      <div class="label label-top"><span class="glyph">⇄</span><span>相依</span></div>
      <div class="dep-col">
        <div class="dep-line">前置：{{ predLabel }}</div>
        <div class="dep-line">後續：{{ succLabel }}</div>
        <div
          v-if="ui.canEdit"
          class="dep-edit-link"
          role="button"
          @click.stop="ui.openDepEditor(task.id)"
        >
          編輯相依關係
        </div>
      </div>
    </div>

    <!-- Issue 清單 -->
    <div v-if="issues.length" class="issue-block">
      <div class="issue-head">
        <span class="glyph">◈</span><span>Issue</span>
        <span class="issue-count mono">{{ issues.length }}</span>
      </div>
      <div
        v-for="i in issues"
        :key="i.id"
        class="detail-issue-row"
        role="button"
        title="開啟 Issue 詳細資料"
        @click.stop="openIssue(i.id)"
      >
        <!-- 圓點色在 constants 的 ISSUE_STATUS.dot（legacy :3042；review m2） -->
        <span class="issue-dot" :style="{ background: ISSUE_STATUS[i.status].dot }"></span>
        <span class="issue-title" :title="i.title">{{ i.title }}</span>
        <span class="issue-level" :style="{ background: ISSUE_LEVEL[i.level].color }">
          {{ i.level }}
        </span>
        <span v-if="isLateIssue(i, clock.todayIdx)" class="issue-late">{{ DELAYED.label }}</span>
        <span
          class="issue-status"
          :style="{
            color: ISSUE_STATUS[i.status].fg,
            background: ISSUE_STATUS[i.status].bg,
            borderColor: ISSUE_STATUS[i.status].bd,
          }"
          role="button"
          @click="openOptionMenu($event, i.id, 'istatus')"
        >
          <span>{{ ISSUE_STATUS[i.status].label }}</span
          ><span class="issue-caret">▼</span>
        </span>
        <span class="issue-open">⤢</span>
      </div>
    </div>

    <div v-if="ui.canEdit" class="foot">
      <div class="add-issue" role="button" @click.stop="addIssue()">＋ 開立 Issue</div>
      <div class="foot-gap"></div>
      <div class="delete-task" role="button" @click.stop="askDelete()">刪除</div>
    </div>
  </div>
</template>

<style scoped>
.props {
  display: flex;
  flex-direction: column;
  gap: var(--r-2);
}

.row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: var(--sp-1) 0;
  min-width: 0;
}

.row-top {
  align-items: flex-start;
}

.label {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  font-size: var(--fs-date);
  color: var(--text-placeholder);
  flex: 0 0 66px;
  width: 66px;
  white-space: nowrap;
}

.label-top {
  line-height: 1.55;
  min-height: 19px;
}

.glyph {
  font-size: var(--fs-micro);
}

/* ---------- 負責人 ---------- */

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  align-items: center;
  min-height: 22px;
  flex: 1;
  min-width: 0;
}

.chip {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-date);
  padding: var(--r-2) var(--sp-2) var(--r-2) var(--sp-1);
  border-radius: var(--r-pill);
  background: var(--surface-3);
  color: var(--text-2);
}

.chip-x {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--border-1);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-weekday);
  line-height: 1;
  cursor: pointer;
}

.chip-add {
  height: var(--sp-10);
  padding: 0 7px;
  border-radius: var(--r-pill);
  color: var(--text-placeholder);
  display: flex;
  align-items: center;
  font-size: var(--fs-date);
  cursor: pointer;
}

.chip-add:hover {
  background: var(--surface-3);
  color: var(--text-3);
}

.picker-wrap {
  display: grid;
  transition: grid-template-rows var(--t-base) var(--ease);
}

.picker-clip {
  overflow: hidden;
  min-height: 0;
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  padding: 7px;
  margin: var(--r-2) 0 var(--sp-2) 73px;
  border: 1px solid var(--border-1);
  border-radius: var(--r-input);
  background: var(--surface-2);
}

.picker-chip {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  font-size: var(--fs-date);
  padding: var(--r-2) var(--sp-4) var(--r-2) var(--sp-1);
  border-radius: var(--r-pill);
  border: 1px solid var(--border-1);
  background: var(--surface-1);
  color: var(--text-3);
  cursor: pointer;
}

.picker-chip:hover {
  border-color: var(--text-placeholder);
  color: var(--text-1);
}

/* ---------- 各種膠囊 ---------- */

.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  padding: var(--sp-1) 11px;
  border-radius: var(--r-pill);
  cursor: pointer;
  overflow: hidden;
  transition:
    filter var(--t-fast) ease,
    box-shadow var(--t-fast) ease;
}

.pill:hover {
  filter: var(--hover-dim);
  box-shadow: var(--ring-node);
}

/* 唯讀（F2）：膠囊與 Issue 列上的狀態只是顯示，拿掉可以點的提示（列上的狀態點了等於點那一列：開 Issue） */
.readonly .pill {
  cursor: default;
}

.readonly .issue-status {
  cursor: inherit;
}

.readonly .pill:hover {
  filter: none;
  box-shadow: none;
}

.readonly .issue-status:hover {
  filter: none;
}

.readonly .pill-caret,
.readonly .issue-caret {
  display: none;
}

.pill-plain {
  font-size: var(--fs-date);
  color: var(--text-2);
  background: var(--surface-3);
}

.pill-prio {
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  color: var(--surface-1);
}

.pill-status {
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
}

.pill-text {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-caret {
  font-size: var(--fs-caret);
  color: var(--text-placeholder);
  flex: 0 0 auto;
}

.pill-caret.on-solid {
  color: rgba(255, 255, 255, 0.8);
}

.pill-caret.on-tint {
  color: inherit;
  opacity: 0.65;
}

.mono {
  font-family: var(--font-mono);
}

.pill-static {
  font-size: var(--fs-date);
  color: var(--text-3);
  background: var(--surface-2);
  border: 1px solid var(--bg-page);
  padding: var(--sp-1) 11px;
  border-radius: var(--r-pill);
  width: fit-content;
  white-space: nowrap;
}

/* 計畫基準：靜態膠囊裡放鎖頭與起訖；欄寬不夠時截斷文字（全文在 title），不把列撐破 */
.baseline {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

/* 鎖頭跟著文字色（--text-3），線條圖示、不填色 */
.lock-icon {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
}

/* 晚幾個工作天：延遲的看得見說明，文字色用 --danger-text（spec〈設計方向〉），跟執行狀態列的 late-chip 同字級 */
.late-days {
  flex: 0 0 auto;
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  color: var(--danger-text);
  white-space: nowrap;
}

.status-dot {
  width: var(--sp-3);
  height: var(--sp-3);
  flex: 0 0 var(--sp-3);
  border-radius: 50%;
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

/* ---------- 相依 ---------- */

.dep-col {
  display: flex;
  flex-direction: column;
  gap: var(--r-2);
  min-width: 0;
  flex: 1;
}

.dep-line {
  font-size: var(--fs-date);
  color: var(--text-3);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.dep-edit-link {
  font-size: var(--fs-date);
  color: var(--accent);
  cursor: pointer;
  padding: 1px var(--sp-2);
  border-radius: var(--r-badge);
  width: fit-content;
}

.dep-edit-link:hover {
  background: var(--accent-tint-1);
}

/* ---------- Issue 清單 ---------- */

.issue-block {
  margin-top: 13px;
  padding-top: var(--sp-6);
  border-top: 1px solid var(--border-hair);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.issue-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-date);
  color: var(--text-placeholder);
}

.issue-count {
  font-size: var(--fs-caption);
}

.detail-issue-row {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: 7px 9px;
  border: 1px solid var(--border-1);
  border-radius: var(--r-card-sm);
  background: var(--surface-2);
  cursor: pointer;
  transition:
    background var(--t-fast) ease,
    border-color var(--t-fast) ease,
    box-shadow var(--t-fast) ease;
}

.detail-issue-row:hover {
  background: var(--surface-1);
  border-color: var(--text-placeholder);
  box-shadow: var(--shadow-row-hover);
}

.issue-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
}

.issue-title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-meta);
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-level {
  font-size: var(--fs-micro);
  font-weight: var(--fw-bold);
  color: var(--surface-1);
  border-radius: var(--r-badge);
  padding: 1px var(--r-badge);
  flex: 0 0 auto;
}

.issue-late {
  font-size: var(--fs-micro);
  font-weight: var(--fw-bold);
  color: var(--danger);
  background: var(--danger-bg);
  border: 1px solid var(--danger-bd);
  border-radius: var(--r-pill);
  padding: 1px var(--sp-3);
  flex: 0 0 auto;
  white-space: nowrap;
}

.issue-status {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-caption);
  font-weight: var(--fw-bold);
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  padding: 1px 7px;
  flex: 0 0 auto;
  white-space: nowrap;
  cursor: pointer;
  transition: filter var(--t-fast) ease;
}

.issue-status:hover {
  filter: brightness(0.95);
}

.issue-caret {
  font-size: var(--fs-7);
  opacity: 0.6;
}

.issue-open {
  width: var(--sp-10);
  height: var(--sp-10);
  flex: 0 0 var(--sp-10);
  border-radius: var(--r-6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-meta);
  color: var(--text-muted);
  transition:
    background var(--t-fast) ease,
    color var(--t-fast) ease;
}

.detail-issue-row:hover .issue-open {
  background: var(--surface-3);
  color: var(--text-2);
}

/* ---------- 底部 ---------- */

.foot {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-top: 13px;
  padding-top: 11px;
  border-top: 1px solid var(--border-hair);
}

.foot-gap {
  flex: 1;
}

.add-issue {
  font-size: var(--fs-date);
  color: var(--text-3);
  cursor: pointer;
  padding: var(--sp-1) 7px;
  border-radius: var(--r-6);
}

.add-issue:hover {
  background: var(--surface-3);
  color: var(--text-1);
}

.delete-task {
  font-size: var(--fs-date);
  color: var(--danger);
  cursor: pointer;
  padding: var(--sp-1) 7px;
  border-radius: var(--r-6);
}

.delete-task:hover {
  background: var(--danger-bg);
}
</style>
