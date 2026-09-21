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
  <div
    v-for="c in chips"
    :key="c.k"
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
</template>

<style scoped>
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
</style>
