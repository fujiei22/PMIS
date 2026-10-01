<script setup lang="ts">
// 時間軸的一位 PM：可收合的群組列（收合時畫摘要 bar）＋ 底下的專案列；PM 色系變數由根元素 .g 提供給列與速覽。
import { computed, onBeforeUpdate, onUpdated, ref, type ComponentPublicInstance } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import PmCountPill from '@/components/overview/PmCountPill.vue'
import TimelineProjectRow from '@/components/overview/TimelineProjectRow.vue'
import { startLeaveNow, useCollapseReenter } from '@/composables/useCollapseReenter'
import { useRelativeFlip } from '@/composables/useRelativeFlip'
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
}>()

/*
 * 巢狀 FLIP：群組本身有重排動畫（OverviewTimeline 的 ov-group），組內專案列若也用 TransitionGroup
 * 內建的 move，會用頁面上的絕對位置算位移、把群組的位移再算一次。所以列的重排改用相對於 .g-list 的位移
 * （useRelativeFlip），內建 move 以 `ov-row-still`（overview-motion.css 裡只寫 transition: none）停用。做法同 PmLane。
 * 列的進出場是原地收合（ov-row，見 overview-motion.css）：重排與收合的單位都是列外層 .r-wrap。
 */
const list = ref<ComponentPublicInstance | null>(null)
const listEl = computed(() => list.value?.$el as HTMLElement | undefined)

/**
 * 同一個專案的列在收起途中又回來時，從當下的高度接續長回去。和 CardBoard 的泳道不同，量與寫起點都綁在本元件，
 * 不綁在列清單（TransitionGroup）上：列清單的插槽不隨 props 傳下去，它自己的重新渲染排在群組清單那一輪 patch 之後
 * （本元件在那一輪 patch 裡就更新，props.group 每次篩選都是新的）。
 * - 量（onBeforeUpdate）：那一輪 keyed diff 若搬動了這個群組的外層（篩選時群組順序跟著變，例：打 p 又刪掉時 m5 / m8 換回來），
 *   裡面進行中的收合過渡會被取消、一下跳到 0；等列清單自己更新時才量，只量到 0、列從頭長（實測）。
 * - 寫起點（onUpdated，要註冊在 useRelativeFlip 之前）：TransitionGroup 的 @enter 排在最後才呼叫，
 *   那時 useRelativeFlip 量留下的列、OverviewTimeline 的群組 move 量群組位置都已經量完，量到的是「回來的列還是 0 高」的版面；
 *   起點一寫上去，下面的列與群組就一幀被推下去約一列收剩的高度（實測 14px）。新進場的列在這裡已經掛上，先寫好再讓它們量。
 *   @enter 仍綁著，當本元件沒更新時的後備；同一個 key 的起點用過就刪掉，不會寫兩次。
 * - 進場中的列被搬動（群組外層被搬動、或列自己換順序）時進行中的長出會被取消、一幀長完：同樣在這裡、量之前從當下接續（resume）。
 */
const reenter = useCollapseReenter(listEl, 'data-row-wrap')
onBeforeUpdate(reenter.snapshot)
onUpdated(() => {
  for (const el of Array.from(listEl.value?.children ?? [])) {
    if (!el.classList.contains('ov-row-enter-active')) continue
    reenter.onEnter(el)
    reenter.resume(el)
  }
})
useRelativeFlip(listEl, 'data-row-wrap')

/**
 * 離場的列：收起途中仍在版面流裡、看得到，但不能再 Tab 進去、點到或被讀屏讀成兩份。焦點在裡面就先移開。
 * 不讀任何樣式（理由同 CardBoard 的 leaving：進場中被離場時，讀樣式會取消進行中的高度過渡、一幀跳到全高）。
 */
function leaving(el: Element): void {
  const node = el as HTMLElement
  if (node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  node.inert = true
}

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
        <PmCountPill :count="group.rows.length" />
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
          ref="list"
          move-class="ov-row-still"
          @before-leave="leaving"
          @leave="startLeaveNow"
          @enter="reenter.onEnter"
        >
          <div v-for="r in group.rows" :key="r.p.id" class="r-wrap" :data-row-wrap="r.p.id">
            <div class="r-clip">
              <TimelineProjectRow :row="r" :start-idx="startIdx" :dw="dw" />
            </div>
          </div>
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

/* 群組之間的分隔線在 OverviewTimeline（.g-wrap + .g-wrap .g）：群組外包了一層原地收合的外層，.g 不再是兄弟 */

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

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方（本檔其他 hover 同理） */
@media (hover: hover) {
  .g-row:hover .g-left {
    background: color-mix(in srgb, var(--pm) 16%, var(--surface-1));
  }
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


/*
 * 收合摘要條（照 GanttBar .summary）。收合中被篩選時範圍會變，left / width 要過渡（T13），不然一幀跳到新寬度。
 * 時長用 --t-panel，跟群組收合同長（甘特的摘要條是 --t-bar，那裡跟的是條的拖曳）。
 */
.g-sum {
  position: absolute;
  top: 12px;
  height: 10px;
  border-radius: var(--r-3);
  background: var(--text-3);
  z-index: 2;
  transition:
    left var(--t-panel) var(--ease),
    width var(--t-panel) var(--ease);
}

/* 淡入淡出（共用 ov-fade）時一併列出 left / width，同時淡入淡出又變寬時兩者不互相蓋掉 */
.g-sum.ov-fade-enter-active,
.g-sum.ov-fade-leave-active {
  transition:
    opacity var(--t-base) var(--ease),
    left var(--t-panel) var(--ease),
    width var(--t-panel) var(--ease);
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

/* useRelativeFlip 以這層為 offset 基準（列外層的 offsetParent）；離場列是原地收合、不釘位（A20） */
.g-list {
  position: relative;
}

/* 列外層：原地收合（ov-row，見 overview-motion.css） */
.r-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

/* 平常全高。:where() 讓特異度為 0，進出場 class 的 0fr 才蓋得過（理由同 OverviewTimeline 的 .g-wrap） */
:where(.r-wrap) {
  grid-template-rows: 1fr;
}

.r-clip {
  min-height: 0;
  min-width: 0;
}

/*
 * 只在收起 / 長出時裁切：平常裁的話，hover / 選取時 bar 的光暈（A25）會在列的上下緣被切平。
 * 一定要 clip 不能 hidden：hidden 會成為捲動容器，.p-left 與 .qv 的 sticky left:0 就失效（同 .g-clip）。
 */
.ov-row-enter-active > .r-clip,
.ov-row-leave-active > .r-clip {
  overflow: clip;
}
</style>
