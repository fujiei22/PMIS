<script setup lang="ts">
// 實際 / 理論合一進度條：實際填色到兩者較小的那端，兩者之間的落差另外上色（落後紅斜紋、超前綠），
// 上方 ▼ 標理論、下方 ▲ 標實際。專案卡與速覽共用。
// 游標標籤用 translateX(-pos%) 對齊，0% / 100% 時貼齊兩端不會超出條外。
import { computed } from 'vue'

const props = defineProps<{
  actual: number
  planned: number
  /** 實際填色，對應 BADGE_CLASS 的值（late / paused / doing / todo / done）。 */
  tone: string
}>()

const bar = computed(() => {
  const lo = Math.min(props.actual, props.planned)
  return {
    lo,
    gapWidth: Math.abs(props.planned - props.actual),
    ahead: props.actual > props.planned,
  }
})
</script>

<template>
  <div class="pa-bar">
    <div class="pin pin-plan" :style="{ left: planned + '%' }">
      <span class="pin-label" :style="{ transform: `translateX(-${planned}%)` }">理論 {{ planned }}%</span>
      <i class="pin-arrow"></i>
    </div>
    <div
      class="track"
      role="progressbar"
      :aria-valuenow="actual"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="實際進度"
      :aria-valuetext="`實際 ${actual}%，理論 ${planned}%`"
    >
      <div class="fill" :class="'fill-' + tone" :style="{ width: bar.lo + '%' }"></div>
      <div
        class="gap-seg"
        :class="bar.ahead ? 'gap-ahead' : 'gap-behind'"
        :style="{ left: bar.lo + '%', width: bar.gapWidth + '%' }"
      ></div>
    </div>
    <div class="pin pin-act" :style="{ left: actual + '%' }">
      <i class="pin-arrow"></i>
      <span class="pin-label" :style="{ transform: `translateX(-${actual}%)` }">實際 {{ actual }}%</span>
    </div>
  </div>
</template>

<style scoped>
.pa-bar {
  position: relative;
  padding: var(--sp-10) 0;
}

/* 游標本身寬 0，錨在百分比位置；標籤另外位移，貼齊兩端不超出 */
.pin {
  position: absolute;
  width: 0;
  display: flex;
  flex-direction: column;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-date);
  line-height: 1;
  transition: left var(--t-progress) var(--ease);
}

.pin-plan {
  top: 0;
  color: var(--text-muted);
}

.pin-act {
  bottom: 0;
  color: var(--text-1);
  font-weight: var(--fw-bold);
}

.pin-label {
  display: block;
  width: max-content;
  white-space: nowrap;
  transition: transform var(--t-progress) var(--ease);
}

.pin-arrow {
  width: 0;
  height: 0;
  margin-left: -5px;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
}

.pin-plan .pin-arrow {
  margin-top: var(--sp-1);
  border-top: 6px solid currentColor;
}

.pin-act .pin-arrow {
  margin-bottom: var(--sp-1);
  border-bottom: 6px solid currentColor;
}

.track {
  position: relative;
  height: var(--sp-5);
  border-radius: var(--r-4);
  background: var(--border-1);
  overflow: hidden;
}

/* 背景重載後寬度跟著動（A30） */
.fill {
  height: 100%;
  border-radius: inherit;
  transition: width var(--t-progress) var(--ease);
}

/* 實際進度條色跟著狀態徽章走（同 B2 .card-* .fill-actual） */
.fill-late {
  background: var(--st-delayed-bar);
}

.fill-paused {
  background: var(--st-paused-bar);
}

.fill-doing {
  background: var(--st-doing-bar);
}

.fill-todo {
  background: var(--st-todo-bar);
}

.fill-done {
  background: var(--st-done-bar);
}

.gap-seg {
  position: absolute;
  top: 0;
  bottom: 0;
  transition:
    left var(--t-progress) var(--ease),
    width var(--t-progress) var(--ease);
}

.gap-behind {
  background: repeating-linear-gradient(135deg, var(--danger-bd) 0 4px, var(--danger-bg) 4px 8px);
}

.gap-ahead {
  background: var(--success-bd);
}
</style>
