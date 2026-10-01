<script setup lang="ts">
// 面板頭上的排序 chip：層級數字 + 欄位名 + 方向箭頭 + 移除鈕。
// legacy 對照：sortChips :2118、模板看板 :538-545 / Issue :664-671。
import { computed } from 'vue'
import { ISSUE_SORT_KEYS, TASK_SORT_KEYS } from '@/constants/dashboard'
import { useFilterStore } from '@/stores/filter'

const props = defineProps<{ kind: 'task' | 'issue' }>()

const filter = useFilterStore()

const defs = computed<readonly { k: string; label: string }[]>(() =>
  props.kind === 'task' ? TASK_SORT_KEYS : ISSUE_SORT_KEYS,
)

const chips = computed(() =>
  (props.kind === 'task' ? filter.taskSort : filter.issueSort).map((s, i) => ({
    k: s.k,
    // 第幾層排序，1 起算
    level: i + 1,
    label: defs.value.find((d) => d.k === s.k)?.label ?? s.k,
    arrow: s.dir === 'asc' ? '↑' : '↓',
  })),
)

/** 點 chip 本身 → 翻方向。legacy :2124 */
function bump(k: string): void {
  if (props.kind === 'task') filter.bumpTaskSort(k)
  else filter.bumpIssueSort(k)
}

/** 點 ✕ → 移掉這一層。legacy :2125 */
function drop(k: string): void {
  if (props.kind === 'task') filter.dropTaskSort(k)
  else filter.dropIssueSort(k)
}
</script>

<template>
  <!--
    加 / 移除一層排序時 chip 原地橫向展開 / 收起（動畫稽核 G6）：後面的觸發鈕跟著版面連續滑動，不是一幀跳過去。
    TransitionGroup 不給 tag 就不產生外層元素：每個 chip 的 slot 直接排在父層（看板 .sorts / Issue .tools）的 flex 裡，
    DOM 順序與文字不變（compare.spec 依 DOM 順序比標題列文字）。
    每個 chip 外面兩層：.sort-chip-slot 是單欄 grid，欄寬 0fr ↔ 1fr 補間；.sort-chip-clip 是裁切層，
    min-width: 0 讓欄寬能收到 0（chip 本身有 padding / border，收不到 0）。
  -->
  <TransitionGroup name="chip">
    <div v-for="c in chips" :key="c.k" class="sort-chip-slot">
      <div class="sort-chip-clip">
        <div
          class="sort-chip"
          role="button"
          :title="`${c.label} ${c.arrow}`"
          @click.stop="bump(c.k)"
        >
          <span class="chip-level">{{ c.level }}</span>
          <span class="chip-label">{{ c.label }}</span>
          <span class="chip-arrow">{{ c.arrow }}</span>
          <span class="chip-x" role="button" title="移除這層排序" @click.stop="drop(c.k)">✕</span>
        </div>
      </div>
    </div>
  </TransitionGroup>
</template>

<style scoped>
/*
 * 平常的欄寬寫在 :where() 裡（scoped 的屬性選擇器也編進 :where()，特異度 0）：
 * 下面進出場的 .chip-enter-from / .chip-leave-to（scoped 後 0,2,0）不論寫在前面後面都蓋得過它。
 */
:where(.sort-chip-slot) {
  display: grid;
  grid-template-columns: 1fr;
  flex: 0 0 auto;
}

.sort-chip-clip {
  display: flex;
  min-width: 0;
}

/*
 * 進出場：欄寬 0fr ↔ 1fr、透明度 0 ↔ 1，時長 --t-panel、曲線 --ease。
 * 寬度 0 時連父層的 flex gap（--sorts-gap，看板 .sorts / Issue .tools 提供）一起用負的右邊界抵掉，
 * 插入 / 移除當幀觸發鈕不會先跳一個 gap。過渡都寫在 slot 自己身上：Vue 只等 slot 本身的 transitionend（子元素冒上來的不算）。
 */
.chip-enter-active,
.chip-leave-active {
  transition:
    grid-template-columns var(--t-panel) var(--ease),
    margin-right var(--t-panel) var(--ease),
    opacity var(--t-panel) var(--ease);
}

/* 離場中不攔點擊（同 base.css 的 pop-leave-active） */
.chip-leave-active {
  pointer-events: none;
}

.chip-enter-from,
.chip-leave-to {
  grid-template-columns: 0fr;
  margin-right: calc(-1 * var(--sorts-gap, 0px));
  opacity: 0;
}

/*
 * 只在過渡中裁切：平常不裁，觸控時 ✕ 的外擴熱區（::after）才不會被切掉。
 * 用 clip 不用 hidden：hidden 會讓它變成捲動容器。
 */
.chip-enter-active .sort-chip-clip,
.chip-leave-active .sort-chip-clip {
  overflow: clip;
}

.sort-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--r-badge);
  height: 26px;
  padding: 0 var(--sp-2) 0 7px;
  border-radius: var(--r-pill);
  background: var(--accent-tint-1);
  border: 1px solid var(--accent-tint-3);
  font-size: var(--fs-meta);
  color: var(--accent-hover);
  cursor: pointer;
  white-space: nowrap;
  flex: 0 0 auto;
}

.sort-chip:hover {
  background: var(--accent-tint-2);
}

.chip-level {
  font-size: var(--fs-10);
  font-weight: var(--fw-bold);
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--surface-1);
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  text-align: center;
}

.chip-arrow {
  font-size: var(--fs-caption);
  font-weight: var(--fw-bold);
}

.chip-x {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent-tint-2);
  color: var(--accent-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-weekday);
}

.chip-x:hover {
  background: var(--accent);
  color: var(--surface-1);
}

/* 手指操作：✕ 只有 16px，用看不見的外擴熱區 */
@media (pointer: coarse) {
  .chip-x {
    position: relative;
  }

  .chip-x::after {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--sp-3));
  }
}
</style>
