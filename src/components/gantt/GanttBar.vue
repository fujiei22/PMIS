<script setup lang="ts">
// 甘特圖上的一條：一般任務條，或收合分類的摘要條。
// legacy 對照：模板 :502-513，bars :2887-2958。
//
// 契約 G：props 是 task / summary 的 discriminated union，fragment root
// （`.bar` 與兩個 `.dot-zone` 是兄弟，維持 legacy 的 DOM 結構），
// 樣式全部拆成回傳 primitive 的小 computed——一條 hover 不會讓別條重畫。
import { computed } from 'vue'
import { registerEl, useDomRegistry, type ElRef } from '@/composables/useDomRegistry'
import { usePointerDragContext } from '@/composables/usePointerDrag'
import { ROW_HEIGHT } from '@/constants/dashboard'
import { dayIndex, lengthOf } from '@/lib/date'
import { isLate } from '@/lib/schedule'
import { useClockStore } from '@/stores/clock'
import { useIssueStore } from '@/stores/issue'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Group, Task } from '@/types/models'

// 兩個分支各自把對方的欄位標成 `?: never`：一來型別上擋掉混搭，
// 二來 Vue 由型別產出的執行期 props 才不會把它們當成必填而在 console 叫。
const props = defineProps<
  | { kind: 'task'; task: Task; rowIndex: number; group?: never; a?: never; b?: never }
  /** 收合分類的摘要條：a / b 是底下任務的最早 / 最晚日索引（legacy :2891-2903）。 */
  | { kind: 'summary'; group: Group; rowIndex: number; a: number; b: number; task?: never }
>()

// fragment root 不能自動套外層屬性，關掉才不會有 Vue 警告
defineOptions({ inheritAttrs: false })

const clock = useClockStore()
const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const selection = useSelectionStore()
const drag = usePointerDragContext()
const registry = useDomRegistry()

/** 條的識別；摘要條是 `sum-<gid>`，點下去展開該分類（legacy :2894 / :2900）。 */
const id = computed(() => (props.kind === 'task' ? props.task.id : `sum-${props.group.id}`))

/** 左緣：日索引換算成 px。legacy :2896 / :2905 */
const left = computed(() => {
  const a = props.kind === 'task' ? dayIndex(props.task.start) : props.a
  return (a - taskStore.range.a) * ui.dayWidth
})

/** 寬度：工期天數 × 一天的寬。legacy :2898 / :2906 */
const w = computed(() =>
  props.kind === 'task'
    ? lengthOf(props.task) * ui.dayWidth
    : (props.b - props.a + 1) * ui.dayWidth,
)

/** 上緣：列高的倍數，摘要條比較矮所以往下多 6px。legacy :2897 / :2907 */
const top = computed(() => props.rowIndex * ROW_HEIGHT + (props.kind === 'task' ? 6 : 12))

/** 條色的來源；逾期蓋掉原本的狀態，摘要條沒有狀態。legacy :2909 */
const status = computed(() =>
  props.kind === 'task'
    ? isLate(props.task, clock.todayIdx)
      ? 'delayed'
      : props.task.status
    : undefined,
)

/** 選取中的那一條。legacy `on` :2908 */
const selected = computed(() => props.kind === 'task' && selection.taskId === props.task.id)

/** 光暈種類：前置 / 後續，沒有相依但同屬選取分類（或 soft 篩選命中）時算 group。legacy :2908 */
const ringKind = computed<'up' | 'down' | 'group' | null>(() => {
  if (props.kind !== 'task') return null
  return selection.related[props.task.id] ?? (selection.softHighlight[props.task.id] ? 'group' : null)
})

/** 有選取而自己不相關 → 淡化。legacy `op` :2910 */
const dimmed = computed(
  () => props.kind === 'task' && selection.hasSelection && !selected.value && !ringKind.value,
)

/**
 * 滑鼠停在自己身上（才要亮圓點）。legacy :2942-2948。
 * `selected` 放前面短路：沒被選取的條根本不會去讀 `hoverTaskId`，
 * 別條 hover 時這裡就不會被通知重算（契約 G）。
 */
const hovered = computed(() => selected.value && ui.hoverTaskId === id.value)

/** 正在拉相依線時的拖曳狀態；不是拉線就是 null。legacy `linking` :2912 */
const linkDrag = computed(() => (ui.drag?.kind === 'link' ? ui.drag : null))

/** 拉線時指標壓在自己這一列 → 圓點放大。legacy `dotScale` :2947 */
const near = computed(() => !!linkDrag.value && ui.nearTaskId === id.value)

/** 左側圓點：拉線時來源顯示自己那側、其他任務顯示接得上的那側；否則看 hover。legacy :2912-2913 */
const showL = computed(() => {
  const d = linkDrag.value
  if (!d) return hovered.value
  return d.id === id.value ? d.side === 'L' : near.value && d.side === 'R'
})

