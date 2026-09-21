<script setup lang="ts">
// 甘特圖右側的條：一般任務條、收合分類的摘要條、Issue 徽章、連線圓點、今天線。
// legacy 對照：模板 :502-522，bars :2887-2958。
import { computed } from 'vue'
import { usePointerDragContext } from '@/composables/usePointerDrag'
import { ROW_HEIGHT } from '@/constants/dashboard'
import { dayFraction, dayIndex, lengthOf } from '@/lib/date'
import { isLate } from '@/lib/schedule'
import { useClockStore } from '@/stores/clock'
import { useFilterStore } from '@/stores/filter'
import { useIssueStore } from '@/stores/issue'
import { useRowsStore } from '@/stores/rows'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const clock = useClockStore()
const ui = useUiStore()
const rowsStore = useRowsStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const filter = useFilterStore()
const selection = useSelectionStore()
const drag = usePointerDragContext()

interface Bar {
  id: string
  summary: boolean
  /** 一般條放狀態 key 或 delayed；摘要條沒有狀態。 */
  status: string | null
  left: number
  top: number
  w: number
  selected: boolean
  rel: 'up' | 'down' | 'group' | null
  dimmed: boolean
  label: string
  title: string
  issueOpen: number
  /** 連線圓點的可視狀態與熱區位置。 */
  showL: boolean
  showR: boolean
  near: boolean
  zoneL: number
  zoneR: number
  zoneY: number
  /** 拖曳 / 縮放中要關掉位移補間。legacy :2926 */
  still: boolean
}

const bars = computed<Bar[]>(() => {
  const rangeA = taskStore.range.a
  const dw = ui.dayWidth
  const rows = rowsStore.visibleRows
  const rowIndex = rowsStore.rowIndexOf
  const drag = ui.drag
  const collapsed = ui.collapsedGroups
  const linking = drag?.kind === 'link'
  const out: Bar[] = []

  for (const g of taskStore.groups) {
    const gt = taskStore.tasks.filter((t) => t.groupId === g.id && filter.passTask(t))

    // 收合且底下有任務 → 畫一條涵蓋整個分類的摘要條（legacy :2891-2903）
    if (collapsed.has(g.id) && gt.length) {
      const gi = rows.findIndex((v) => v.kind === 'g' && v.id === g.id)
      const a = Math.min(...gt.map((t) => dayIndex(t.start)))
      const b = Math.max(...gt.map((t) => dayIndex(t.end)))
      out.push({
        id: `sum-${g.id}`,
        summary: true,
        status: null,
        left: (a - rangeA) * dw,
        top: gi * ROW_HEIGHT + 12,
        w: (b - a + 1) * dw,
        selected: false,
        rel: null,
        dimmed: false,
        label: '',
        title: `${g.name}（收合）`,
        issueOpen: 0,
        showL: false,
        showR: false,
        near: false,
        zoneL: -999,
        zoneR: -999,
        zoneY: -999,
        still: ui.zooming,
      })
      continue
    }
    if (collapsed.has(g.id)) continue

    for (const t of gt) {
      const i = rowIndex[t.id]
      if (i === undefined) continue
      const left = (dayIndex(t.start) - rangeA) * dw
      const w = lengthOf(t) * dw
      const on = selection.taskId === t.id
      const rel = selection.related[t.id] ?? (selection.softHighlight[t.id] ? 'group' : null)
      const open = issueStore.openCount(t.id)
      const near = ui.nearTaskId === t.id
      // 連線中：來源顯示自己那側，其他任務顯示可以接上的那一側（legacy :2912-2913）
      const side = linking ? drag.side : null
      const isSrc = linking && drag.id === t.id
      const hovered = on && ui.hoverTaskId === t.id
      out.push({
        id: t.id,
        summary: false,
        status: isLate(t, clock.todayIdx) ? 'delayed' : t.status,
        left,
        top: i * ROW_HEIGHT + 6,
        w,
        selected: on,
        rel,
        dimmed: selection.hasSelection && !on && !rel,
        label: t.name,
        title:
          (on ? '' : '點擊以選取後才能拖曳｜') +
          `${t.name}｜${t.start} → ${t.end}｜${lengthOf(t)} 天` +
          (rel ? `（${rel === 'up' ? '前置任務' : rel === 'down' ? '後續任務' : '同分類'}）` : ''),
        issueOpen: open,
        showL: linking ? (isSrc ? side === 'L' : near && side === 'R') : hovered,
        showR: linking ? (isSrc ? side === 'R' : near && side === 'L') : hovered,
        near: linking && near,
        zoneL: left - 33,
        zoneR: left + w + 2,
        zoneY: i * ROW_HEIGHT - 3,
        still: ui.zooming || !!(drag && (drag.kind === 'pan' || ('id' in drag && drag.id === t.id))),
      })
    }
  }
  return out
})

