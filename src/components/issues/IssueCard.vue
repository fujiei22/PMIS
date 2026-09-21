<script setup lang="ts">
// Issue 看板上的一張卡：所屬任務、標題、等級、處理狀態、期限 / 解決日期、負責人。
// legacy 對照：模板 :709-760，issueList :3125-3238。展開編輯表單是 S4 的範圍。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import Pill from '@/components/common/Pill.vue'
import { DELAYED, ISSUE_LEVEL, ISSUE_STATUS } from '@/constants/dashboard'
import { EMPTY_LABEL, fmtDate } from '@/lib/format'
import { isLateIssue } from '@/lib/schedule'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Issue } from '@/types/models'

/** 卡片上最多並排幾個負責人頭像，其餘收成 +N。legacy :3136 */
const MAX_OWNERS = 2

const props = defineProps<{ issue: Issue }>()

const ui = useUiStore()
const taskStore = useTaskStore()
const memberStore = useMemberStore()
const selection = useSelectionStore()

const overdue = computed(() => isLateIssue(props.issue, ui.todayIdx))
const st = computed(() => ISSUE_STATUS[props.issue.status])
const cl = computed(() => ISSUE_LEVEL[props.issue.level] ?? ISSUE_LEVEL.C)
const status = computed(() => (overdue.value ? 'delayed' : props.issue.status))

/** 自己被選、或它的任務被選，都算選中（legacy `on` :3127）。 */
const on = computed(
  () =>
    selection.issueId === props.issue.id ||
    (!!selection.taskId && selection.taskId === props.issue.taskId),
)
const strongSelected = computed(() => selection.issueId === props.issue.id)
const rel = computed(
  () => !!selection.related[props.issue.taskId] || !!selection.softHighlight[props.issue.taskId],
)
const dimmed = computed(() => selection.hasSelection && !on.value && !rel.value)

const taskName = computed(
  () => taskStore.taskById(props.issue.taskId)?.name ?? '（已刪除任務）',
)

const ownerIds = computed(() => props.issue.ownerIds ?? [])
const owners = computed(() =>
  ownerIds.value.slice(0, MAX_OWNERS).map((id) => memberStore.byId(id)).filter((m) => !!m),
)
const moreOwners = computed(() => Math.max(0, ownerIds.value.length - MAX_OWNERS))
const moreOwnerNames = computed(() =>
  ownerIds.value
    .slice(MAX_OWNERS)
    .map((id) => memberStore.byId(id)?.name)
    .filter((n) => !!n)
    .join('、'),
)

const dueLabel = computed(() => (props.issue.due ? fmtDate(props.issue.due) : EMPTY_LABEL.dash))
const doneLabel = computed(() => (props.issue.done ? fmtDate(props.issue.done) : EMPTY_LABEL.dash))
const createdLabel = computed(() => fmtDate(props.issue.created || props.issue.due))
</script>

<template>
  <div
    class="icard"
    :class="{ on, strong: strongSelected, rel, dimmed, overdue }"
    :data-issuerow="issue.id"
    :data-selected="String(on)"
    :data-status="status"
    role="button"
    @click.stop="selection.selectIssue(issue.id)"
  >
    <div class="del" role="button" @click.stop>✕</div>
    <div class="task-name" :title="taskName">{{ taskName }}</div>

    <div class="title-row">
      <div class="title">{{ issue.title }}</div>
      <div class="cls" :style="{ color: cl.text }" role="button" @click.stop>
        <span class="cls-dot" :style="{ background: cl.color }"></span>
        <span>{{ cl.label }}</span>
      </div>
    </div>

    <div class="chips">
      <div
        class="st"
        :style="{ color: st.fg, background: `color-mix(in srgb, ${st.fg} 12%, transparent)` }"
        role="button"
        @click.stop
      >
        <span class="st-dot" :style="{ background: st.fg }"></span>
        <span>{{ st.label }}</span>
        <span class="st-caret">▼</span>
      </div>
      <div v-if="overdue" class="late-chip">
        <span class="late-dot"></span><span>{{ DELAYED.label }}</span>
      </div>
    </div>

    <div class="dates">
      <Pill label="期限" caret clickable>
        <span :class="{ overdue }">{{ dueLabel }}</span>
      </Pill>
      <Pill label="解決日期" caret clickable>
        <span :class="issue.done ? 'done-on' : 'done-off'">{{ doneLabel }}</span>
      </Pill>
    </div>

    <div class="foot">
      <div class="owners">
        <Avatar
          v-for="m in owners"
          :key="m.id"
          :member="m"
          :size="20"
          :ring="2"
          :overlap="6"
          expandable
        />
        <span v-if="moreOwners" class="more" :title="moreOwnerNames">+{{ moreOwners }}</span>
        <span v-if="!ownerIds.length" class="no-owner">{{ EMPTY_LABEL.unassigned }}</span>
      </div>
      <div class="foot-gap"></div>
      <div class="created" :title="`建立於 ${createdLabel}`">{{ createdLabel }}</div>
      <div class="act" role="button" title="開啟詳細" @click.stop>⤢</div>
      <div class="act caret">▼</div>
    </div>
  </div>
</template>

<style scoped>
.icard {
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

.icard:hover {
  border-color: var(--text-placeholder);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

.icard.overdue {
  background: var(--bg-late);
  border-color: var(--danger-bd);
}

/* 相關 → 選中 → 直接選這筆，樣式逐層加強（legacy :3205-3210） */
.icard.rel:not(.on) {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
}

.icard.on {
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  border-color: transparent;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}

.icard.strong {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: transparent;
  box-shadow:
    0 0 0 1px var(--accent),
    0 4px 12px color-mix(in srgb, var(--accent) 22%, transparent);
}

.icard.dimmed {
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

.task-name {
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
  cursor: text;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cls {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-caption);
  font-weight: var(--fw-bold);
  white-space: nowrap;
  cursor: pointer;
  padding: 1px var(--sp-2);
  border-radius: var(--r-badge);
  flex: 0 0 auto;
}

.cls:hover {
  background: var(--surface-3);
}

.cls-dot {
  width: var(--sp-3);
  height: var(--sp-3);
  border-radius: 50%;
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

.dates .overdue {
  color: var(--danger-text);
  font-weight: var(--fw-bold);
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

.owners {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  overflow: hidden;
  padding-right: var(--sp-4);
}

.owners:hover {
  overflow: visible;
  z-index: 8;
}

.more {
  flex: 0 0 auto;
  font-size: var(--fs-10);
  font-weight: var(--fw-bold);
  color: var(--text-3);
  background: var(--border-1);
  border-radius: var(--r-pill);
  padding: 1px var(--r-badge);
  margin-left: var(--sp-5);
  white-space: nowrap;
}

.no-owner {
  font-size: var(--fs-pill);
  color: var(--text-muted);
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

.act {
  width: 18px;
  height: var(--sp-10);
  flex: 0 0 18px;
  border-radius: var(--r-6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--fs-meta);
  cursor: pointer;
}

.act.caret {
  font-size: var(--fs-caption);
}

.act:hover {
  background: var(--surface-3);
  color: var(--text-2);
}
</style>
