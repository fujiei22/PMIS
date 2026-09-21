<script lang="ts">
/** 尺規上的一天。 */
export interface RulerDay {
  /** 全域日索引（dayIndex 的值），當 key 用。 */
  idx: number
  /** 距離畫布左緣的位置（px）。 */
  left: number
  /** 這一天的寬度 = dayWidth。 */
  w: number
  /** 兩位數的日。 */
  dd: string
  /** 星期的單字（日一二…）。 */
  wd: string
  weekend: boolean
  today: boolean
}

/** 尺規上的一個月份格。 */
export interface RulerMonth {
  /** 'YYYY-MM'，當 key 用。 */
  label: string
  /** 累積寬度（px）。 */
  w: number
  /** 依寬度決定顯示全形 / 只有月 / 不顯示。legacy :2732 */
  short: string
}
</script>

<script setup lang="ts">
// 甘特圖上方的月 / 日尺規；水平捲動由父層的 useGanttScroll 同步。
// legacy 對照：模板 :406-420，days / months :2716-2733。
defineProps<{
  days: RulerDay[]
  months: RulerMonth[]
  /** 畫布總寬 = 天數 × dayWidth。 */
  chartWidth: number
}>()
</script>

<template>
  <div class="track" :style="{ width: `${chartWidth}px` }">
    <div class="months">
      <div v-for="m in months" :key="m.label" class="month" :style="{ flex: `0 0 ${m.w}px` }">
        {{ m.short }}
      </div>
    </div>
    <div class="days">
      <div
        v-for="d in days"
        :key="d.idx"
        class="day"
        :class="{ weekend: d.weekend }"
        :style="{ flex: `0 0 ${d.w}px` }"
      >
        <div class="dd">{{ d.dd }}</div>
        <div class="wd">{{ d.wd }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.track {
  height: var(--gantt-head);
}

.months {
  display: flex;
  height: 26px;
  border-bottom: 1px solid var(--border-1);
}

.month {
  border-right: 1px solid var(--border-1);
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
  color: var(--text-3);
  display: flex;
  align-items: center;
  padding-left: var(--sp-4);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
}

.days {
  display: flex;
  height: 28px;
  align-items: stretch;
}

.day {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  font-size: var(--fs-caption);
  line-height: 1;
  font-family: var(--font-mono);
  color: var(--text-2);
  font-weight: var(--fw-regular);
  background: transparent;
  border-right: 1px solid var(--bg-page);
}

.day.weekend {
  color: var(--text-3);
  font-weight: var(--fw-bold);
  background: var(--bg-weekend-head);
}

.dd {
  line-height: 1;
}

.wd {
  font-size: var(--fs-weekday);
  line-height: 1;
  color: var(--text-muted);
}
</style>
