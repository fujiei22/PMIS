<script setup lang="ts">
// 總覽面板標題列的排序控制：已套用的排序 chips ＋「⇅ 排序」選單，讀寫 overview store 的 sorts。
import { computed, ref } from 'vue'
import { freezeLeave } from '@/composables/freezeLeave'
import { useDismiss } from '@/composables/useDismiss'
import { OVERVIEW_SORT_KEYS } from '@/constants/overview'
import { bumpSort } from '@/lib/sort'
import { useOverviewStore } from '@/stores/overview'

const overview = useOverviewStore()

// 卡片與時間軸的面板同時只顯示一個，所以共用同一個下拉 key
const open = computed(() => overview.openDropdown === 'sort')

const arrowOf = (dir: 'asc' | 'desc'): string => (dir === 'asc' ? '↑' : '↓')

/** 某個鍵第一次被加進排序時的方向；直接問 lib 的 bumpSort，不另抄一份「日期類 asc」規則。 */
function defaultDir(k: string): 'asc' | 'desc' {
  return bumpSort([], k)[0]!.dir
}

const chips = computed(() =>
  overview.sorts.map((s, i) => {
    const def = OVERVIEW_SORT_KEYS.find((d) => d.k === s.k)
    return {
      k: s.k,
      level: i + 1,
      label: def?.label ?? s.k,
      desc: s.dir === 'desc',
      title: `${def?.label ?? s.k} ${def ? def.dirLabel[s.dir] : ''}`.trim(),
    }
  }),
)

const options = computed(() =>
  OVERVIEW_SORT_KEYS.map((d) => {
    const i = overview.sorts.findIndex((s) => s.k === d.k)
    const cur = i >= 0 ? overview.sorts[i]! : undefined
    // 還沒套用的鍵顯示「點下去會是哪個方向」，已套用的顯示目前方向
    const dir = cur?.dir ?? defaultDir(d.k)
    return {
      k: d.k,
      label: d.label,
      on: !!cur,
      dirLabel: d.dirLabel[dir],
      badge: cur ? `${i + 1} ${arrowOf(cur.dir)}` : '',
    }
  }),
)

/** 清除排序＝回預設，並關掉選單。 */
function reset(): void {
  overview.resetSort()
  overview.closeDropdown()
}

const menuRoot = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
useDismiss(
  menuRoot,
  () => open.value,
  () => overview.closeDropdown(),
  trigger,
)
</script>

<template>
  <div class="sort-bar">
    <TransitionGroup name="ov-chip" tag="div" class="sorts" @before-leave="freezeLeave">
      <span v-for="c in chips" :key="c.k" class="sort-chip-wrap">
        <button type="button" class="sort-chip" :title="c.title" @click="overview.bumpSort(c.k)">
          <span class="chip-level">{{ c.level }}</span>
          <span class="chip-label">{{ c.label }}</span>
          <span class="chip-arrow" :class="{ desc: c.desc }" aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          class="chip-x"
          aria-label="移除這層排序"
          title="移除這層排序"
          @click.stop="overview.dropSort(c.k)"
        >
          ✕
        </button>
      </span>
    </TransitionGroup>

    <div ref="menuRoot" class="sort-dd" :class="{ 'is-open': open }">
      <button
        ref="trigger"
        type="button"
        class="sort-trigger"
        :aria-expanded="open"
        @click="overview.toggleDropdown('sort')"
      >
        <span class="sort-icon" aria-hidden="true">⇅</span><span>排序</span>
      </button>
      <Transition name="ov-pop">
        <div v-if="open" class="sort-menu">
          <div class="sort-hint">依序點選排序層級，再點一次翻方向</div>
          <button
            v-for="o in options"
            :key="o.k"
            type="button"
            class="sort-option"
            :class="{ on: o.on }"
            @click="overview.bumpSort(o.k)"
          >
            <span class="sort-option-label">{{ o.label }}</span>
            <span class="sort-dir">{{ o.dirLabel }}</span>
            <span class="sort-badge">{{ o.badge }}</span>
          </button>
          <button v-if="overview.sorts.length" type="button" class="sort-clear" @click="reset()">
            清除排序
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.sort-bar {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  flex-wrap: wrap;
  min-width: 0;
}

