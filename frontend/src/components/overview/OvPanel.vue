<script setup lang="ts">
// 總覽兩種檢視共用的面板外殼：sticky 標題列（標題、計數、排序、收合鈕）＋ 可收合的內容區。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'
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

const countText = computed(
  () =>
    `${overview.counts.projects} 個專案 · ${overview.counts.alerts} 個需要注意 · ${overview.counts.pms} 位 PM`,
)

// 兩個面板共用 panelOpen（刻意）：切換檢視時收合狀態延續
const open = computed(() => overview.panelOpen)
/** 收合動畫跑完前先別把內容拿掉。 */
const mounted = useDelayedUnmount(open, PANEL_UNMOUNT_MS)

function toggle(): void {
  overview.panelOpen = !overview.panelOpen
}

/**
 * 展開「而且」grid-template-rows 過渡跑完，才放行 overflow。
 * 過渡中必須 hidden，內容才會被裁成動畫高度；展開後必須 visible，
 * 否則裡面的 sticky 欄首與尺規會以 clip 層為捲動祖先而失效（PanelShell 同理）。
 */
const settled = ref(true)
let settleTimer: ReturnType<typeof setTimeout> | undefined
watch(open, () => {
  settled.value = false
  clearTimeout(settleTimer)
  // 保險：transitionend 沒來（例如使用者關閉動畫）時，時間到也當作跑完，免得卡在 hidden
  settleTimer = setTimeout(() => {
    settled.value = true
  }, PANEL_UNMOUNT_MS)
})
const clipOverflow = computed(() => (open.value && settled.value ? 'visible' : 'hidden'))

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
      <span class="spacer"></span>
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

.spacer {
  flex: 1;
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

.panel-toggle:hover {
  background: var(--surface-3);
  color: var(--text-1);
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
