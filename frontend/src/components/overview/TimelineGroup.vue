<script setup lang="ts">
// 時間軸的一位 PM：可收合的群組列（收合時畫摘要 bar）＋ 底下的專案列；PM 色系變數由根元素 .g 提供給列與速覽。
import { computed, onUpdated, ref } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import TimelineProjectRow from '@/components/overview/TimelineProjectRow.vue'
import { freezeLeave } from '@/composables/freezeLeave'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'
import { PANEL_UNMOUNT_MS } from '@/constants/overview'
import { dayIndex } from '@/lib/date'
import type { PmGroup } from '@/lib/portfolio'
import { useOverviewStore } from '@/stores/overview'

const props = defineProps<{
  group: PmGroup
  /** 時間軸範圍起點的絕對日索引。 */
  startIdx: number
  /** 一天的寬（px）。 */
  dw: number
  /** 這一組在時間軸上的位置；用來判斷這次更新整組有沒有移動。 */
  index: number
}>()

/*
 * 巢狀 FLIP：組在時間軸上換位置時，組本身有重排動畫（OverviewTimeline 的 ov-group）。
 * 裡面的專案列 TransitionGroup 量的是頁面上的絕對位置，會把組的位移再算一次，列就偏移兩倍。
 * 所以組移動的那一輪停用列的重排（列跟著組一起動）；組沒動、只有組內順序變時才讓列自己重排。
 * 做法與卡片檢視的 PmColumn 相同。
 */
const prevIndex = ref(props.index)
onUpdated(() => {
  prevIndex.value = props.index
})
const rowMoveClass = computed(() =>
  props.index === prevIndex.value ? 'ov-row-move' : 'ov-row-still',
)

const overview = useOverviewStore()

const pmId = computed(() => props.group.pm.id)
const collapsed = computed(() => overview.isCollapsed(pmId.value))
/** 收合動畫（grid-template-rows）跑完前先別把專案列拿掉。 */
const rowsMounted = useDelayedUnmount(() => !collapsed.value, PANEL_UNMOUNT_MS)

/** PM 色來自資料，不是 token，所以走 inline。 */
const pmStyle = computed(() => ({ '--pm': props.group.pm.color }))

/** 收合摘要 bar：組內最早開始日到最晚到期日（A13），寬度算法同專案 bar（頭尾都算，蓋到到期日當天）。 */
const sumStyle = computed(() => {
  const rows = props.group.rows
  if (!rows.length) return { left: '0px', width: '0px' }
  const a = Math.min(...rows.map((r) => dayIndex(r.p.startDate)))
  const b = Math.max(...rows.map((r) => dayIndex(r.p.dueDate)))
  return { left: `${(a - props.startIdx) * props.dw}px`, width: `${(b - a + 1) * props.dw}px` }
})

function toggle(): void {
  overview.toggleGroup(pmId.value)
}

function onKey(e: KeyboardEvent): void {
  // 只處理群組列本身的按鍵
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ') {
    // 空白鍵預設會捲動頁面
    e.preventDefault()
    toggle()
  }
}
</script>

<template>
  <div class="g" :class="{ 'is-collapsed': collapsed }" :style="pmStyle">
    <div
      class="g-row"
      role="button"
      tabindex="0"
      :aria-expanded="!collapsed"
      :data-pm-group="pmId"
      @click="toggle"
      @keydown="onKey"
    >
      <div class="g-left">
        <span class="g-caret" aria-hidden="true">▼</span>
        <Avatar :member="group.pm" :size="22" />
        <span class="g-name">{{ group.pm.name }}</span>
        <span class="g-counts">
          <span><b>{{ group.rows.length }}</b> 個專案</span>
          <span>·</span>
          <span :class="{ 'is-danger': group.alertCount > 0 }"><b>{{ group.alertCount }}</b> 個需要注意</span>
        </span>
      </div>
      <div class="g-canvas">
        <Transition name="ov-fade"><i v-if="collapsed" class="g-sum" :style="sumStyle"></i></Transition>
      </div>
    </div>

    <div class="g-rows" :style="{ gridTemplateRows: collapsed ? '0fr' : '1fr' }">
      <!-- 一定要 clip 不能 hidden：hidden 會成為捲動容器，.p-left 與 .qv 的 sticky left:0 就失效 -->
      <div class="g-clip">
        <TransitionGroup
          v-if="rowsMounted"
          name="ov-row"
          tag="div"
          class="g-list"
          :move-class="rowMoveClass"
          @before-leave="freezeLeave"
        >
          <TimelineProjectRow
            v-for="r in group.rows"
            :key="r.p.id"
            :row="r"
            :start-idx="startIdx"
            :dw="dw"
          />
        </TransitionGroup>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* PM 色系：群組列 12%、專案列 5%，選取態與速覽框另有一組（B2 2098 / 2250） */
