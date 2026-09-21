<script setup lang="ts">
// 甘特圖上的相依連線（折線 + 箭頭），外加拖曳建立相依時的預覽線。
// legacy 對照：模板 :481-500，depPaths :2961-2987。
import { computed } from 'vue'
import { ROW_HEIGHT } from '@/constants/dashboard'
import { dayIndex } from '@/lib/date'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 折線在垂直段之間錯開的間距，避免多條線重疊。legacy `18 + (k % 3) * 7`（:2967） */
const LANE_BASE = 18
const LANE_STEP = 7

defineProps<{ chartWidth: number; chartHeight: number }>()

const ui = useUiStore()
const taskStore = useTaskStore()
const selection = useSelectionStore()

interface DepPath {
  id: string
  pts: string
  /** 刪除確認要顯示的「A → B」。legacy :2984 */
  label: string
  /** 連到選取任務：線變粗變藍、箭頭換色。legacy `hot` :2974 */
  hot: boolean
  dimmed: boolean
  title: string
}

const paths = computed<DepPath[]>(() => {
  const rangeA = taskStore.range.a
  const dw = ui.dayWidth
  const rowIndex = taskStore.rowIndexOf
  const out: DepPath[] = []

  taskStore.deps.forEach((d, k) => {
    const A = taskStore.taskById(d.from)
    const B = taskStore.taskById(d.to)
    if (!A || !B) return
    const ai = rowIndex[A.id]
    const bi = rowIndex[B.id]
    if (ai === undefined || bi === undefined) return

    const ay = ai * ROW_HEIGHT + 17
    const by = bi * ROW_HEIGHT + 17
    const ax = (dayIndex(A.end) - rangeA + 1) * dw
    const bx = (dayIndex(B.start) - rangeA) * dw
    const endX = bx - 3
    const dropX = endX - (LANE_BASE + (k % 3) * LANE_STEP)

    // 後續任務離得夠遠就走「右 → 下 → 右」；太近（甚至在左邊）就繞出去再折回來
    const pts =
      dropX > ax + 12
        ? [ax, ay, dropX, ay, dropX, by, endX, by].join(' ')
        : (() => {
            const midY = by > ay ? ay + 17 : ay - 17
            return [ax, ay, ax + 12, ay, ax + 12, midY, dropX, midY, dropX, by, endX, by].join(' ')
          })()

    out.push({
      id: d.id,
      pts,
      label: `${A.name} → ${B.name}`,
      hot: selection.taskId === A.id || selection.taskId === B.id,
      dimmed: selection.hasSelection,
      title: `${A.name} → ${B.name}（點擊刪除串接）`,
    })
  })
  return out
})

/** 點線 → 兩步刪除確認。legacy `onDelete` :2982 */
function askDelete(p: DepPath): void {
  ui.confirm = { kind: 'dep', id: p.id, step: 1, label: p.label }
}
</script>

<template>
  <svg class="dep-layer" :width="chartWidth" :height="chartHeight">
    <defs>
      <marker id="arw" markerWidth="7" markerHeight="7" refX="7" refY="3" orient="auto">
        <path d="M0,0 L7,3 L0,6 z" fill="var(--text-placeholder)" />
      </marker>
      <marker id="arwA" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
        <path d="M0,0 L7,3 L0,6 z" fill="var(--accent)" />
      </marker>
    </defs>
    <polyline
      v-for="p in paths"
      :key="p.id"
      class="dep"
      :class="{ hot: p.hot, dimmed: p.dimmed && !p.hot }"
      :points="p.pts"
      fill="none"
      stroke-linejoin="round"
      :marker-end="p.hot ? 'url(#arwA)' : 'url(#arw)'"
    />
    <polyline
      v-for="p in paths"
      :key="`hit-${p.id}`"
      class="dep-hit"
      :points="p.pts"
      fill="none"
      stroke="transparent"
      stroke-width="11"
      @click.stop="askDelete(p)"
    >
      <title>{{ p.title }}</title>
    </polyline>
  </svg>

  <!-- 拖曳建立相依時的虛線預覽（S5 才會填 linkLine） -->
  <svg
    v-if="ui.linkLine"
    class="link-layer"
    :width="chartWidth"
    :height="chartHeight"
  >
    <line
      :x1="ui.linkLine.x1"
      :y1="ui.linkLine.y1"
      :x2="ui.linkLine.x2"
      :y2="ui.linkLine.y2"
      stroke="var(--accent)"
      stroke-width="2.5"
      stroke-dasharray="5 4"
      stroke-linecap="round"
    />
    <circle :cx="ui.linkLine.x2" :cy="ui.linkLine.y2" r="4.5" fill="var(--accent)" />
  </svg>
</template>

<style scoped>
.dep-layer {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 5;
}

.dep {
  stroke: var(--text-placeholder);
  stroke-width: 1.5;
  opacity: 1;
}

.dep.hot {
  stroke: var(--accent);
  stroke-width: 2.4;
}

.dep.dimmed {
  opacity: 0.25;
}

.dep-hit {
  pointer-events: stroke;
  cursor: pointer;
}

.link-layer {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 30;
  overflow: visible;
}
</style>
