<script setup lang="ts">
// 甘特左欄的任務列：把手、狀態點、任務名、起訖日期 + 工期、列尾的「⋮」（動作選單 RowActionMenu）。
// legacy 對照：模板 :442-466，groupRows[].tasks :2814-2877。
import { computed, nextTick, ref, watch } from 'vue'
import { useDomRegistry, registerEl } from '@/composables/useDomRegistry'
import { useEditDraft } from '@/composables/useEditDraft'
import { NARROW_QUERY, useMediaQuery } from '@/composables/useMediaQuery'
import { useMenus } from '@/composables/useMenus'
import { usePointerDragContext } from '@/composables/usePointerDrag'
import { DELAYED, TASK_STATUS } from '@/constants/dashboard'
import { lengthOf } from '@/lib/date'
import { parseDuration } from '@/lib/easing'
import { fmtDate, stripYear } from '@/lib/format'
import { isImeComposing } from '@/lib/keyboard'
import { isLate } from '@/lib/schedule'
import { useClockStore } from '@/stores/clock'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Task } from '@/types/models'

const props = defineProps<{ task: Task }>()

const clock = useClockStore()
const ui = useUiStore()
const selection = useSelectionStore()
const taskStore = useTaskStore()
const { openTaskDatePicker, toggleRowMenu } = useMenus()
const drag = usePointerDragContext()
const registry = useDomRegistry()

const late = computed(() => isLate(props.task, clock.todayIdx))
/** 延遲蓋掉原本的狀態，供 CSS 變數與測試使用（契約 E）。 */
const status = computed(() => (late.value ? 'delayed' : props.task.status))
const statusDot = computed(() => (late.value ? DELAYED.bar : TASK_STATUS[props.task.status].bar))

const selected = computed(() => selection.taskId === props.task.id)
/** 前置 / 後續；沒有相依但同屬選取分類（或 soft 篩選命中）時算 group。legacy :2908 */
const rel = computed<'up' | 'down' | 'group' | null>(
  () =>
    selection.related[props.task.id] ?? (selection.softHighlight[props.task.id] ? 'group' : null),
)
/** 有選取且自己不相關 → 淡化。legacy `rowOp` :2820 */
const dimmed = computed(() => selection.hasSelection && !selected.value && !rel.value)

const lifted = computed(() => ui.drag?.kind === 'reorder' && ui.drag.id === props.task.id)
const othersLifted = computed(() => ui.drag?.kind === 'reorder' && ui.drag.id !== props.task.id)
const dropOver = computed(() => ui.drag?.kind === 'reorder' && ui.drag.over?.id === props.task.id)

/**
 * 動作（工期 ±1 天、相依、刪除）收在列尾「⋮」開的選單；點列本身只標記（選取）。
 * legacy 是 hover 撐開快捷鈕、平板是選取就撐開，只想標記任務時很干擾（user 選的 L 稿提案 A）。
 * 開選單不選取任務：選取會捲動時間軸、淡化其他列，開個選單不該有這些副作用。
 */
const menuOpen = computed(() => ui.rowMenu?.id === props.task.id)
const narrow = useMediaQuery(NARROW_QUERY)
/**
 * 窄版左欄（平板直向、左欄沒展開）只有 250px，起訖日放不下：膠囊只寫工期，點了一樣開日期選擇器，
 * 後面的工期格就不重複顯示。左欄展開、寬度撐開之後（ui.ganttLeftDates）才照一般寫法。
 */
const slim = computed(() => narrow.value && !ui.ganttLeftDates)
const days = computed(() => lengthOf(props.task))
/** 窄版展開後的左欄（平板直向）省掉年份。legacy `rangeRow` :2825 */
const rangeText = computed(() => {
  if (slim.value) return `${days.value} 天`
  const a = fmtDate(props.task.start)
  const b = fmtDate(props.task.end)
  return narrow.value ? `${stripYear(a)} → ${stripYear(b)}` : `${a} → ${b}`
})
const rangeTitle = computed(() => `${fmtDate(props.task.start)} → ${fmtDate(props.task.end)}`)
/** 這一列正在開日期選擇器 → 日期膠囊亮起來。legacy `dateBd` :2844 */
const calOpen = computed(() => ui.taskDatePicker?.id === props.task.id)

