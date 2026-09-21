<script setup lang="ts">
// 三個面板（甘特 / 看板 / Issue）共用的外殼：sticky 標題列 + 可收合的內容區。
import { computed, ref, watch } from 'vue'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'
import { useDomRegistry, type ElRef } from '@/composables/useDomRegistry'
import { useStickyOffsetsContext } from '@/composables/useStickyOffsets'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  /** 面板 key，同時當 `data-panel` 的值。 */
  panel: 'gantt' | 'kanban' | 'issues'
}>()

const ui = useUiStore()
const sticky = useStickyOffsetsContext()
const registry = useDomRegistry()

const headEl = ref<HTMLElement | null>(null)
watch(headEl, (el) => sticky.observe(props.panel, el), { immediate: true })

/** 面板外殼登錄進 `panels`，頂部列的捷徑靠它捲動（契約 F）。 */
function registerPanel(el: ElRef): void {
  if (el instanceof HTMLElement) registry.panels.set(props.panel, el)
  else if (registry.panels.get(props.panel)?.isConnected === false) {
    registry.panels.delete(props.panel)
  }
}

const open = computed(() => !ui.panelOff[props.panel])
/** 收合動畫（grid-template-rows .26s）跑完前先別把內容拿掉。legacy `held()` :3651 */
const mounted = useDelayedUnmount(open, 320)
/** 展開時放行 overflow，讓甘特的浮層與陰影不被切掉。legacy `ganttClip` :3641 */
const clip = computed(() => (open.value ? 'visible' : 'hidden'))
const caret = computed(() => (open.value ? '▲' : '▼'))

function toggle(): void {
  ui.panelOff[props.panel] = open.value
}
</script>

<template>
  <section :ref="registerPanel" class="panel" :data-panel="panel">
    <div ref="headEl" class="panel-head" :style="{ top: `${sticky.panelTop.value}px` }">
      <slot name="head" />
      <div class="panel-toggle" role="button" :title="open ? '收合面板' : '展開面板'" @click="toggle">
        {{ caret }}
      </div>
    </div>
    <div class="panel-body" :style="{ gridTemplateRows: open ? '1fr' : '0fr' }">
      <div class="panel-clip" :style="{ overflow: clip }">
        <slot v-if="mounted" />
      </div>
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
  display: flex;
  align-items: center;
  gap: var(--sp-6);
  padding: var(--pad-panel-head);
  border-bottom: 1px solid var(--border-1);
  flex-wrap: wrap;
  background: var(--surface-1);
  border-radius: var(--r-panel) var(--r-panel) 0 0;
  position: sticky;
  z-index: 30;
  /* legacy 用 translateZ(0) 逼出合成層，避免 sticky 標題在捲動時閃爍（:388） */
  transform: translateZ(0);
  backface-visibility: hidden;
}

.panel-toggle {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-1);
  border-radius: var(--r-control);
  cursor: pointer;
  color: var(--text-muted);
  font-size: var(--fs-micro);
}

.panel-toggle:hover {
  background: var(--surface-3);
  color: var(--text-1);
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
