<script setup lang="ts">
// 詳細視窗右欄的工具列：留言 / 檔案頁籤、留言的日期與成員篩選、檔案的圖示 / 清單切換。
// legacy 對照：模板 :1098-1159，cCalCells :3356-3376、cDate / cMem :3833-3870。
import { computed, ref } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import { monthGrid, WEEK_LABELS, type CalendarCell } from '@/lib/calendar'
import { dayIndex, shiftMonth } from '@/lib/date'
import { fmtDate } from '@/lib/format'
import { useCommentStore } from '@/stores/comment'
import { useMemberStore } from '@/stores/member'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ targetId: string }>()

const ui = useUiStore()
const comment = useCommentStore()
const memberStore = useMemberStore()

const commentCount = computed(() => comment.forTarget(props.targetId).length)
const fileCount = computed(() => comment.filesForTarget(props.targetId).length)

function pickTab(tab: 'comments' | 'files'): void {
  comment.tab = tab
  ui.openDropdown = null
}

// ── 日期篩選（含小日曆）──────────────────────────────────────────────────────
/** 顯示中的月份與下一次要填哪一端，都只有這個元件用得到，留在元件內。 */
const calMonth = ref('')
const calTarget = ref<'d1' | 'd2'>('d1')

const dateActive = computed(() => !!(comment.dateFrom || comment.dateTo))
const dateLabel = computed(() =>
  dateActive.value
    ? `${comment.dateFrom ? fmtDate(comment.dateFrom) : '起始'} ～ ${comment.dateTo ? fmtDate(comment.dateTo) : '今天'}`
    : '全部時間',
)

const calTitle = computed(() => {
  const m = calMonth.value || ui.todayIso.slice(0, 7)
  return `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`
})

/** 開日期下拉時把月份定在已選起始日（沒選就今天）並回到填 d1。legacy `toggleCDateDD` :3834 */
function toggleDateDropdown(): void {
  calMonth.value = calMonth.value || (comment.dateFrom || ui.todayIso).slice(0, 7)
  calTarget.value = 'd1'
  ui.toggleDropdown('cdate')
}

/** 42 格由 `monthGrid` 產（契約 D）；這個日曆只疊「區間內」與「端點」。 */
type Cell = CalendarCell & { inRange: boolean; picked: boolean }

const cells = computed<Cell[]>(() => {
  const month = calMonth.value || ui.todayIso.slice(0, 7)
  const a = comment.dateFrom ? dayIndex(comment.dateFrom) : null
  const b = comment.dateTo ? dayIndex(comment.dateTo) : null
  const lo = a !== null && b !== null ? Math.min(a, b) : null
  const hi = a !== null && b !== null ? Math.max(a, b) : null
  return monthGrid(month, ui.todayIdx).map((c) => ({
    ...c,
    inRange: lo !== null && hi !== null && c.idx > lo && c.idx < hi,
    picked: c.idx === a || c.idx === b,
  }))
})

/** 點一天：交替填起始 / 結束。legacy :3371 */
function pickDay(c: Cell): void {
  if (calTarget.value === 'd1') {
    comment.dateFrom = c.iso
    calTarget.value = 'd2'
  } else {
    comment.dateTo = c.iso
    calTarget.value = 'd1'
  }
  calMonth.value = c.iso.slice(0, 7)
}

function shiftCal(n: number): void {
  calMonth.value = shiftMonth(calMonth.value || ui.todayIso.slice(0, 7), n)
}

/** 「全部時間」：清掉兩端並關下拉。legacy `cCalClear` :3854 */
function clearDate(): void {
  comment.dateFrom = ''
  comment.dateTo = ''
  ui.openDropdown = null
}

// ── 成員篩選 ────────────────────────────────────────────────────────────────
/** 只列在這個目標留過言的人。legacy `cMemOptions` :3863 */
const commenters = computed(() => {
  const ids = comment.commenterIds(props.targetId)
  return memberStore.members.filter((m) => ids.includes(m.id))
})

function toggleMember(id: string): void {
  comment.memberIds = comment.memberIds.includes(id)
    ? comment.memberIds.filter((x) => x !== id)
    : comment.memberIds.concat([id])
}
</script>