/* freezeLeave 以這層為基準釘住離場的 chip */
.sorts {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  flex-wrap: wrap;
  min-width: 0;
}

/* chip 與 ✕ 是兄弟按鈕（按鈕不能巢狀）；✕ 疊在 chip 右端，外觀同 B2 的單一 chip */
.sort-chip-wrap {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

.sort-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--r-badge);
  height: 28px;
  /* 右側留出 ✕（18px）＋ 間距的位置 */
  padding: 0 calc(var(--sp-2) + 18px + var(--r-badge)) 0 7px;
  border-radius: var(--r-pill);
  background: var(--accent-tint-1);
  border: 1px solid var(--accent-tint-3);
  font: inherit;
  font-size: var(--fs-meta);
  color: var(--accent-hover);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.sort-chip-wrap:hover .sort-chip {
  background: var(--accent-tint-2);
}

.sort-chip:focus-visible,
.chip-x:focus-visible,
.sort-trigger:focus-visible,
.sort-option:focus-visible,
.sort-clear:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.chip-level {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--surface-1);
  font-family: var(--font-mono);
  font-size: var(--fs-10);
  font-weight: var(--fw-bold);
  line-height: 1;
}

/* 箭頭固定是 ↑，desc 用旋轉表示，翻方向時才有轉動（A21） */
.chip-arrow {
  display: inline-block;
  font-size: var(--fs-caption);
  font-weight: var(--fw-bold);
  transition: transform var(--t-base) var(--ease);
}

.chip-arrow.desc {
  transform: rotate(180deg);
}

.chip-x {
  position: absolute;
  top: 50%;
  right: var(--sp-2);
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--accent-tint-2);
  color: var(--accent-hover);
  font: inherit;
  font-size: var(--fs-weekday);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.chip-x:hover {
  background: var(--accent);
  color: var(--surface-1);
}

.sort-dd {
  position: relative;
  flex: 0 0 auto;
}

.sort-trigger {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: var(--ctrl-h);
  padding: 0 var(--sp-6);
  font: inherit;
  font-size: var(--fs-control);
  border: 1px dashed var(--border-control);
  border-radius: var(--r-pill);
  color: var(--text-muted);
  background: var(--surface-1);
  cursor: pointer;
  white-space: nowrap;
  transition:
    border-color var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.sort-trigger:hover,
.sort-dd.is-open .sort-trigger {
  border-color: var(--text-placeholder);
  color: var(--text-2);
}

.sort-icon {
  font-size: var(--fs-caption);
}

.sort-menu {
  position: absolute;
  top: calc(var(--ctrl-h) + var(--sp-1));
  left: 0;
  z-index: 100;
  min-width: 208px;
  padding: var(--sp-2);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
}

.sort-hint {
  font-size: var(--fs-date);
  color: var(--text-muted);
  padding: var(--sp-2) var(--sp-4) var(--r-badge);
  white-space: nowrap;
}

.sort-option {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  width: 100%;
  height: var(--dd-item-h);
  padding: 0 var(--sp-4);
  border: 0;
  border-radius: var(--r-control);
  font: inherit;
  font-size: var(--fs-control);
  color: var(--text-2);
  background: transparent;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
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
  font-size: var(--fs-date);
  color: var(--accent);
  font-family: var(--font-mono);
  font-weight: var(--fw-medium);
  transition: color var(--t-fast) var(--ease);
}

.sort-dir {
  font-size: var(--fs-date);
  color: var(--text-muted);
}

.sort-clear {
  display: block;
  width: 100%;
  margin-top: var(--sp-1);
  border: 0;
  border-top: 1px solid var(--border-hair);
  border-radius: 0;
  background: transparent;
  padding: var(--sp-4) var(--sp-4) var(--sp-2);
  font: inherit;
  font-size: var(--fs-meta);
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.sort-clear:hover {
  color: var(--danger-text);
}
</style>