/*
 * 窄版膠囊換寫法（只寫工期 ↔ 起訖日）的那一次：
 * - 新膠囊淡入（swap class）。原本 `.date` 常駐 animation，排序時被搬動 DOM 的列會重播、膠囊閃一下（動畫稽核 D10）；
 * - 寬度從舊膠囊補間到新膠囊，時長與曲線跟左欄寬度（--t-layout / --ease）一樣，
 *   左欄變寬多少、膠囊就同步吃掉多少，任務名寬度一路單調，不會在換寫法那一幀縮回去（D15）。
 */
const dateEl = ref<HTMLElement | null>(null)
const dateSwap = ref(false)
/** 換寫法前舊膠囊的寬度（DOM 更新前量）。 */
let swapFrom = 0

watch(
  slim,
  () => {
    swapFrom = dateEl.value?.getBoundingClientRect().width ?? 0
    if (narrow.value) dateSwap.value = true
  },
  { flush: 'pre' },
)

watch(
  slim,
  () => {
    const el = dateEl.value
    const from = swapFrom
    if (!el || !from || !narrow.value) return
    const to = el.getBoundingClientRect().width
    if (Math.abs(to - from) < 0.5) return
    const cs = getComputedStyle(document.documentElement)
    const timing = {
      duration: parseDuration(cs.getPropertyValue('--t-layout')),
      easing: cs.getPropertyValue('--ease').trim() || 'ease',
    }
    // 每一列都先量完（這一輪 post watcher），下一個 tick 才一起寫動畫，免得每一列都逼一次重排
    void nextTick(() => el.animate([{ width: `${from}px` }, { width: `${to}px` }], timing))
  },
  { flush: 'post' },
)

function onSelect(): void {
  selection.toggleTask(props.task.id)
}

/** 雙擊任務名進就地編輯。legacy `onEdit` :2876 */
const editing = computed(() => ui.editing?.kind === 't' && ui.editing.id === props.task.id)
const inputEl = ref<HTMLInputElement | null>(null)

watch(editing, async (on) => {
  if (!on) return
  await nextTick()
  const el = inputEl.value
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
})

function startEdit(e: MouseEvent): void {
  e.stopPropagation()
  ui.editing = { kind: 't', id: props.task.id }
}

/**
 * 每一鍵就寫進 store（legacy onChange 逐鍵觸發，:2882）；
 * api 由 `useEditDraft` 做 300ms debounce，離開編輯時 flush（契約 B-2）。
 */
const nameDraft = useEditDraft({
  get: () => props.task.name,
  applyLocal: (v) => {
    taskStore.applyLocalPatch(props.task.id, { name: v })
  },
  commit: (v) => taskStore.commitTaskPatch(props.task.id, { name: v }),
  editingId: () => props.task.id,
})

function onRename(e: Event): void {
  nameDraft.onInput((e.target as HTMLInputElement).value)
}

/** Enter / Esc / blur 只結束編輯，不還原（legacy :2878-2881）；離開前先把草稿送出去。 */
function endEdit(): void {
  void nameDraft.flush()
  if (editing.value) ui.editing = null
}

/** Enter 結束編輯、Esc 收框；輸入法選字的 Enter 是確定選字，不結束編輯。 */
function onEditKey(e: KeyboardEvent): void {
  if (isImeComposing(e)) return
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  if (e.key === 'Escape') {
    void nameDraft.flush()
    ui.editing = null
  }
}

/** 看板卡片拖到這一列 → 插在這個任務後面（或前面，由 moveTaskTo 依原順序決定）。legacy `onDrop` :2886 */
function onDrop(e: DragEvent): void {
  e.preventDefault()
  e.stopPropagation()
  const raw = e.dataTransfer?.getData('text/plain') ?? ''
  // 只接卡片；成員拖到列上 legacy 不處理
  if (!raw.startsWith('task:')) return
  taskStore.moveTaskTo(raw.slice(5), { kind: 't', id: props.task.id })
}
</script>

