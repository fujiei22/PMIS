<script setup lang="ts">
// 甘特圖右側的條列與今天線。條本身（含 Issue 徽章、連線圓點）在 GanttBar。
// legacy 對照：模板 :502-522，bars :2887-2958。
//
// 契約 G：這裡只算「要畫哪幾條」，樣式全部由子元件自己算——
// 原本一顆大 computed 會讓任何一條 hover / 拖曳都整批重算（review C6）。
import { computed } from 'vue'
import GanttBar from '@/components/gantt/GanttBar.vue'
import { dayFraction, dayIndex } from '@/lib/date'
import { useClockStore } from '@/stores/clock'
import { useFilterStore } from '@/stores/filter'
import { useRowsStore } from '@/stores/rows'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Group, Task } from '@/types/models'

const clock = useClockStore()
const ui = useUiStore()
const rowsStore = useRowsStore()
const taskStore = useTaskStore()
const filter = useFilterStore()

/** 一條的身分：一般任務條，或收合分類的摘要條（GanttBar 的 props）。 */
type BarItem =
  | { kind: 'task'; task: Task; rowIndex: number }
  | { kind: 'summary'; group: Group; rowIndex: number; a: number; b: number }

/** v-for 的 key；摘要條與任務條共用一個命名空間（摘要條是 `sum-<gid>`）。 */
function barKey(b: BarItem): string {
  return b.kind === 'task' ? b.task.id : `sum-${b.group.id}`
}

const bars = computed<BarItem[]>(() => {
  const rows = rowsStore.visibleRows
  const rowIndex = rowsStore.rowIndexOf
  const collapsed = ui.collapsedGroups
  const out: BarItem[] = []

  for (const g of taskStore.groups) {
    const gt = taskStore.tasks.filter((t) => t.groupId === g.id && filter.passTask(t))

    // 收合且底下有任務 → 一條涵蓋整個分類的摘要條（legacy :2891-2903）
    if (collapsed.has(g.id) && gt.length) {
      const gi = rows.findIndex((v) => v.kind === 'g' && v.id === g.id)
      out.push({
        kind: 'summary',
        group: g,
        rowIndex: gi,
        a: Math.min(...gt.map((t) => dayIndex(t.start))),
        b: Math.max(...gt.map((t) => dayIndex(t.end))),
      })
      continue
    }
    if (collapsed.has(g.id)) continue

    for (const t of gt) {
      const i = rowIndex[t.id]
      if (i === undefined) continue
      out.push({ kind: 'task', task: t, rowIndex: i })
    }
  }
  return out
})

/** 今天線的位置：整數日 + 當天已經過掉的工作時間比例。legacy :3519 */
const todayLeft = computed(
  () => (clock.todayIdx - taskStore.range.a + dayFraction(new Date(clock.now))) * ui.dayWidth,
)
</script>

<template>
  <GanttBar v-for="b in bars" :key="barKey(b)" v-bind="b" />

  <div class="today-line" :class="{ still: ui.zooming }" :style="{ left: `${todayLeft}px` }"></div>
  <div class="today-tag" :class="{ still: ui.zooming }" :style="{ left: `${todayLeft + 5}px` }">
    今天
  </div>
</template>

<style scoped>
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