/** 右側圓點，規則與左側對稱。legacy :2912-2913 */
const showR = computed(() => {
  const d = linkDrag.value
  if (!d) return hovered.value
  return d.id === id.value ? d.side === 'R' : near.value && d.side === 'L'
})

/** 拖曳 / 縮放 / 縮放滑桿進行中就關掉位移補間，條才不會追著游標跑。legacy :2926 */
const still = computed(() => {
  if (ui.zooming) return true
  const d = ui.drag
  if (!d || props.kind !== 'task') return false
  return d.kind === 'pan' || ('id' in d && d.id === props.task.id)
})

/** 條上的文字；摘要條不放字。legacy `label` :2920 */
const label = computed(() => (props.kind === 'task' ? props.task.name : ''))

/** 未結案 Issue 數，>0 才畫紅色徽章。legacy `hasIssue` :2916 */
const issueOpen = computed(() => (props.kind === 'task' ? issueStore.openCount(props.task.id) : 0))

/** hover 提示；未選取時前面加一句「要先選取」。legacy `title` :2921-2924 */
const title = computed(() => {
  if (props.kind !== 'task') return `${props.group.name}（收合）`
  const t = props.task
  const rel = ringKind.value
  return (
    (selected.value ? '' : '點擊以選取後才能拖曳｜') +
    `${t.name}｜${t.start} → ${t.end}｜${lengthOf(t)} 天` +
    (rel ? `（${rel === 'up' ? '前置任務' : rel === 'down' ? '後續任務' : '同分類'}）` : '')
  )
})

/** 圓點熱區的位置：貼在條的左右外側。legacy `zoneL / zoneR / zoneY` :2929-2931 */
const zoneL = computed(() => left.value - 33)
const zoneR = computed(() => left.value + w.value + 2)
const zoneY = computed(() => props.rowIndex * ROW_HEIGHT - 3)

/** 兩顆圓點都到齊才登錄成一組（契約 F 的 `linkDots`）。 */
const dots: { L?: HTMLElement; R?: HTMLElement } = {}

function makeDotRef(side: 'L' | 'R'): (el: ElRef) => void {
  return (el: ElRef) => {
    if (el instanceof HTMLElement) dots[side] = el
    else delete dots[side]
    const { L, R } = dots
    if (L && R) registry.linkDots.set(id.value, { L, R })
    else registry.linkDots.delete(id.value)
  }
}

const setDotL = makeDotRef('L')
const setDotR = makeDotRef('R')

/** 點條：摘要條展開分類，一般條切換選取。legacy :2900 / :2915 */
function onClick(): void {
  if (props.kind === 'summary') ui.toggleGroup(props.group.id)
  else selection.toggleTask(props.task.id)
}

/**
 * 條本體按下去開始移動——但只有選取中的條可以拖。
 * 沒選取就不 stopPropagation，讓事件落到畫布去平移（legacy `onMove` :2951）。
 */
function onDown(e: PointerEvent): void {
  if (props.kind !== 'task' || !selected.value) return
  drag.startBar(e, props.task.id, 'move')
}

/** 成員拖到條上 → 指派給這個任務。legacy `onDrop` :2958 */
function onDrop(e: DragEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (props.kind !== 'task') return
  const raw = e.dataTransfer?.getData('text/plain') ?? ''
  // 只接成員；卡片拖曳（`task:` 前綴）落在條上不做事（legacy :2958）
  if (!raw || raw.startsWith('task:')) return
  taskStore.assign(props.task.id, raw.split(',').filter(Boolean))
}
</script>

<template>
  <div
    :ref="registerEl(registry.bars, id)"
    class="bar"
    :class="{
      summary: kind === 'summary',
      selected,
      [`rel-${ringKind}`]: !!ringKind,
      dimmed,
      still,
    }"
    :data-taskid="id"
    :data-status="status"
    :title="title"
    :style="{ left: `${left}px`, top: `${top}px`, width: `${w}px` }"
    role="button"
    @click.stop="onClick()"
    @pointerdown="onDown($event)"
    @pointerenter="drag.setHover(id)"
    @pointerleave="drag.clearHover(id)"
    @dragover.prevent
    @drop="onDrop($event)"
  >
    <template v-if="kind === 'task'">
      <div
        class="handle handle-l"
        :class="{ live: selected }"
        @pointerdown="drag.startBar($event, id, 'resL')"
      ></div>
      <div v-if="issueOpen" class="issue-badge">
        <span>!</span><span>{{ issueOpen }}</span>
      </div>
      <div class="bar-label" :class="{ 'has-badge': issueOpen }">{{ label }}</div>
      <div
        class="handle handle-r"
        :class="{ live: selected }"
        @pointerdown="drag.startBar($event, id, 'resR')"
      ></div>
    </template>
  </div>

  <template v-if="kind === 'task'">
    <div
      :ref="setDotL"
      class="dot-zone zone-l"
      :class="{ shown: showL }"
      :data-linkfor="id"
      :style="{ left: `${zoneL}px`, top: `${zoneY}px` }"
      @pointerdown="drag.startLink($event, id, 'L')"
      @pointerenter="drag.setHover(id)"
      @pointerleave="drag.clearHover(id)"
    >
      <div class="dot" :class="{ near }"></div>
    </div>
    <div
      :ref="setDotR"
      class="dot-zone zone-r"
      :class="{ shown: showR }"
      :data-linkfor="id"
      :style="{ left: `${zoneR}px`, top: `${zoneY}px` }"
      @pointerdown="drag.startLink($event, id, 'R')"
      @pointerenter="drag.setHover(id)"
      @pointerleave="drag.clearHover(id)"
    >
      <div class="dot" :class="{ near }"></div>
    </div>
  </template>
