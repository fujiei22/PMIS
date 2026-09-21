<script lang="ts">
/** 下拉裡的一個選項。 */
export interface FilterOption {
  /** 選項 key，pick 事件會原樣送回。 */
  key: string
  label: string
  /** 左邊的小圓點顏色；沒有就不畫（分類 / Issue 有無 / 日期模式都沒有）。 */
  dot?: string
  checked: boolean
}
</script>

<script setup lang="ts">
// 頂部列的篩選 pill：觸發鈕 + 下拉面板；開關狀態由 ui.openDropdown 互斥管理。
// legacy 對照：模板 :117-131（狀態）等七個同構的區塊，選項資料 :3701-3764。
import { computed } from 'vue'
import { useUiStore, type DropdownKey } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    ddKey: DropdownKey
    label: string
    /** 有套用篩選：邊框與文字轉成 accent。 */
    active?: boolean
    options: FilterOption[]
    /** 面板最小寬度（px）；legacy 各下拉 128-168 不等。 */
    menuWidth?: number
    /** 選項字太長要截斷（分類下拉）。 */
    ellipsis?: boolean
    /** 面板最高高度（px），超過就捲。 */
    menuMaxHeight?: number
  }>(),
  { active: false, menuWidth: 150, ellipsis: false },
)

defineEmits<{ pick: [key: string] }>()

const ui = useUiStore()
const open = computed(() => ui.openDropdown === props.ddKey)

const menuStyle = computed(() => ({
  minWidth: `${props.menuWidth}px`,
  maxHeight: props.menuMaxHeight ? `${props.menuMaxHeight}px` : undefined,
  overflow: props.menuMaxHeight ? 'auto' : undefined,
}))
</script>

<template>
  <div class="dd">
    <div
      class="dd-trigger"
      :class="{ active }"
      data-dd="1"
      role="button"
      @click="ui.toggleDropdown(ddKey)"
    >
      <span>{{ label }}</span>
      <span class="dd-arrow">▼</span>
    </div>
    <div v-if="open" class="dd-menu" data-dd="1" :style="menuStyle">
      <div
        v-for="o in options"
        :key="o.key"
        class="dd-item"
        :class="{ on: o.checked }"
        role="button"
        @click="$emit('pick', o.key)"
      >
        <span v-if="o.dot" class="dd-dot" :style="{ background: o.dot }"></span>
        <span class="dd-label" :class="{ ellipsis }">{{ o.label }}</span>
        <span class="dd-check">{{ o.checked ? '✓' : '' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  flex: 0 0 auto;
}

.dd-trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 var(--sp-6);
  font-size: var(--fs-control);
  border: 1px solid var(--border-1);
  border-radius: var(--r-pill);
  color: var(--text-2);
  background: var(--surface-1);
  cursor: pointer;
  white-space: nowrap;
}

.dd-trigger.active {
  border-color: var(--accent);
  color: var(--accent-hover);
}

.dd-arrow {
  font-size: var(--fs-weekday);
  color: var(--text-muted);
}

.dd-menu {
  position: absolute;
  top: 32px;
  left: 0;
  z-index: 100;
  padding: var(--sp-2);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
  animation: popIn var(--t-menu) ease-out;
}

.dd-item {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: 28px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-control);
  font-size: var(--fs-control);
  color: var(--text-2);
  cursor: pointer;
}

.dd-item.on {
  color: var(--accent-hover);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.dd-item:hover {
  background: var(--surface-3);
}

.dd-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dd-label {
  flex: 1;
}

.dd-label.ellipsis {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dd-check {
  font-size: var(--fs-pill);
  color: var(--accent);
}
</style>
