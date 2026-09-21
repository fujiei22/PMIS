<script setup lang="ts">
// Issue 看板上的一張卡：所屬任務、標題、等級、處理狀態、期限 / 解決日期、負責人，
// 以及 ▼ 展開後的編輯表單（基本資訊 / 測試環境 / 描述與對策）。
// legacy 對照：模板 :709-834，issueList :3125-3238。
import { computed, nextTick, ref, watch } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import Pill from '@/components/common/Pill.vue'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'
import { useDomRegistry, registerEl } from '@/composables/useDomRegistry'
import { useEditDraft, type EditDraft } from '@/composables/useEditDraft'
import { useMenus } from '@/composables/useMenus'
import { DELAYED, ISSUE_ITEM, ISSUE_LEVEL, ISSUE_STATUS } from '@/constants/dashboard'
import { initialOf } from '@/lib/color'
import { EMPTY_LABEL, fmtDate } from '@/lib/format'
import { isLateIssue } from '@/lib/schedule'
import { useClockStore } from '@/stores/clock'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Issue } from '@/types/models'

/** 卡片上最多並排幾個負責人頭像，其餘收成 +N。legacy :3136 */
const MAX_OWNERS = 2
/** 展開區的關閉動畫長度，與 legacy 的 hold() 一致（:1747）。 */
const EXPAND_HOLD_MS = 320

const props = defineProps<{ issue: Issue }>()

const registry = useDomRegistry()

const clock = useClockStore()
const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const memberStore = useMemberStore()
const selection = useSelectionStore()
const { openOptionMenu, openIssueDatePicker } = useMenus()

const overdue = computed(() => isLateIssue(props.issue, clock.todayIdx))
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

const taskName = computed(() => taskStore.taskById(props.issue.taskId)?.name ?? '（已刪除任務）')

const ownerIds = computed(() => props.issue.ownerIds ?? [])
const owners = computed(() =>
  ownerIds.value
    .slice(0, MAX_OWNERS)
    .map((id) => memberStore.byId(id))
    .filter((m) => !!m),
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

// ── 就地改名（legacy :3167-3175）───────────────────────────────────────────
const editing = computed(() => ui.editing?.kind === 'i' && ui.editing.id === props.issue.id)
const inputEl = ref<HTMLInputElement | null>(null)

watch(editing, async (v) => {
  if (!v) return
  await nextTick()
  const el = inputEl.value
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
})

function startEdit(e: MouseEvent): void {
  e.stopPropagation()
  ui.editing = { kind: 'i', id: props.issue.id }
}

/**
 * 每一鍵就寫進 store（legacy onChange 逐鍵觸發，:3176）；
 * api 由 `useEditDraft` 做 300ms debounce，離開編輯時 flush（契約 B-2）。
 */
const titleDraft = useEditDraft({
  get: () => props.issue.title,
  applyLocal: (v) => {
    issueStore.applyLocalPatch(props.issue.id, { title: v })
  },
  commit: (v) => issueStore.commitIssuePatch(props.issue.id, { title: v }),
})

function onRename(e: Event): void {
  titleDraft.onInput((e.target as HTMLInputElement).value)
}

/** Enter / Esc / blur 只結束編輯，不還原（legacy :3170-3175）；離開前先送出草稿。 */
function endEdit(): void {
  void titleDraft.flush()
  if (editing.value) ui.editing = null
}

function onEditKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  if (e.key === 'Escape') {
    void titleDraft.flush()
    ui.editing = null
  }
}

// ── 展開編輯表單（legacy expIssue :3222-3230）──────────────────────────────
const expanded = computed(() => !!ui.expandedIssues[props.issue.id])
const expandMounted = useDelayedUnmount(expanded, EXPAND_HOLD_MS)

function toggleExpand(): void {
  ui.expandedIssues[props.issue.id] = !expanded.value
}

const itemLabel = computed(() => (ISSUE_ITEM[props.issue.item] ?? ISSUE_ITEM.O).label)
const creator = computed(() => memberStore.byId(props.issue.creatorId))
const ownerAvatars = computed(() =>
  ownerIds.value
    .slice(0, 3)
    .map((id) => memberStore.byId(id))
    .filter((m) => !!m),
)
/** 負責人欄位摘要：沒人 / 一個人顯示名字 / 多人顯示人數。legacy :3155 */
const ownerPill = computed(() => {
  const ids = ownerIds.value
  if (!ids.length) return EMPTY_LABEL.unassigned
  if (ids.length === 1) return memberStore.byId(ids[0]!)?.name ?? EMPTY_LABEL.unassigned
  return `${ids.length} 位成員`
})
const duePill = computed(() => (props.issue.due ? fmtDate(props.issue.due) : EMPTY_LABEL.setDue))
const donePill = computed(() =>
  props.issue.done ? fmtDate(props.issue.done) : EMPTY_LABEL.notFilled,
)