.g {
  --pm-group: color-mix(in srgb, var(--pm) 12%, var(--surface-1));
  --pm-group-t: color-mix(in srgb, var(--pm) 12%, transparent);
  --pm-row: color-mix(in srgb, var(--pm) 5%, var(--surface-1));
  --pm-row-t: color-mix(in srgb, var(--pm) 5%, transparent);
  --pm-row-hover: color-mix(in srgb, var(--pm) 9%, var(--surface-1));
  --pm-line: color-mix(in srgb, var(--pm) 22%, var(--border-1));
  --pm-frame: var(--pm);
  /* PM 色系文字，淡底上仍 ≥ 4.5:1 */
  --pm-ink: color-mix(in srgb, var(--pm) 60%, var(--text-1));
  --pm-sel: color-mix(in srgb, var(--pm) 16%, var(--surface-1));
  --pm-sel-t: color-mix(in srgb, var(--pm) 12%, transparent);
  --pm-soft: color-mix(in srgb, var(--pm) 30%, var(--surface-1));
}

.g + .g {
  border-top: 1px solid var(--border-1);
}

.g-row {
  display: flex;
  height: var(--gantt-row);
  cursor: pointer;
}

.g-row:focus-visible {
  outline: none;
}

.g-row:focus-visible .g-left {
  box-shadow: inset var(--ring-focus);
}

/* sticky 左欄：z-index 30 高於今天標籤（26） */
.g-left {
  position: sticky;
  left: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 var(--gantt-left);
  width: var(--gantt-left);
  padding: 0 var(--sp-4) 0 var(--sp-6);
  background: var(--pm-group);
  border-right: 1px solid var(--border-1);
  border-bottom: 1px solid var(--pm-line);
  box-shadow: var(--shadow-left-col);
  /* focus ring 是 box-shadow，要一起過渡，不然鍵盤移到這列時框線會瞬間出現（A19） */
  transition:
    background var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.g-canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  background: var(--pm-group-t);
  border-bottom: 1px solid var(--pm-line);
}

.g-row:hover .g-left {
  background: color-mix(in srgb, var(--pm) 16%, var(--surface-1));
}

/* 單一圖示旋轉，不換字元（A13 / A24） */
.g-caret {
  display: inline-block;
  width: 14px;
  flex: 0 0 14px;
  font-size: var(--fs-pill);
  color: var(--text-3);
  text-align: center;
  transition: transform var(--t-layout) var(--ease);
}

.g.is-collapsed .g-caret {
  transform: rotate(-90deg);
}

.g-name {
  font-size: var(--fs-14);
  font-weight: var(--fw-bold);
  color: var(--text-1);
  white-space: nowrap;
}

.g-counts {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  margin-left: auto;
  font-size: var(--fs-date);
  color: var(--text-3);
  white-space: nowrap;
}

.g-counts b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-medium);
  color: var(--text-1);
}

.g-counts .is-danger,
.g-counts .is-danger b {
  color: var(--danger-text);
  font-weight: var(--fw-bold);
}

/* 收合摘要條（照 GanttBar .summary） */
.g-sum {
  position: absolute;
  top: 12px;
  height: 10px;
  border-radius: var(--r-3);
  background: var(--text-3);
  z-index: 2;
}

.g-rows {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  transition: grid-template-rows var(--t-panel) var(--ease);
}

.g-clip {
  min-height: 0;
  overflow: clip;
}

/* 離場列由 freezeLeave 釘成 absolute，以這層為基準（A20） */
.g-list {
  position: relative;
}
</style>
