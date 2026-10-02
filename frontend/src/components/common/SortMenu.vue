<script setup lang="ts">
// 面板頭上的「⇅ 排序」觸發鈕與它的選單：依序點選排序層級，最後可清除回預設。
// legacy 對照：sortMenu :2129、模板看板 :546-563 / Issue :672-689。
import { computed, ref, watch } from 'vue'
import { ISSUE_SORT_KEYS, TASK_SORT_KEYS } from '@/constants/dashboard'
import { useFilterStore } from '@/stores/filter'
import { useUiStore, type DropdownKey } from '@/stores/ui'

const props = defineProps<{ kind: 'task' | 'issue' }>()

const ui = useUiStore()
const filter = useFilterStore()

const ddKey = computed<DropdownKey>(() => (props.kind === 'task' ? 'ksort' : 'isort'))
const open = computed(() => ui.openDropdown === ddKey.value)
const sorts = computed(() => (props.kind === 'task' ? filter.taskSort : filter.issueSort))

const options = computed(() =>
  (props.kind === 'task' ? TASK_SORT_KEYS : ISSUE_SORT_KEYS).map((d) => {
    const i = sorts.value.findIndex((x) => x.k === d.k)
    return {
      k: d.k,
      label: d.label,
      on: i >= 0,
      // 已套用的欄位在右邊顯示「層級 + 方向」。legacy :2135
      badge: i >= 0 ? `${i + 1} ${sorts.value[i]!.dir === 'asc' ? '↑' : '↓'}` : '',
    }
  }),
)

/**
 * 選單的位置：開啟當下觸發鈕在定位基準（父層 .sorts / .tools，position: relative）裡的位置，開著期間不再更新。
 * 選單開著時加 / 移除一層排序，chip 插在觸發鈕前面、觸發鈕會往右 / 左滑；選單若錨在觸發鈕上會被帶著跑，
 * 游標下的選項跟著跑掉（動畫稽核 G6）。關了再開才到觸發鈕的新位置。
 */
const triggerEl = ref<HTMLElement | null>(null)
const anchor = ref({ x: 0, y: 0 })
watch(
  open,
  (isOpen) => {
    const el = triggerEl.value
    // 定位基準＝觸發鈕的 offsetParent（.sort-dd 不是定位基準，往上找到的就是父層的 .sorts / .tools）
    const base = el?.offsetParent
    if (!isOpen || !el || !base) return
    const t = el.getBoundingClientRect()
    const b = base.getBoundingClientRect()
    anchor.value = { x: t.left - b.left - base.clientLeft, y: t.top - b.top - base.clientTop }
  },
  // 在 DOM 更新前量：選單一畫出來就在對的位置
  { flush: 'pre' },
)
const menuStyle = computed(() => ({
  '--menu-x': `${anchor.value.x}px`,
  '--menu-y': `${anchor.value.y}px`,
}))

/** 點選項 → 加一層或翻方向；選單留著讓人繼續點下一層。legacy :2139 */
function pick(k: string): void {
  if (props.kind === 'task') filter.bumpTaskSort(k)
  else filter.bumpIssueSort(k)
}

/** 清除排序＝回預設（任務時程 asc / Issue 期限 asc），並關掉選單。legacy :3553 / :3579 */
function reset(): void {
  if (props.kind === 'task') filter.resetTaskSort()
  else filter.resetIssueSort()
  ui.openDropdown = null
}
</script>

<template>
  <div class="sort-dd">
    <div
      ref="triggerEl"
      class="sort-trigger"
      data-dd="1"
      role="button"
      @click="ui.toggleDropdown(ddKey)"
    >
      <span class="sort-icon">⇅</span><span>排序</span>
    </div>
    <!-- 進出場用 base.css 的 pop（動畫稽核 G12） -->
    <Transition name="pop">
      <div v-if="open" class="sort-menu" data-dd="1" :style="menuStyle">
        <div class="sort-hint">依序點選排序層級</div>
        <div
          v-for="o in options"
          :key="o.k"
          class="sort-option"
          :class="{ on: o.on }"
          role="button"
          @click.stop="pick(o.k)"
        >
          <span class="sort-option-label">{{ o.label }}</span>
          <span class="sort-badge">{{ o.badge }}</span>
        </div>
        <div v-if="sorts.length" class="sort-clear" role="button" @click.stop="reset()">
          清除排序
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 不是定位基準：選單以父層（.sorts / .tools）為基準，位置在開啟時量好（--menu-x / --menu-y） */
.sort-dd {
  flex: 0 0 auto;
}

.sort-trigger {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 26px;
  padding: 0 var(--sp-5);
  font-size: var(--fs-meta);
  border: 1px dashed var(--border-control);
  border-radius: var(--r-pill);
  color: var(--text-muted);
  background: var(--surface-1);
  cursor: pointer;
  white-space: nowrap;
}

.sort-trigger:hover {
  border-color: var(--text-placeholder);
  color: var(--text-2);
}

.sort-icon {
  font-size: var(--fs-caption);
}

.sort-menu {
  position: absolute;
  top: calc(var(--menu-y) + 30px);
  left: var(--menu-x);
  z-index: 100;
  min-width: 178px;
  padding: var(--sp-2);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
}

.sort-hint {
  font-size: var(--fs-pill);
  color: var(--text-placeholder);
  padding: var(--sp-2) var(--sp-4) var(--r-badge);
}

.sort-option {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: 28px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-control);
  font-size: var(--fs-control);
  color: var(--text-2);
  background: transparent;
  cursor: pointer;
}

.sort-option.on {
  color: var(--accent-hover);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.sort-option:hover {
  background: var(--surface-3);
}

.sort-option-label {
  flex: 1;
}

.sort-badge {
  font-size: var(--fs-pill);
  color: var(--accent);
  font-family: var(--font-mono);
}

.sort-clear {
  margin-top: var(--sp-1);
  border-top: 1px solid var(--border-hair);
  padding: var(--sp-3) var(--sp-4) var(--r-2);
  font-size: var(--fs-meta);
  color: var(--text-muted);
  cursor: pointer;
}

.sort-clear:hover {
  color: var(--danger-text);
}
</style>
