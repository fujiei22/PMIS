<script setup lang="ts">
// 甘特任務列「⋮」開的動作選單（全域只會有一個）：工期 −1 / +1（工作天）、相依設定、刪除任務。
// 工期以有效工期加減，依排程規則停用並寫出原因（規則見 docs/reference/scheduling.md）；跟看板卡片的 ▲▼ 同一套。
// 點任務列只標記（選取），動作一律從這裡來；hover / 選取不再撐開快捷鈕（user 選的 L 稿提案 A）。
// 位置由 ui.rowMenu 帶進來（useMenus.toggleRowMenu → lib/anchor 的 anchorRowMenu）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCloseOnScroll } from '@/composables/useCloseOnScroll'
import { menuAnchors } from '@/composables/useMenus'
import { EDIT_BLOCK_TEXT, OVERDUE_SHRINK_TEXT } from '@/constants/dashboard'
import { fmtWorkdays, WORKDAY_UNIT } from '@/lib/format'
import { DURATION_MAX, durationBlock, durationOf, isOverdue } from '@/lib/schedule'
import { useClockStore } from '@/stores/clock'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import { useWorkCalendarStore } from '@/stores/workCalendar'

const ui = useUiStore()
const taskStore = useTaskStore()
const clock = useClockStore()
const calendar = useWorkCalendarStore()

const menu = computed(() => ui.rowMenu)
/** 任務在選單開著時被刪掉或篩掉，就不畫。 */
const task = computed(() => (menu.value ? taskStore.taskById(menu.value.id) : undefined))
/** 有效工期（工作天）：顯示與 −1 / +1 都以它為準（規則見 docs/reference/scheduling.md〈有效工期〉）。 */
const days = computed(() => (task.value ? durationOf(task.value, calendar.workdays) : 0))

/**
 * 停用的原因（看得見的一行＋按鈕的 title）：已完成兩顆都停（結束日就是完成日）；
 * 逾期只停 −1（結束日暫定今天，減了也不會提早）。到上下限不另外說明。
 */
const blockText = computed(() => {
  const t = task.value
  if (!t) return { both: '', down: '' }
  const block = durationBlock(t)
  if (block) return { both: EDIT_BLOCK_TEXT[block], down: '' }
  return {
    both: '',
    down: isOverdue(t, calendar.workdays, clock.todayIdx) ? OVERDUE_SHRINK_TEXT : '',
  }
})
const upDisabled = computed(() => !!blockText.value.both || days.value >= DURATION_MAX)
const downDisabled = computed(
  () => !!blockText.value.both || !!blockText.value.down || days.value <= 1,
)
/** 選單裡的說明行；沒有停用原因時不畫。 */
const note = computed(() => blockText.value.both || blockText.value.down)
const menuEl = ref<HTMLElement | null>(null)

function close(): void {
  ui.rowMenu = null
}

// 觸發的「⋮」被捲走就關（位置只在開啟時量一次）
useCloseOnScroll({ state: menu, popover: menuEl, anchor: () => menuAnchors.row, close })

/**
 * 工期加一個工作天：以有效工期為準送 `{ duration }`，結束日與下游由排程推算；選單不關，可以連點。
 * legacy `onDaysUp` :2846（legacy 是結束日加一個日曆天）
 */
function daysUp(): void {
  const t = task.value
  if (!t || upDisabled.value) return
  taskStore.updateTask(t.id, { duration: days.value + 1 })
}

/** 工期減一個工作天；停用時（已完成、逾期、只剩 1 工作天）不動作。legacy `onDaysDown` :2847 */
function daysDown(): void {
  const t = task.value
  if (!t || downDisabled.value) return
  taskStore.updateTask(t.id, { duration: days.value - 1 })
}

/** 開相依編輯器（本體在 DependencyEditor）。legacy `onOpenDeps` :2873 */
function openDeps(): void {
  if (task.value) ui.openDepEditor(task.value.id)
  close()
}

