<script setup lang="ts">
// 詳細視窗左欄（Issue）：等級 / 分類 / 所屬任務 / 建立者 / 負責人 / 期限 / 完成日 / 建立 / 處理狀態
// ＋ 測試環境四欄與問題描述、對策、BIOS 解決版本。
// legacy 對照：模板 :1009-1092，issueDetail :3281-3346。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import { useEditDraft, type EditDraft } from '@/composables/useEditDraft'
import { useMenus } from '@/composables/useMenus'
import { DELAYED, ISSUE_ITEM, ISSUE_LEVEL, ISSUE_STATUS } from '@/constants/dashboard'
import { EMPTY_LABEL, fmtDate } from '@/lib/format'
import { isLateIssue } from '@/lib/schedule'
import { useClockStore } from '@/stores/clock'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useTaskStore } from '@/stores/task'
import type { Issue } from '@/types/models'

const props = defineProps<{ issue: Issue }>()

const clock = useClockStore()
const issueStore = useIssueStore()
const taskStore = useTaskStore()
const memberStore = useMemberStore()
const { openOptionMenu, openIssueDatePicker } = useMenus()

const cls = computed(() => ISSUE_LEVEL[props.issue.level])
const ist = computed(() => ISSUE_STATUS[props.issue.status])
const late = computed(() => isLateIssue(props.issue, clock.todayIdx))

const itemLabel = computed(() => ISSUE_ITEM[props.issue.item ?? 'O'].label)
const taskName = computed(() => taskStore.taskById(props.issue.taskId)?.name ?? '（未指定）')
const creator = computed(() => memberStore.byId(props.issue.creatorId))
const creatorName = computed(() => creator.value?.name ?? EMPTY_LABEL.dash)

/** 負責人最多疊三顆頭像，旁邊寫人數。legacy `ownerAvatars` / `ownerPill` :3299 */
const owners = computed(() => props.issue.ownerIds ?? [])
const ownerAvatars = computed(() => owners.value.slice(0, 3).map((id) => memberStore.byId(id)))
const ownerPill = computed(() => {
  if (!owners.value.length) return EMPTY_LABEL.unassigned
  if (owners.value.length === 1)
    return memberStore.byId(owners.value[0]!)?.name ?? EMPTY_LABEL.unassigned
  return `${owners.value.length} 位成員`
})

const duePill = computed(() => (props.issue.due ? fmtDate(props.issue.due) : EMPTY_LABEL.setDue))
const donePill = computed(() =>
  props.issue.done ? fmtDate(props.issue.done) : EMPTY_LABEL.notFilled,
)
const createdLabel = computed(() => fmtDate(props.issue.created))

/** 這一欄的純文字欄位（沿用 legacy React onChange 的即時行為 :3334）。 */
const TEXT_FIELDS = ['pcb', 'bios', 'os', 'ptype', 'desc', 'solution', 'solvedBios'] as const
type TextField = (typeof TEXT_FIELDS)[number]

/**
 * 每個欄位一份草稿：本地即時、api debounce 300ms、離開欄位 flush（契約 B-2）。
 * 逐鍵打 api 在接上真後端之後會變成每打一個字一個請求。
 */
const drafts = Object.fromEntries(
  TEXT_FIELDS.map((field) => [
    field,
    useEditDraft({
      get: () => props.issue[field],
      applyLocal: (v) => {
        issueStore.applyLocalPatch(props.issue.id, { [field]: v } as Partial<Issue>)
      },
      commit: (v) => issueStore.commitIssuePatch(props.issue.id, { [field]: v } as Partial<Issue>),
      // review F7：這些欄位不擁有 ui.editing（詳情標題才是），失敗時不清它
      editingId: () => null,
    }),
  ]),
) as Record<TextField, EditDraft>

function onField(field: TextField, e: Event): void {
  drafts[field].onInput((e.target as HTMLInputElement | HTMLTextAreaElement).value)
}

function flushField(field: TextField): void {
  void drafts[field].flush()
}

/**
 * 刪 Issue。legacy 這條路徑不走兩步確認、直接刪（:3341）——
 * 與 Issue 卡片上的 ✕（走 ui.confirm）刻意不同，這裡照 legacy 行為保留。
 * removeIssue 會順手清掉 ui.detail，視窗照正常關閉動畫收掉。
 */
function removeIssue(): void {
  issueStore.removeIssue(props.issue.id)
}
</script>

