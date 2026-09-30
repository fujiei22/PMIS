<script setup lang="ts">
// 甘特任務列「⋮」開的動作選單（全域只會有一個）：工期 −1天 / +1天、相依設定、刪除任務。
// 點任務列只標記（選取），動作一律從這裡來；hover / 選取不再撐開快捷鈕（user 選的 L 稿提案 A）。
// 位置由 ui.rowMenu 帶進來（useMenus.toggleRowMenu → lib/anchor 的 anchorRowMenu）。
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { dayIndex, isoFromIndex, lengthOf } from '@/lib/date'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const taskStore = useTaskStore()

const menu = computed(() => ui.rowMenu)
/** 任務在選單開著時被刪掉或篩掉，就不畫。 */
const task = computed(() => (menu.value ? taskStore.taskById(menu.value.id) : undefined))
const days = computed(() => (task.value ? lengthOf(task.value) : 0))

function close(): void {
  ui.rowMenu = null
}

/** 工期加一天；選單不關，可以連點。legacy `onDaysUp` :2846 */
function daysUp(): void {
  const t = task.value
  if (!t) return
  taskStore.updateTask(t.id, { end: isoFromIndex(dayIndex(t.end) + 1) })
}

/** 工期減一天；至少留一天。legacy `onDaysDown` :2847 */
function daysDown(): void {
  const t = task.value
  if (!t || dayIndex(t.end) <= dayIndex(t.start)) return
  taskStore.updateTask(t.id, { end: isoFromIndex(dayIndex(t.end) - 1) })
}

/** 開相依編輯器（本體在 DependencyEditor）。legacy `onOpenDeps` :2873 */
function openDeps(): void {
  if (task.value) ui.depEditFor = task.value.id
  close()
}

/** 刪除任務走兩步確認。legacy `onAskDelete` :2891 */
function askDelete(): void {
  if (task.value) ui.confirm = { kind: 'task', id: task.value.id, step: 1 }
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
      class="row-menu"
      role="menu"
      :aria-label="`${task.name} 的動作`"
      :data-rowmenu="task.id"
      data-keep-selection
      :style="{ left: `${menu.left}px`, top: `${menu.top}px` }"
    >
      <div class="rm-title" :title="task.name">{{ task.name }}</div>
      <!-- 天數夾在 −1天 / +1天 中間，按了看得到結果；▲ ▼ 看不出是在調什麼 -->
      <div class="rm-stepper">
        <span class="rm-label">工期</span>
        <button type="button" class="rm-step" :disabled="days <= 1" @click="daysDown()">
          −1天
        </button>
        <span class="rm-days">{{ days }} 天</span>
        <button type="button" class="rm-step" @click="daysUp()">+1天</button>
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