<template>
  <div
    class="task-row"
    :class="{
      selected,
      dimmed,
      lifted,
      'others-lifted': othersLifted,
      'drop-over': dropOver,
      'menu-open': menuOpen,
    }"
    :ref="registerEl(registry.rows, task.id)"
    :data-rowtask="task.id"
    :data-selected="String(selected)"
    :data-status="status"
    :data-rel="rel ?? ''"
    role="button"
    @click="onSelect"
    @dragover.prevent
    @drop="onDrop"
  >
    <div
      class="grip"
      :class="{ grabbing: lifted }"
      @click.stop
      @pointerdown="drag.startReorder($event, task.id)"
    >
      ⠿
    </div>
    <div class="st-dot" :style="{ background: statusDot }"></div>
    <div v-if="!editing" class="name" :title="task.name" @dblclick="startEdit">{{ task.name }}</div>
    <input
      v-else
      ref="inputEl"
      class="name-input"
      :value="task.name"
      @click.stop
      @input="onRename"
      @blur="endEdit"
      @keydown="onEditKey"
    />
    <!-- key：窄膠囊 ↔ 完整日期切換時重掛，窄版用淡入與寬度補間帶過（見 dateSwap） -->
    <div
      :key="slim ? 'slim' : 'full'"
      ref="dateEl"
      class="date"
      :class="{ open: calOpen, slim, swap: dateSwap }"
      @animationend.self="dateSwap = false"
    >
      <div
        class="date-range"
        :title="rangeTitle"
        role="button"
        @click.stop="openTaskDatePicker($event, task.id)"
      >
        <span class="date-text" :class="{ late }">{{ rangeText }}</span>
      </div>
      <template v-if="!slim">
        <span class="date-sep"></span>
        <div class="date-days" title="工期（天）" @click.stop>
          <span class="days-num">{{ days }}</span>
        </div>
      </template>
    </div>
    <span
      class="more"
      :class="{ open: menuOpen }"
      role="button"
      title="更多動作"
      aria-label="更多動作"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      :data-rowmore="task.id"
      @click.stop="toggleRowMenu($event, task.id)"
      >⋮</span
    >
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

/* 「⋮」選單開著的那一列：淡底標出選單是哪一列的，也不跟著其他列淡化 */
.task-row.menu-open {
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

.task-row.menu-open.dimmed {
  opacity: 1;
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
  /* 觸控拖曳排序：不宣告的話手指一動瀏覽器就當成捲動、送 pointercancel，拖曳被中止 */
  touch-action: none;
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

.name-input {
  font-size: var(--fs-record);
  color: var(--text-1);
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

/*
 * 列尾「⋮」：動作（工期 ±1 天、相依、刪除）都收在它開的選單（RowActionMenu）。
 * 一直顯示，直的只佔 16px：比 hover 才出現的橫「⋯」省空間，也不會在列尾空一格（user 要求）。
 */
.more {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--sp-8);
  height: var(--sp-12);
  margin-right: calc(-1 * var(--sp-2));
  border: 1px solid transparent;
  border-radius: var(--r-control);
  font-size: var(--fs-control);
  font-weight: var(--fw-bold);
  line-height: 1;
  color: var(--text-placeholder);
  cursor: pointer;
  transition:
    background var(--t-fast) ease,
    border-color var(--t-fast) ease,
    color var(--t-fast) ease;
}

.more.open {
  background: var(--surface-3);
  border-color: var(--border-control);
  color: var(--text-1);
}

@media (hover: hover) {
  .more:hover {
    background: var(--surface-3);
    color: var(--text-1);
  }
}

/* 窄版的膠囊只剩工期一段（後面沒有分隔線與工期格），左右內距對稱 */
.date.slim .date-range {
  padding-right: 7px;
}

/*
 * 平板直向展開 / 收合左欄時，膠囊換寫法的那一次淡入，不要一下子跳出來（只在換的那一次，見 dateSwap）。
 * 寬度補間途中新寫法比膠囊寬：橫向裁掉（clip 不影響直向，觸控加大的熱區照樣在）。
 */
@media (max-width: 899px) {
  .date {
    overflow-x: clip;
  }

  .date.swap {
    animation: fadeIn var(--t-base) var(--ease);
  }
}

/* 手指操作：「⋮」與排序把手加大到手指點得到 */
@media (pointer: coarse) {
  .grip {
    align-self: stretch;
    display: flex;
    align-items: center;
    padding: 0 var(--sp-3);
    margin-left: calc(-1 * var(--sp-3));
  }

  /* 「⋮」外觀只有 16px 寬：熱區上下撐滿整列、往右吃掉列尾內距，左邊不外擴（免得蓋到日期膠囊） */
  .more {
    position: relative;
  }

  .more::after {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--sp-2)) calc(-1 * var(--sp-4)) calc(-1 * var(--sp-2)) 0;
  }

  /* 日期膠囊只有 20px 高：熱區上下撐滿整列（34px），外觀不變 */
  .date-range {
    position: relative;
  }

  .date-range::after {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--sp-3)) 0;
  }
}
</style>