/** 展開表單裡的純文字欄位。 */
const TEXT_FIELDS = ['ptype', 'pcb', 'bios', 'os', 'solvedBios', 'desc', 'solution'] as const
type TextField = (typeof TEXT_FIELDS)[number]

/**
 * 測試環境 / 描述欄位共用的逐鍵寫入。legacy :3186-3196。
 * 每個欄位一份草稿：本地即時、api debounce 300ms、離開欄位 flush（契約 B-2）。
 */
const fieldDrafts = Object.fromEntries(
  TEXT_FIELDS.map((field) => [
    field,
    useEditDraft({
      get: () => props.issue[field],
      applyLocal: (v) => {
        issueStore.applyLocalPatch(props.issue.id, { [field]: v } as Partial<Issue>)
      },
      commit: (v) => issueStore.commitIssuePatch(props.issue.id, { [field]: v } as Partial<Issue>),
    }),
  ]),
) as Record<TextField, EditDraft>

function setField(field: TextField, e: Event): void {
  fieldDrafts[field].onInput((e.target as HTMLInputElement | HTMLTextAreaElement).value)
}

function flushField(field: TextField): void {
  void fieldDrafts[field].flush()
}

/** 刪除 Issue 走兩步確認。legacy `onDelete` :3237 */
function askDelete(): void {
  ui.confirm = { kind: 'issue', id: props.issue.id, step: 1 }
}

/** ⤢ 開 Issue 詳情（視窗本體由 S6 做）。legacy `onOpenDetail` :3199 */
function openDetail(): void {
  ui.openDetail(props.issue.id, 'issue')
}
</script>

