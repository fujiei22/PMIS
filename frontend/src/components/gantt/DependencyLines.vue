<script setup lang="ts">
// 甘特圖上的相依連線（折線 + 箭頭），外加拖曳建立相依時的預覽線。
// legacy 對照：模板 :481-500，depPaths :2961-2987。
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useDomRegistry } from '@/composables/useDomRegistry'
import { usePointerDragContext } from '@/composables/usePointerDrag'
import { tokenTiming, useRowMotionContext } from '@/composables/useRowMotion'
import { ROW_HEIGHT } from '@/constants/dashboard'
import { dayIndex } from '@/lib/date'
import { useRowsStore } from '@/stores/rows'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 折線在垂直段之間錯開的間距，避免多條線重疊。legacy `18 + (k % 3) * 7`（:2967） */
const LANE_BASE = 18
const LANE_STEP = 7
/** 條的高度一半：折線的端點在條的垂直中線（列 top + 6 + 11 = legacy 的 + 17）。 */
const BAR_MID = 11
/** 條的過渡跑完之後再多跟兩幀，確保停在終點才換回照資料算。 */
const FOLLOW_SLACK_MS = 34

defineProps<{ chartWidth: number; chartHeight: number }>()

const ui = useUiStore()
const rowsStore = useRowsStore()
const taskStore = useTaskStore()
const selection = useSelectionStore()
const registry = useDomRegistry()
const motion = useRowMotionContext()
const drag = usePointerDragContext()

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

/** 一條的兩端要用到的幾何（相對於圖層左上角）：左緣、右緣、垂直中線。 */
interface BarGeo {
  l: number
  r: number
  y: number
}

/**
 * 條正在補間（上下位移、變寬、被 cascade 推動）時，照條**實際畫出來的位置**畫線；null = 靜止，照資料算。
 *
 * 動畫稽核 D4：折線是 SVG 屬性，沒有過渡，資料一變就跳到終點，跟還在滑的條脫開 32–204px。
 * 條的上下位移由 useRowMotion 補間、左右由 CSS 過渡（拖曳中的條、縮放時不補間），
 * 與其在這裡把兩套時間函式再算一次，不如直接量條的位置——永遠跟條對齊。
 */
const live = shallowRef<ReadonlyMap<string, BarGeo> | null>(null)

/** 由資料算出一條的幾何（靜止時的位置）。 */
function dataGeo(id: string, rowIndex: number, rangeA: number, dw: number): BarGeo | null {
  const t = taskStore.taskById(id)
  if (!t) return null
  return {
    l: (dayIndex(t.start) - rangeA) * dw,
    r: (dayIndex(t.end) - rangeA + 1) * dw,
    y: rowIndex * ROW_HEIGHT + 6 + BAR_MID,
  }
}

const paths = computed<DepPath[]>(() => {
  const rangeA = taskStore.range.a
  const dw = ui.dayWidth
  const rowIndex = rowsStore.rowIndexOf
  const measured = live.value
  const out: DepPath[] = []

  taskStore.deps.forEach((d, k) => {
    const A = taskStore.taskById(d.from)
    const B = taskStore.taskById(d.to)
    if (!A || !B) return
    const ai = rowIndex[A.id]
    const bi = rowIndex[B.id]
    if (ai === undefined || bi === undefined) return
    const a = measured?.get(A.id) ?? dataGeo(A.id, ai, rangeA, dw)
    const b = measured?.get(B.id) ?? dataGeo(B.id, bi, rangeA, dw)
    if (!a || !b) return

    const ay = a.y
    const by = b.y
    const ax = a.r
    const endX = b.l - 3
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

const layer = ref<SVGSVGElement | null>(null)

/** 量一次相依線兩端的條實際畫在哪（含上下位移的 translate、left / width 過渡的中間值）。 */
function measure(): void {
  const svg = layer.value
  if (!svg) return
  const o = svg.getBoundingClientRect()
  const out = new Map<string, BarGeo>()
  for (const d of taskStore.deps) {
    for (const id of [d.from, d.to]) {
      if (out.has(id)) continue
      const el = registry.bars.get(id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      out.set(id, { l: r.left - o.left, r: r.right - o.left, y: r.top - o.top + BAR_MID })
    }
  }
  live.value = out
}

// 條在補間的這段期間，每一幀照條的實際位置重畫；資料一變就開始跟，跟到過渡跑完
let followUntil = 0
let followMs: number | null = null
let raf: number | undefined

function tick(): void {
  raf = undefined
  measure()
  if (performance.now() < followUntil || motion.offsets.value.size || drag.nudging.value) {
    raf = requestAnimationFrame(tick)
  } else {
    live.value = null
  }
}

/** 資料變了：條會用 --t-bar 補間過去，這段時間線跟著條走。 */
function follow(): void {
  followMs ??= tokenTiming().duration + FOLLOW_SLACK_MS
  followUntil = performance.now() + followMs
  if (raf === undefined) raf = requestAnimationFrame(tick)
}

/** 相依線兩端的資料（列 index、起訖日索引、一天的寬度）；它變了代表條要開始動。 */
const endpoints = computed(() => {
  const rowIndex = rowsStore.rowIndexOf
  const ends = (id: string): string => {
    const t = taskStore.taskById(id)
    return t ? `${rowIndex[id]},${dayIndex(t.start)},${dayIndex(t.end)}` : ''
  }
  const parts = taskStore.deps.map((d) => `${ends(d.from)}>${ends(d.to)}`)
  return `${taskStore.range.a}|${ui.dayWidth}|${parts.join(';')}`
})
watch(endpoints, follow)

// 拖曳自動捲動時條用 transform 補未滿一天的差，這不改資料：補償與放開回彈的期間一直照條的位置畫，
// 結束後再跟一段（回彈動畫從下一幀才開始算，尾巴比計時器晚一點）
watch(
  () => drag.nudging.value,
  (on) => {
    if (!on) follow()
    else if (raf === undefined) raf = requestAnimationFrame(tick)
  },
)

// 列的上下位移每一幀寫完 translate 才換 offsets：這時量，量到的就是這一幀條的位置
// （自己的 rAF 可能排在 useRowMotion 前面，量到上一幀的位置）
watch(
  () => motion.offsets.value,
  () => {
    measure()
    if (raf === undefined) raf = requestAnimationFrame(tick)
  },
  { flush: 'sync' },
)

onBeforeUnmount(() => {
  if (raf !== undefined) cancelAnimationFrame(raf)
})

/** 點線 → 兩步刪除確認。legacy `onDelete` :2982 */
function askDelete(p: DepPath): void {
  ui.confirm = { kind: 'dep', id: p.id, step: 1, label: p.label }
}
</script>

<template>
  <svg ref="layer" class="dep-layer" :width="chartWidth" :height="chartHeight">
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
  <svg v-if="ui.linkLine" class="link-layer" :width="chartWidth" :height="chartHeight">
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
  /* 選取時的淡化跟條（.bar 的 opacity）同一組時長 */
  transition: opacity var(--t-fast) ease;
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