</template>

<style scoped>
/* 依狀態決定條色；契約 F：data-status → --bar，再由 color-mix 組出光暈 */
.bar[data-status='todo'] {
  --bar: var(--st-todo-bar);
}
.bar[data-status='doing'] {
  --bar: var(--st-doing-bar);
}
.bar[data-status='paused'] {
  --bar: var(--st-paused-bar);
}
.bar[data-status='done'] {
  --bar: var(--st-done-bar);
}
.bar[data-status='delayed'] {
  --bar: var(--st-delayed-bar);
}

.bar {
  position: absolute;
  height: 22px;
  border-radius: var(--r-6);
  background: var(--bar);
  box-shadow: var(--shadow-bar);
  opacity: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 0 7px;
  gap: var(--r-badge);
  overflow: hidden;
  z-index: 12;
  transition:
    left var(--t-bar) var(--ease),
    top var(--t-bar) var(--ease),
    width var(--t-bar) var(--ease),
    background var(--t-base) ease,
    box-shadow var(--t-fast) ease,
    opacity var(--t-fast) ease;
}

/* 拖曳 / 縮放中不要補間位移，不然條會追著游標跑（legacy :2926） */
.bar.still {
  transition:
    box-shadow var(--t-fast) ease,
    opacity var(--t-fast) ease;
}

.bar.summary {
  height: 10px;
  border-radius: var(--r-3);
  background: var(--text-3);
  box-shadow: none;
  z-index: 10;
}

.bar.rel-up,
.bar.rel-down,
.bar.rel-group {
  z-index: 16;
}

.bar.selected {
  cursor: grab;
  z-index: 18;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--bar) 55%, transparent),
    0 0 6px 1.5px color-mix(in srgb, var(--bar) 50%, transparent),
    0 0 12px 4px color-mix(in srgb, var(--bar) 20%, transparent);
}

.bar.rel-up:not(.selected) {
  box-shadow:
    0 0 5px 1px color-mix(in srgb, var(--bar) 42%, transparent),
    0 0 10px 3px color-mix(in srgb, var(--bar) 16%, transparent);
}

.bar.rel-down:not(.selected) {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--bar) 32%, transparent),
    0 0 6px 1.5px color-mix(in srgb, var(--bar) 26%, transparent);
}

.bar.rel-group:not(.selected) {
  box-shadow: 0 0 5px 1px color-mix(in srgb, var(--bar) 16%, transparent);
}

.bar.dimmed {
  opacity: 0.32;
}

/* 未選取時把手不吃事件，逼使用者先點選（legacy handlePE :2949） */
.handle {
  position: absolute;
  top: 0;
  width: var(--sp-5);
  height: 100%;
  cursor: ew-resize;
  pointer-events: none;
}

.handle.live {
  pointer-events: auto;
}

.handle-l {
  left: 0;
}

.handle-r {
  right: 0;
}

.issue-badge {
  display: flex;
  align-items: center;
  gap: var(--r-2);
  flex: 0 0 auto;
  height: 15px;
  padding: 0 var(--r-badge);
  border-radius: var(--r-pill);
  background: var(--scrim-on-bar);
  color: var(--danger-text);
  font-size: var(--fs-10-2);
  font-weight: var(--fw-bold);
  pointer-events: none;
  margin-left: var(--r-2);
}

.bar-label {
  font-size: var(--fs-date);
  color: var(--surface-1);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  padding-left: var(--sp-3);
  min-width: 0;
}

.bar-label.has-badge {
  padding-left: 0;
}

.dot-zone {
  position: absolute;
  width: 32px;
  height: 40px;
  display: flex;
  align-items: center;
  cursor: crosshair;
  z-index: 20;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.dot-zone.shown {
  opacity: 1;
  pointer-events: auto;
}

.zone-l {
  justify-content: flex-end;
  padding-right: var(--sp-1);
}

.zone-r {
  justify-content: flex-start;
  padding-left: var(--sp-1);
}

.dot {
  position: relative;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--surface-1);
  border: 2px solid var(--accent);
  transform: scale(1);
  transition: transform 0.15s ease;
  box-shadow: var(--shadow-dot);
}

.dot.near {
  transform: scale(1.2);
}
</style>
