<script setup lang="ts">
// PM 名字旁的專案數膠囊：PM 色淡底 + PM 色系深字。--pm 由祖先（泳道 / 時間軸群組）提供。
// 時間軸群組列只放數字；卡片泳道的標頭帶單位（「2 個專案」），和旁邊的「1 需注意」才不會混在一起讀。
defineProps<{
  count: number
  /** 數字後面接的單位字；不給就只顯示數字。 */
  unit?: string
}>()
</script>

<template>
  <span
    class="pm-count"
    :class="{ 'with-unit': unit }"
    :title="`${count} 個專案`"
    :aria-label="`${count} 個專案`"
  ><b>{{ count }}</b><template v-if="unit">&nbsp;{{ unit }}</template></span>
</template>

<style scoped>
/* 文字色與 --pm-ink 同算法（PM 色 60% 混 --text-1），淡底上仍 ≥ 4.5:1 */
.pm-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 20px;
  height: 18px;
  padding: 0 var(--sp-3);
  border-radius: 9px;
  background: color-mix(in srgb, var(--pm) 22%, var(--surface-1));
  color: color-mix(in srgb, var(--pm) 60%, var(--text-1));
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  line-height: 1;
  white-space: nowrap;
}

.pm-count b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: inherit;
}

/* 帶單位：和泳道標頭的「需注意」標籤同高同形 */
.pm-count.with-unit {
  height: 20px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-pill);
  font-size: var(--fs-date);
}
</style>