<template>
  <div class="props issue-props">
    <!-- 等級 -->
    <div class="row">
      <div class="label"><span class="glyph">⚑</span><span>等級 Class</span></div>
      <div
        class="pill pill-plain"
        role="button"
        @click.stop="openOptionMenu($event, issue.id, 'ipri')"
      >
        <span class="level-dot" :style="{ background: cls.color }"></span>
        <span class="pill-text bold" :style="{ color: cls.text }">{{ cls.label }}</span>
        <span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 分類 -->
    <div class="row">
      <div class="label"><span class="glyph">▤</span><span>分類 Item</span></div>
      <div
        class="pill pill-plain"
        role="button"
        @click.stop="openOptionMenu($event, issue.id, 'iitem')"
      >
        <span class="pill-text">{{ itemLabel }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 所屬任務 -->
    <div class="row">
      <div class="label"><span class="glyph">◈</span><span>所屬任務</span></div>
      <div
        class="pill pill-plain"
        :title="taskName"
        role="button"
        @click.stop="openOptionMenu($event, issue.id, 'itask')"
      >
        <span class="pill-text">{{ taskName }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 建立者 -->
    <div class="row">
      <div class="label"><span class="glyph">◍</span><span>建立者</span></div>
      <div
        class="pill pill-plain pill-avatar"
        role="button"
        @click.stop="openOptionMenu($event, issue.id, 'icreator')"
      >
        <Avatar :member="creator" :size="18" />
        <span class="pill-text">{{ creatorName }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 負責人 -->
    <div class="row">
      <div class="label"><span class="glyph">◎</span><span>負責人</span></div>
      <div
        class="pill pill-plain pill-avatar"
        role="button"
        @click.stop="openOptionMenu($event, issue.id, 'iowner')"
      >
        <Avatar
          v-for="(m, i) in ownerAvatars"
          :key="m?.id ?? i"
          :member="m"
          :size="18"
          :ring="1.5"
          :overlap="7"
        />
        <span class="pill-text owner-name">{{ ownerPill }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 期限 -->
    <div class="row">
      <div class="label"><span class="glyph">▦</span><span>期限</span></div>
      <div
        class="pill pill-plain mono"
        role="button"
        @click.stop="openIssueDatePicker($event, issue.id, 'due', issue.due)"
      >
        <span class="pill-text">{{ duePill }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 完成日 -->
    <div class="row">
      <div class="label"><span class="glyph">✓</span><span>完成日</span></div>
      <div
        class="pill pill-plain mono"
        role="button"
        @click.stop="openIssueDatePicker($event, issue.id, 'done', issue.done)"
      >
        <span class="pill-text">{{ donePill }}</span
        ><span class="pill-caret">▼</span>
      </div>
    </div>

    <!-- 建立日期 -->
    <div class="row">
      <div class="label"><span class="glyph">◷</span><span>建立日期</span></div>
      <div class="pill-static mono">{{ createdLabel }}</div>
    </div>

    <!-- 處理狀態 -->
    <div class="row">
      <div class="label"><span class="glyph">▶</span><span>處理狀態</span></div>
      <div
        class="pill pill-status"
        :style="{
          color: ist.fg,
          background: `color-mix(in srgb, ${ist.fg} 12%, transparent)`,
        }"
        role="button"
        @click.stop="openOptionMenu($event, issue.id, 'istatus')"
      >
        <span class="status-dot" :style="{ background: ist.fg }"></span>
        <span class="pill-text">{{ ist.label }}</span
        ><span class="pill-caret on-tint">▼</span>
      </div>
      <div v-if="late" class="late-chip">
        <span class="late-dot"></span><span>{{ DELAYED.label }}</span>
      </div>
    </div>

    <!-- 測試環境 -->
    <div class="block">
      <div class="block-head"><span class="glyph">⚙</span><span>測試環境</span></div>
      <div class="env-grid">
        <label class="field">
          <span class="field-label">PCB</span>
          <input
            :value="issue.pcb"
            placeholder="A0"
            @click.stop
            @input="onField('pcb', $event)"
            @blur="flushField('pcb')"
          />
        </label>
        <label class="field">
          <span class="field-label">BIOS + EC Ver.</span>
          <input
            :value="issue.bios"
            placeholder="06+0.03"
            @click.stop
            @input="onField('bios', $event)"
            @blur="flushField('bios')"
          />
        </label>
        <label class="field">
          <span class="field-label">OS Ver.</span>
          <input
            :value="issue.os"
            placeholder="Win11 24H2"
            @click.stop
            @input="onField('os', $event)"
            @blur="flushField('os')"
          />
        </label>
        <label class="field">
          <span class="field-label">Problem Type</span>
          <input
            :value="issue.ptype"
            placeholder="I/O Function"
            @click.stop
            @input="onField('ptype', $event)"
            @blur="flushField('ptype')"
          />
        </label>
      </div>
    </div>

    <!-- 描述 / 對策 -->
    <div class="block block-text">
      <label class="field">
        <span class="field-title">問題描述</span>
        <textarea
          :value="issue.desc"
          placeholder="重現步驟、環境條件與實際現象…"
          @click.stop
          @input="onField('desc', $event)"
          @blur="flushField('desc')"
        ></textarea>
      </label>
      <label class="field">
        <span class="field-title">對策</span>
        <textarea
          :value="issue.solution"
          placeholder="處理方式、對策與驗證結果…"
          @click.stop
          @input="onField('solution', $event)"
          @blur="flushField('solution')"
        ></textarea>
      </label>
      <label class="field">
        <span class="field-title">BIOS 解決版本</span>
        <input
          :value="issue.solvedBios"
          placeholder="例如 06+0.05"
          @click.stop
          @input="onField('solvedBios', $event)"
          @blur="flushField('solvedBios')"
        />
      </label>
    </div>

    <div class="foot">
      <div class="foot-gap"></div>
      <div class="delete-issue" role="button" @click.stop="removeIssue()">刪除 Issue</div>
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

/* Issue 的欄位名比任務長，legacy 這裡是 82px（:1011） */
.label {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  font-size: var(--fs-date);
  color: var(--text-placeholder);
  flex: 0 0 82px;
  width: 82px;
  white-space: nowrap;
}

.glyph {
  font-size: var(--fs-micro);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--r-badge);
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  padding: var(--sp-1) var(--sp-5);
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

.pill-plain {
  font-size: var(--fs-date);
  color: var(--text-2);
  background: var(--surface-3);
}

/* 帶頭像的膠囊左邊要收緊（legacy :1032） */
.pill-avatar {
  padding-left: var(--sp-1);
}

.pill-status {
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  padding: var(--sp-1) 11px;
}

.pill-text {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-text.bold {
  font-weight: var(--fw-bold);
}

.owner-name {
  margin-left: 9px;
}

.pill-caret {
  font-size: var(--fs-caret);
  color: var(--text-placeholder);
  flex: 0 0 auto;
}

.pill-caret.on-tint {
  color: inherit;
  opacity: 0.6;
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

.level-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
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

/* ---------- 表單區塊 ---------- */

.block {
  margin-top: 13px;
  padding-top: var(--sp-6);
  border-top: 1px solid var(--border-hair);
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.block-text {
  gap: 11px;
}

.block-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-date);
  color: var(--text-placeholder);
}

.env-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.field-label {
  font-size: var(--fs-caption);
  color: var(--text-placeholder);
  font-weight: var(--fw-medium);
}

.field-title {
  font-size: var(--fs-date);
  color: var(--text-placeholder);
}

.field input {
  font-size: var(--fs-meta);
  color: var(--text-1);
  background: var(--surface-3);
  border: 1px solid transparent;
  border-radius: var(--r-control);
  padding: var(--sp-2) 7px;
  width: 100%;
  font-family: inherit;
}

.field textarea {
  font-size: 12.7px;
  line-height: var(--lh-loose);
  color: var(--text-1);
  background: var(--surface-2);
  border: 1px solid var(--border-1);
  border-radius: var(--r-input);
  padding: var(--sp-4);
  width: 100%;
  min-height: 86px;
  resize: vertical;
  font-family: inherit;
}

/* 表單 focus 與 legacy 一致：白底藍框、無 outline（:1072 / :1081） */
.field input:focus,
.field textarea:focus {
  background: var(--surface-1);
  border-color: var(--accent);
  outline: none;
}

.foot {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-top: var(--sp-7);
  padding-top: 11px;
  border-top: 1px solid var(--border-hair);
}

.foot-gap {
  flex: 1;
}

.delete-issue {
  font-size: var(--fs-date);
  color: var(--danger);
  cursor: pointer;
  padding: var(--sp-1) 7px;
  border-radius: var(--r-6);
}

.delete-issue:hover {
  background: var(--danger-bg);
}
</style>