<template>
  <div
    class="icard"
    :class="{ on, strong: strongSelected, rel, dimmed, overdue }"
    :ref="registerEl(registry.issueRows, issue.id)"
    :data-issuerow="issue.id"
    :data-selected="String(on)"
    :data-status="status"
    role="button"
    @click.stop="selection.selectIssue(issue.id)"
  >
    <div class="del" role="button" title="刪除 Issue" @click.stop="askDelete()">✕</div>
    <div class="task-name" :title="taskName">{{ taskName }}</div>

    <div class="title-row">
      <div v-if="!editing" class="title" @dblclick="startEdit">{{ issue.title }}</div>
      <input
        v-else
        ref="inputEl"
        class="title-input"
        :value="issue.title"
        @click.stop
        @input="onRename"
        @blur="endEdit"
        @keydown="onEditKey"
      />
      <div
        class="cls"
        :style="{ color: cl.text }"
        role="button"
        @click.stop="openOptionMenu($event, issue.id, 'ipri')"
      >
        <span class="cls-dot" :style="{ background: cl.color }"></span>
        <span>{{ cl.label }}</span>
      </div>
    </div>

    <div class="chips">
      <div
        class="st"
        :style="{ color: st.fg, background: `color-mix(in srgb, ${st.fg} 12%, transparent)` }"
        role="button"
        @click.stop="openOptionMenu($event, issue.id, 'istatus')"
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
      <Pill
        label="期限"
        caret
        clickable
        @click.stop="openIssueDatePicker($event, issue.id, 'due', issue.due)"
      >
        <span :class="{ overdue }">{{ dueLabel }}</span>
      </Pill>
      <Pill
        label="解決日期"
        caret
        clickable
        @click.stop="openIssueDatePicker($event, issue.id, 'done', issue.done)"
      >
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
      <div class="act" role="button" title="開啟詳細" @click.stop="openDetail()">⤢</div>
      <div class="act caret" role="button" @click.stop="toggleExpand()">
        {{ expanded ? '▲' : '▼' }}
      </div>
    </div>

    <!-- 展開編輯表單：grid-template-rows 0fr↔1fr 做高度動畫，關閉時延遲卸載（legacy :761-834） -->
    <div class="exp" :class="{ open: expanded }">
      <div class="exp-clip">
        <div v-if="expandMounted" class="exp-body" @click.stop>
          <section class="exp-card">
            <div class="exp-head">基本資訊</div>
            <div class="exp-grid">
              <div class="field">
                <span class="field-label">等級</span>
                <div
                  class="field-pill"
                  role="button"
                  @click.stop="openOptionMenu($event, issue.id, 'ipri')"
                >
                  <span class="field-dot" :style="{ background: cl.color }"></span>
                  <span class="field-value strong" :style="{ color: cl.text }">{{ cl.label }}</span>
                  <span class="field-caret">▼</span>
                </div>
              </div>
              <div class="field">
                <span class="field-label">Issue 類別</span>
                <div
                  class="field-pill"
                  role="button"
                  @click.stop="openOptionMenu($event, issue.id, 'iitem')"
                >
                  <span class="field-value">{{ itemLabel }}</span>
                  <span class="field-caret">▼</span>
                </div>
              </div>
              <div class="field">
                <span class="field-label">所屬任務</span>
                <div
                  class="field-pill"
                  :title="taskName"
                  role="button"
                  @click.stop="openOptionMenu($event, issue.id, 'itask')"
                >
                  <span class="field-value">{{ taskName }}</span>
                  <span class="field-caret">▼</span>
                </div>
              </div>
              <div class="field">
                <span class="field-label">建立者 Initiator</span>
                <div
                  class="field-pill avatar-pill"
                  role="button"
                  @click.stop="openOptionMenu($event, issue.id, 'icreator')"
                >
                  <span
                    class="field-avatar"
                    :style="{ background: creator?.color ?? 'var(--text-placeholder)' }"
                    >{{ initialOf(creator) }}</span
                  >
                  <span class="field-value">{{ creator?.name ?? EMPTY_LABEL.dash }}</span>
                  <span class="field-caret">▼</span>
                </div>
              </div>
              <div class="field">
                <span class="field-label">負責人 Owner</span>
                <div
                  class="field-pill avatar-pill"
                  role="button"
                  @click.stop="openOptionMenu($event, issue.id, 'iowner')"
                >
                  <span
                    v-for="m in ownerAvatars"
                    :key="m.id"
                    class="field-avatar stacked"
                    :style="{ background: m.color }"
                    >{{ initialOf(m) }}</span
                  >
                  <span class="field-value owner-name">{{ ownerPill }}</span>
                  <span class="field-caret">▼</span>
                </div>
              </div>
              <div class="field">
                <span class="field-label">建立日期</span>
                <div class="field-pill static mono">
                  <span class="field-value">{{ createdLabel }}</span>
                </div>
              </div>
              <div class="field">
                <span class="field-label">期限</span>
                <div
                  class="field-pill mono"
                  role="button"
                  @click.stop="openIssueDatePicker($event, issue.id, 'due', issue.due)"
                >
                  <span class="field-value">{{ duePill }}</span>
                  <span class="field-caret">▼</span>
                </div>
              </div>
              <div class="field">
                <span class="field-label">完成日期</span>
                <div
                  class="field-pill mono"
                  role="button"
                  @click.stop="openIssueDatePicker($event, issue.id, 'done', issue.done)"
                >
                  <span class="field-value">{{ donePill }}</span>
                  <span class="field-caret">▼</span>
                </div>
              </div>
            </div>
          </section>

          <section class="exp-card">
            <div class="exp-head">測試環境</div>
            <div class="exp-grid narrow">
              <label class="field">
                <span class="field-label">Issue 型態</span>
                <input
                  class="text-input"
                  :value="issue.ptype"
                  placeholder="I/O Function"
                  @input="setField('ptype', $event)"
                  @blur="flushField('ptype')"
                />
              </label>
              <label class="field">
                <span class="field-label">PCB</span>
                <input
                  class="text-input"
                  :value="issue.pcb"
                  placeholder="A0"
                  @input="setField('pcb', $event)"
                  @blur="flushField('pcb')"
                />
              </label>
              <label class="field">
                <span class="field-label">BIOS + EC Ver.</span>
                <input
                  class="text-input"
                  :value="issue.bios"
                  placeholder="06+0.03"
                  @input="setField('bios', $event)"
                  @blur="flushField('bios')"
                />
              </label>
              <label class="field">
                <span class="field-label">OS Ver.</span>
                <input
                  class="text-input"
                  :value="issue.os"
                  placeholder="Win11 24H2"
                  @input="setField('os', $event)"
                  @blur="flushField('os')"
                />
              </label>
              <label class="field">
                <span class="field-label">Solved BIOS</span>
                <input
                  class="text-input"
                  :value="issue.solvedBios"
                  placeholder="解決版本"
                  @input="setField('solvedBios', $event)"
                  @blur="flushField('solvedBios')"
                />
              </label>
            </div>
          </section>

          <section class="exp-card">
            <div class="exp-grid single">
              <label class="field">
                <span class="field-label">問題描述</span>
                <textarea
                  class="text-input area"
                  :value="issue.desc"
                  placeholder="重現步驟、環境條件與實際現象…"
                  @input="setField('desc', $event)"
                  @blur="flushField('desc')"
                ></textarea>
              </label>
              <label class="field">
                <span class="field-label">對策</span>
                <textarea
                  class="text-input area"
                  :value="issue.solution"
                  placeholder="處理方式、對策與驗證結果…"
                  @input="setField('solution', $event)"
                  @blur="flushField('solution')"
                ></textarea>
              </label>
            </div>
          </section>
        </div>
      </div>
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

