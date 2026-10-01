<script setup lang="ts">
// 總覽兩種檢視共用的面板外殼：sticky 標題列（標題、計數、排序、收合鈕）＋ 可收合的內容區。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'
import { NARROW_QUERY, useMediaQuery } from '@/composables/useMediaQuery'
import { PANEL_UNMOUNT_MS } from '@/constants/overview'
import type { OverviewView } from '@/stores/overview'
import { useOverviewStore } from '@/stores/overview'

defineProps<{
  /** 面板標題，例如「專案看板」。 */
  title: string
  /** 哪一種檢視；同時當 `data-view-panel` 的值。 */
  view: OverviewView
}>()

const overview = useOverviewStore()

const root = ref<HTMLElement | null>(null)
const head = ref<HTMLElement | null>(null)

/** 平板直向（< 900px）標題列擺不下完整句，改短寫，標題列才能維持一行。 */
const narrow = useMediaQuery(NARROW_QUERY)
const countText = computed(() => {
  const c = overview.counts
  return narrow.value
    ? `${c.projects} 專案 · ${c.alerts} 需注意 · ${c.pms} PM`
    : `${c.projects} 個專案 · ${c.alerts} 個需要注意 · ${c.pms} 位 PM`
})

// 兩個面板共用 panelOpen（刻意）：切換檢視時收合狀態延續
const open = computed(() => overview.panelOpen)
/** 收合動畫跑完前先別把內容拿掉。 */
const mounted = useDelayedUnmount(open, PANEL_UNMOUNT_MS)

function toggle(): void {
  overview.panelOpen = !overview.panelOpen
}

/**
 * 展開「而且」grid-template-rows 過渡跑完，才放行 overflow。
 * 過渡中要裁切，內容才會被裁成動畫高度。用 clip 不用 hidden：hidden 會讓 .panel-clip 成為捲動容器，
 * 黏住的泳道標頭、時間軸尺規改以它為基準，收合第一幀就彈回原位（動畫稽核 C7 B）；clip 一樣裁切，但不建立捲動容器。
 * 展開跑完照舊放行 visible，不裁切展開後的內容。
 */
const settled = ref(true)
let settleTimer: ReturnType<typeof setTimeout> | undefined
watch(open, () => {
  settled.value = false
  clearTimeout(settleTimer)
  // 保險：transitionend 沒來（例如使用者關閉動畫）時，時間到也當作跑完，免得一直裁切
  settleTimer = setTimeout(() => {
    settled.value = true
  }, PANEL_UNMOUNT_MS)
})
const clipOverflow = computed(() => (open.value && settled.value ? 'visible' : 'clip'))

function onBodyTransitionEnd(e: TransitionEvent): void {
  // 內層的速覽也用 grid-template-rows 過渡，事件會冒泡上來；只認 .panel-body 自己的
  if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return
  clearTimeout(settleTimer)
  settled.value = true
}

/** 標題列高度：看板欄首與時間軸尺規 sticky 在它下方。chip 增減會讓標題列換行，所以持續量。 */
const headH = ref(0)
let ro: ResizeObserver | undefined
function measure(): void {
  headH.value = head.value?.offsetHeight ?? 0
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && head.value) {
    ro = new ResizeObserver(() => measure())
    ro.observe(head.value)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  clearTimeout(settleTimer)
})
</script>

<template>
  <section
    ref="root"
    class="panel"
    :class="{ 'is-off': !open }"
    :data-view-panel="view"
    :style="{ '--ov-head': headH + 'px' }"
  >
    <div ref="head" class="panel-head">
      <h2 class="panel-title">{{ title }}</h2>
      <span class="panel-count" data-testid="overview-count">{{ countText }}</span>
      <slot name="head" />
      <!-- 右端一組：窄螢幕換行時整組仍靠右（spacer 會留在上一行，推不動換行後的按鈕） -->
      <div class="panel-tail">
        <slot name="head-extra" />
        <button
          type="button"
          class="panel-toggle"
          :aria-expanded="open"
          :aria-label="open ? '收合面板' : '展開面板'"
          :title="open ? '收合面板' : '展開面板'"
          @click="toggle"
        >
          <span class="panel-caret" aria-hidden="true">▲</span>
        </button>
      </div>
    </div>
    <div
      class="panel-body"
      :style="{ gridTemplateRows: open ? '1fr' : '0fr' }"
      @transitionend="onBodyTransitionEnd"
    >
      <div class="panel-clip" :style="{ overflow: clipOverflow }"><slot v-if="mounted" /></div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-panel);
}

.panel-head {
  position: sticky;
  top: var(--ov-top, 0px);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: var(--sp-6);
  flex-wrap: wrap;
  padding: var(--pad-panel-head);
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-1);
  border-radius: var(--r-panel) var(--r-panel) 0 0;
  /* 逼出合成層，避免 sticky 標題在捲動時閃爍（同 PanelShell） */
  transform: translateZ(0);
  backface-visibility: hidden;
  transition:
    border-bottom-color var(--t-panel) var(--ease),
    border-radius var(--t-panel) var(--ease);
}

.panel.is-off .panel-head {
  border-bottom-color: transparent;
  border-radius: var(--r-panel);
}

.panel-title {
  margin: 0;
  font-size: var(--fs-panel);
  font-weight: var(--fw-bold);
}

.panel-count {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.panel-tail {
  display: flex;
  align-items: center;
  gap: var(--sp-6);
  margin-left: auto;
}

.panel-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--ctrl-h);
  height: var(--ctrl-h);
  padding: 0;
  border: 1px solid var(--border-1);
  border-radius: var(--r-control);
  background: var(--surface-1);
  color: var(--text-muted);
  font: inherit;
  font-size: var(--fs-micro);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方（本檔其他 hover 同理） */
@media (hover: hover) {
  .panel-toggle:hover {
    background: var(--surface-3);
    color: var(--text-1);
  }
}

.panel-toggle:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* 單一圖示旋轉，不換字元（A24） */
.panel-caret {
  display: inline-block;
  transition: transform var(--t-layout) var(--ease);
}

.panel.is-off .panel-caret {
  transform: rotate(180deg);
}

.panel-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  transition: grid-template-rows var(--t-panel) var(--ease);
}

.panel-clip {
  min-height: 0;
  min-width: 0;
}
</style>