<template>
  <div class="activity-toolbar">
    <div class="tabs">
      <div class="tab tab-comments" :class="{ on: comment.tab === 'comments' }" role="button" @click="pickTab('comments')">
        留言 {{ commentCount }}
      </div>
      <div class="tab tab-files" :class="{ on: comment.tab === 'files' }" role="button" @click="pickTab('files')">
        檔案 {{ fileCount }}
      </div>
    </div>

    <div class="spacer"></div>

    <!-- 日期篩選 -->
    <div class="dd">
      <div
        class="dd-trigger cdate-trigger"
        :class="{ active: dateActive }"
        data-dd="1"
        role="button"
        @click="toggleDateDropdown()"
      >
        <span class="dd-glyph">▦</span><span>{{ dateLabel }}</span><span class="dd-caret">▼</span>
      </div>
      <div v-if="ui.openDropdown === 'cdate'" class="dd-menu cdate-menu" data-dd="1">
        <div class="cal-ends">
          <div
            class="cal-end"
            :class="{ aimed: calTarget === 'd1' }"
            role="button"
            @click="calTarget = 'd1'"
          >
            {{ comment.dateFrom ? fmtDate(comment.dateFrom) : '起始日' }}
          </div>
          <div
            class="cal-end"
            :class="{ aimed: calTarget === 'd2' }"
            role="button"
            @click="calTarget = 'd2'"
          >
            {{ comment.dateTo ? fmtDate(comment.dateTo) : '結束日' }}
          </div>
        </div>
        <div class="cal-bar">
          <div class="cal-title">{{ calTitle }}</div>
          <div class="cal-nav" role="button" @click="calMonth = ui.todayIso.slice(0, 7)">今天</div>
          <div class="cal-arrow" role="button" @click="shiftCal(-1)">‹</div>
          <div class="cal-arrow" role="button" @click="shiftCal(1)">›</div>
        </div>
        <div class="cal-grid">
          <div v-for="w in WEEK_LABELS" :key="w" class="cal-weekday">{{ w }}</div>
        </div>
        <div class="cal-grid">
          <div
            v-for="c in cells"
            :key="c.idx"
            class="cal-cell"
            :class="{ range: c.inRange, today: c.isToday, picked: c.picked }"
            role="button"
            @click="pickDay(c)"
          >
            {{ c.label }}
          </div>
        </div>
        <div class="cal-clear" :class="{ active: dateActive }" role="button" @click="clearDate()">
          全部時間
        </div>
      </div>
    </div>

    <!-- 成員篩選 -->
    <div class="dd">
      <div
        class="dd-trigger cmem-trigger"
        :class="{ active: comment.memberIds.length > 0 }"
        data-dd="1"
        role="button"
        @click="ui.toggleDropdown('cmem')"
      >
        <span class="dd-glyph">◍</span>
        <span>{{ comment.memberIds.length ? `成員 ${comment.memberIds.length}` : '全部成員' }}</span>
        <span class="dd-caret">▼</span>
      </div>
      <div v-if="ui.openDropdown === 'cmem'" class="dd-menu cmem-menu" data-dd="1">
        <div v-if="!commenters.length" class="dd-empty">尚無留言成員</div>
        <div
          v-for="m in commenters"
          :key="m.id"
          class="dd-item"
          :class="{ on: comment.memberIds.includes(m.id) }"
          role="button"
          @click="toggleMember(m.id)"
        >
          <Avatar :member="m" :size="19" />
          <span class="dd-item-label">{{ m.name }}</span>
          <span class="dd-check">{{ comment.memberIds.includes(m.id) ? '✓' : '' }}</span>
        </div>
      </div>
    </div>

    <!-- 檔案頁籤的檢視切換 -->
    <div v-if="comment.tab === 'files'" class="view-toggle">
      <div
        class="view view-icon"
        :class="{ on: comment.fileView === 'icon' }"
        role="button"
        title="圖示檢視"
        @click="comment.fileView = 'icon'"
      >
        ▦
      </div>
      <div
        class="view view-list"
        :class="{ on: comment.fileView === 'list' }"
        role="button"
        title="清單檢視"
        @click="comment.fileView = 'list'"
      >
        ☰
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-6) var(--sp-8);
  border-bottom: 1px solid var(--border-1);
  background: var(--surface-1);
  flex-wrap: wrap;
}

.tabs {
  display: flex;
  padding: var(--r-2);
  background: var(--surface-3);
  border-radius: var(--r-card-sm);
  flex: 0 0 auto;
}

.tab {
  padding: var(--sp-2) var(--sp-6);
  font-size: 12.7px;
  font-weight: var(--fw-bold);
  border-radius: var(--r-control);
  cursor: pointer;
  color: var(--text-muted);
  background: transparent;
}