/** 今天線的位置：整數日 + 當天已經過掉的工作時間比例。legacy :3519 */
const todayLeft = computed(
  () => (clock.todayIdx - taskStore.range.a + dayFraction(new Date(clock.now))) * ui.dayWidth,
)

function onBarClick(bar: Bar): void {
  // 摘要條點了就展開該分類（legacy :2900）
  if (bar.summary) ui.toggleGroup(bar.id.slice(4))
  else selection.toggleTask(bar.id)
}

/**
 * 條本體按下去開始移動——但只有選取中的條可以拖。
 * 沒選取就不 stopPropagation，讓事件落到畫布去平移（legacy `onMove` :2951）。
 */
function onBarDown(e: PointerEvent, bar: Bar): void {
  if (bar.summary || !bar.selected) return
  drag.startBar(e, bar.id, 'move')
}

/** 成員拖到條上 → 指派給這個任務。legacy `onDrop` :2958 */
function onBarDrop(e: DragEvent, bar: Bar): void {
  e.preventDefault()
  e.stopPropagation()
  if (bar.summary) return
  const raw = e.dataTransfer?.getData('text/plain') ?? ''
  // 只接成員；卡片拖曳（`task:` 前綴）落在條上不做事（legacy :2958）
  if (!raw || raw.startsWith('task:')) return
  taskStore.assign(
    bar.id,
    raw.split(',').filter(Boolean),
  )
}
</script>

<template>
  <template v-for="b in bars" :key="b.id">
    <div
      class="bar"
      :class="{
        summary: b.summary,
        selected: b.selected,
        [`rel-${b.rel}`]: !!b.rel,
        dimmed: b.dimmed,
        still: b.still,
      }"
      :data-taskid="b.id"
      :data-status="b.status ?? undefined"
      :title="b.title"
      :style="{ left: `${b.left}px`, top: `${b.top}px`, width: `${b.w}px` }"
      role="button"
      @click.stop="onBarClick(b)"
      @pointerdown="onBarDown($event, b)"
      @pointerenter="drag.setHover(b.id)"
      @pointerleave="drag.clearHover(b.id)"
      @dragover.prevent
      @drop="onBarDrop($event, b)"
    >
      <div
        v-if="!b.summary"
        class="handle handle-l"
        :class="{ live: b.selected }"
        @pointerdown="drag.startBar($event, b.id, 'resL')"
      ></div>
      <div v-if="b.issueOpen" class="issue-badge"><span>!</span><span>{{ b.issueOpen }}</span></div>
      <div v-if="!b.summary" class="bar-label" :class="{ 'has-badge': b.issueOpen }">
        {{ b.label }}
      </div>
      <div
        v-if="!b.summary"
        class="handle handle-r"
        :class="{ live: b.selected }"
        @pointerdown="drag.startBar($event, b.id, 'resR')"
      ></div>
    </div>
    <template v-if="!b.summary">
      <div
        class="dot-zone zone-l"
        :class="{ shown: b.showL }"
        :data-linkfor="b.id"
        :style="{ left: `${b.zoneL}px`, top: `${b.zoneY}px` }"
        @pointerdown="drag.startLink($event, b.id, 'L')"
        @pointerenter="drag.setHover(b.id)"
        @pointerleave="drag.clearHover(b.id)"
      >
        <div class="dot" :class="{ near: b.near }"></div>
      </div>
      <div
        class="dot-zone zone-r"
        :class="{ shown: b.showR }"
        :data-linkfor="b.id"
        :style="{ left: `${b.zoneR}px`, top: `${b.zoneY}px` }"
        @pointerdown="drag.startLink($event, b.id, 'R')"
        @pointerenter="drag.setHover(b.id)"
        @pointerleave="drag.clearHover(b.id)"
      >
        <div class="dot" :class="{ near: b.near }"></div>
      </div>
    </template>
  </template>

  <div class="today-line" :class="{ still: ui.zooming }" :style="{ left: `${todayLeft}px` }"></div>
  <div class="today-tag" :class="{ still: ui.zooming }" :style="{ left: `${todayLeft + 5}px` }">
    今天
  </div>
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

.today-line {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: var(--today);
  z-index: 2;
  pointer-events: none;
  transition:
    left var(--t-bar) var(--ease),
    height var(--t-bar) ease;
}

.today-tag {
  position: absolute;
  top: var(--sp-3);
  z-index: 26;
  background: var(--today);
  color: var(--surface-1);
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  padding: var(--r-2) var(--sp-3);
  border-radius: var(--r-badge);
  pointer-events: none;
  font-family: var(--font-mono);
  transition: left var(--t-bar) var(--ease);
}

.today-line.still,
.today-tag.still {
  transition: none;
}
</style>