/** 刪除任務走兩步確認。legacy `onAskDelete` :2891 */
function askDelete(): void {
  if (task.value) ui.askDelete('task', task.value.id)
  close()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.rowMenu) close()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- 遮罩與選單都帶 data-keep-selection：點外面只關選單，不清掉任務的標記（OptionMenu 照 legacy 會一起清，這裡刻意不同） -->
  <div v-if="menu && task" class="rm-mask" data-keep-selection @click="close()"></div>
  <!-- 進出場用 base.css 的 pop；遮罩不包，關閉當下就放行點擊 -->
  <Transition name="pop">
    <div
      v-if="menu && task"
      ref="menuEl"
      class="row-menu"
      role="menu"
      :aria-label="`${task.name} 的動作`"
      :data-rowmenu="task.id"
      data-keep-selection
      :style="{ left: `${menu.left}px`, top: `${menu.top}px` }"
    >
      <div class="rm-title" :title="task.name">{{ task.name }}</div>
      <!-- 工作天數夾在 −1 / +1 中間，按了看得到結果；▲ ▼ 看不出是在調什麼。
           停用原因換行寫在下面（觸控看不到 title） -->
      <div class="rm-stepper" :title="`工期（${WORKDAY_UNIT}）`">
        <span class="rm-label">工期</span>
        <button
          type="button"
          class="rm-step"
          :disabled="downDisabled"
          :title="blockText.both || blockText.down || undefined"
          @click="daysDown()"
        >
          −1
        </button>
        <span class="rm-days">{{ fmtWorkdays(days) }}</span>
        <button
          type="button"
          class="rm-step"
          :disabled="upDisabled"
          :title="blockText.both || undefined"
          @click="daysUp()"
        >
          +1
        </button>
        <div v-if="note" class="rm-note">{{ note }}</div>
      </div>
      <button type="button" class="rm-item" role="menuitem" @click="openDeps()">
        <span class="rm-icon" aria-hidden="true">⇄</span>相依設定…
      </button>
      <button type="button" class="rm-item danger" role="menuitem" @click="askDelete()">
        <span class="rm-icon" aria-hidden="true">✕</span>刪除任務…
      </button>
    </div>
  </Transition>
</template>

<style scoped>
/* 疊層同 OptionMenu：遮罩 190、選單 200 */
.rm-mask {
  position: fixed;
  inset: 0;
  z-index: 190;
}

/* 寬度同 lib/anchor 的 ROW_MENU_W（220），定位算右緣對齊要用 */
.row-menu {
  position: fixed;
  z-index: 200;
  width: 220px;
  padding: var(--sp-2);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
}

.rm-title {
  padding: var(--sp-2) var(--sp-4) var(--sp-3);
  font-size: var(--fs-date);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rm-stepper {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-1) var(--sp-4) var(--sp-4);
  margin-bottom: var(--sp-2);
  border-bottom: 1px solid var(--border-hair);
}

.rm-label {
  flex: 1;
  font-size: var(--fs-meta);
  color: var(--text-2);
}

.rm-days {
  min-width: 40px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-meta);
  font-weight: var(--fw-medium);
  color: var(--text-1);
  text-align: center;
  white-space: nowrap;
}

.rm-step {
  height: 28px;
  padding: 0 var(--sp-4);
  border: 1px solid var(--border-control);
  border-radius: var(--r-control);
  background: var(--surface-1);
  font: inherit;
  font-size: var(--fs-meta);
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--t-fast) ease,
    border-color var(--t-fast) ease;
}

.rm-step:disabled {
  color: var(--glyph-disabled);
  cursor: default;
}

/* 停用原因：獨佔一行、換到 −1 / +1 下面（看得見的說明，觸控看不到 title） */
.rm-note {
  flex: 1 0 100%;
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--text-muted);
}

.rm-item {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  width: 100%;
  height: var(--dd-item-h);
  padding: 0 var(--sp-4);
  border: 0;
  border-radius: var(--r-control);
  background: transparent;
  font: inherit;
  font-size: var(--fs-meta);
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast) ease;
}

.rm-item.danger {
  color: var(--danger-text);
}

.rm-icon {
  width: var(--sp-8);
  flex: 0 0 var(--sp-8);
  text-align: center;
}

.rm-step:focus-visible,
.rm-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會黏著 */
@media (hover: hover) {
  .rm-step:not(:disabled):hover {
    background: var(--surface-3);
    border-color: var(--text-placeholder);
  }

  .rm-item:hover {
    background: var(--surface-3);
  }

  .rm-item.danger:hover {
    background: var(--danger-bg);
  }
}
</style>