.tab.on {
  color: var(--text-1);
  background: var(--surface-1);
}

.spacer {
  flex: 1;
}

.dd {
  position: relative;
  flex: 0 0 auto;
}

.dd-trigger {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 28px;
  padding: 0 var(--sp-5);
  font-size: var(--fs-meta);
  border: 1px solid var(--border-1);
  border-radius: var(--r-pill);
  color: var(--text-2);
  background: var(--surface-1);
  cursor: pointer;
  white-space: nowrap;
}

.dd-trigger.active {
  border-color: var(--accent);
  color: var(--accent-hover);
}

.dd-glyph {
  font-size: var(--fs-10);
  color: var(--text-placeholder);
}

.dd-caret {
  font-size: var(--fs-8-5);
  color: var(--text-placeholder);
}

.dd-menu {
  position: absolute;
  top: 31px;
  right: 0;
  z-index: 200;
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  animation: popIn var(--t-pop) ease-out;
}

.cdate-menu {
  width: 250px;
  padding: var(--sp-6);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-popover);
}

.cmem-menu {
  min-width: 178px;
  max-height: 280px;
  overflow: auto;
  padding: var(--sp-2);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
}

.dd-empty {
  padding: 7px 9px;
  font-size: 12.7px;
  color: var(--text-placeholder);
}

.dd-item {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: 30px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-control);
  font-size: 12.7px;
  color: var(--text-2);
  background: transparent;
  cursor: pointer;
}

.dd-item.on {
  color: var(--accent-hover);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.dd-item:hover {
  background: var(--surface-3);
}

.dd-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dd-check {
  font-size: var(--fs-caption);
  color: var(--accent);
}

/* ---------- 小日曆 ---------- */

.cal-ends {
  display: flex;
  gap: var(--sp-4);
  margin-bottom: var(--sp-6);
}

.cal-end {
  flex: 1;
  min-width: 0;
  padding: var(--sp-3) var(--sp-4);
  font-size: 12.7px;
  border: 1px solid var(--border-1);
  border-radius: var(--r-control);
  color: var(--text-muted);
  background: var(--surface-2);
  text-align: center;
  cursor: pointer;
  font-family: var(--font-mono);
}

.cal-end.aimed {
  border-color: var(--accent);
  color: var(--accent-hover);
}

.cal-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
}

.cal-title {
  font-size: 13.7px;
  font-weight: var(--fw-bold);
  color: var(--text-1);
  flex: 1;
}

.cal-nav {
  font-size: var(--fs-date);
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--sp-1) 7px;
  border-radius: var(--r-badge);
}

.cal-arrow {
  font-size: var(--fs-14);
  color: var(--text-muted);
  cursor: pointer;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-badge);
}

.cal-nav:hover,
.cal-arrow:hover {
  color: var(--text-1);
  background: var(--surface-3);
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--r-2);
}

.cal-weekday {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-date);
  color: var(--text-muted);
}

.cal-cell {
  height: 27px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12.7px;
  border-radius: var(--r-control);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font-family: var(--font-mono);
}

/* 覆蓋順序照 legacy 的三個 if（:3366-3368） */
.cal-cell.range {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent-hover);
}

.cal-cell.today {
  background: var(--today);
  color: var(--surface-1);
  font-weight: var(--fw-bold);
  border-radius: var(--r-day);
}

.cal-cell.picked {
  background: var(--accent);
  color: var(--surface-1);
  font-weight: var(--fw-bold);
  border-radius: var(--r-day);
}

.cal-clear {
  margin-top: 9px;
  padding-top: var(--sp-4);
  border-top: 1px solid var(--border-hair);
  font-size: var(--fs-meta);
  color: var(--glyph-disabled);
  cursor: pointer;
  text-align: center;
}

.cal-clear.active {
  color: var(--text-muted);
}

.cal-clear:hover {
  color: var(--danger-text);
}

/* ---------- 檢視切換 ---------- */

.view-toggle {
  display: flex;
  padding: var(--r-2);
  background: var(--surface-3);
  border-radius: var(--r-input);
  flex: 0 0 auto;
}

.view {
  width: 26px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-6);
  cursor: pointer;
  font-size: var(--fs-date);
  color: var(--text-placeholder);
  background: transparent;
}

.view.on {
  color: var(--text-1);
  background: var(--surface-1);
}
</style>