.title-input {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-record);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  padding: var(--r-2) var(--sp-3);
  border-radius: var(--r-6);
  color: var(--text-1);
  font-family: inherit;
}

.title-input:focus {
  border-color: var(--accent);
  outline: none;
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

/* ── 展開表單 ───────────────────────────────────────────────────────────── */
.exp {
  display: grid;
  grid-template-rows: 0fr;
  margin-top: -7px;
  transition:
    grid-template-rows var(--t-layout) var(--ease),
    margin-top var(--t-layout) var(--ease);
}

.exp.open {
  grid-template-rows: 1fr;
  margin-top: 0;
}

.exp-clip {
  overflow: hidden;
  min-height: 0;
}

.exp-body {
  padding: var(--sp-5) 0 var(--r-2);
  margin-top: 9px;
  border-top: 1px dashed var(--border-1);
  display: flex;
  flex-direction: column;
  gap: 9px;
  cursor: default;
}

.exp-card {
  background: var(--surface-2);
  border: 1px solid var(--surface-group);
  border-radius: var(--r-card-sm);
  padding: var(--sp-5) 11px;
}

.exp-head {
  font-size: var(--fs-caption);
  font-weight: var(--fw-bold);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  margin-bottom: var(--sp-5);
}

.exp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 9px var(--sp-5);
}

.exp-grid.narrow {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.exp-grid.single {
  grid-template-columns: minmax(0, 1fr);
  gap: var(--sp-5);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.field-label {
  font-size: var(--fs-caption);
  color: var(--text-muted);
  font-weight: var(--fw-medium);
  letter-spacing: 0.01em;
}

.field-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--r-badge);
  background: var(--surface-3);
  color: var(--text-2);
  border-radius: var(--r-pill);
  padding: var(--sp-2) var(--sp-5);
  font-size: var(--fs-date);
  cursor: pointer;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
  transition:
    filter var(--t-fast) ease,
    box-shadow var(--t-fast) ease;
}

.field-pill:not(.static):hover {
  filter: var(--hover-dim);
  box-shadow: var(--ring-node);
}

.field-pill.avatar-pill {
  padding: var(--sp-1) var(--sp-5) var(--sp-1) var(--sp-2);
}

.field-pill.static {
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  color: var(--text-muted);
  cursor: default;
}

.field-pill.mono {
  font-family: var(--font-mono);
}

.field-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
}

.field-value {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.field-value.strong {
  font-weight: var(--fw-bold);
}

.owner-name {
  margin-left: 9px;
}

.field-caret {
  font-size: var(--fs-caret);
  color: var(--text-placeholder);
  flex: 0 0 auto;
  margin-left: auto;
}

.field-avatar {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  border-radius: 50%;
  color: var(--surface-1);
  font-size: var(--fs-micro);
  font-weight: var(--fw-bold);
  display: flex;
  align-items: center;
  justify-content: center;
}

.field-avatar.stacked {
  border: 1.5px solid var(--surface-1);
  margin-right: -7px;
}

.text-input {
  font-size: var(--fs-meta);
  color: var(--text-1);
  background-color: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-control);
  padding: var(--r-badge) 9px;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}

.text-input:hover {
  border-color: var(--text-placeholder);
}

/* 表單 focus 與 legacy 一致：藍框、無 outline（spec §設計方向 表單慣例） */
.text-input:focus {
  border-color: var(--accent);
  outline: none;
}

.text-input.area {
  padding: var(--sp-4) 9px;
  line-height: var(--lh-loose);
  border-radius: var(--r-input);
  min-height: 78px;
  resize: vertical;
}
</style>
