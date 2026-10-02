<script setup lang="ts">
// 總覽面板標題列的排序控制：已套用的排序 chips ＋「⇅ 排序」選單，讀寫 overview store 的 sorts。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useDismiss } from '@/composables/useDismiss'
import { OVERVIEW_SORT_KEYS } from '@/constants/overview'
import { parseDuration, parseEasing } from '@/lib/easing'
import { OVERVIEW_SORT_DEFAULT_DIR, type OverviewSortKey } from '@/lib/portfolio'
import { useOverviewStore } from '@/stores/overview'

const overview = useOverviewStore()

// 卡片與時間軸的面板同時只顯示一個，所以共用同一個下拉 key
const open = computed(() => overview.openDropdown === 'sort')

const arrowOf = (dir: 'asc' | 'desc'): string => (dir === 'asc' ? '↑' : '↓')

/** 某個鍵第一次被加進排序時的方向（總覽自己的預設，見 lib/portfolio.ts）。 */
function defaultDir(k: OverviewSortKey): 'asc' | 'desc' {
  return OVERVIEW_SORT_DEFAULT_DIR[k]
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

const bar = ref<HTMLElement | null>(null)
const menuRoot = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)

/**
 * 選單的位置：開啟當下觸發鈕在定位基準 .sort-bar 裡的位置（左緣、右緣到 .sort-bar 右緣的距離、上緣），開著期間不再更新。
 * 選單開著時加一層排序，chip 原地展開、排序鈕往右滑；選單錨在排序鈕上會被帶著跑，游標下的選項跟著跑掉
 * （動畫稽核 T6 / T7，同 Dashboard 的 SortMenu）。關了再開才到排序鈕的新位置。
 * pre：在 DOM 更新前量，選單一畫出來就在對的位置。
 */
const anchor = ref({ left: 0, right: 0, top: 0 })
watch(
  open,
  (isOpen) => {
    if (!isOpen || !trigger.value || !bar.value) return
    const t = trigger.value.getBoundingClientRect()
    const b = bar.value.getBoundingClientRect()
    anchor.value = { left: t.left - b.left, right: b.right - t.right, top: t.top - b.top }
  },
  { flush: 'pre' },
)
const menuStyle = computed(() => ({
  '--menu-x': `${anchor.value.left}px`,
  '--menu-r': `${anchor.value.right}px`,
  '--menu-y': `${anchor.value.top}px`,
}))

/** 選單離視窗右緣至少留這麼多。 */
const MENU_EDGE = 8
/**
 * 往右展開會超出視窗時（平板直向時排序鈕在標題列右半），改成對齊按鈕右緣、往左展開。
 * post：選單掛上後才量得到寬度；改對齊會在同一輪更新裡重畫，畫面上看不到先超出再縮回。
 */
const alignEnd = ref(false)
watch(
  open,
  (isOpen) => {
    if (!isOpen || !trigger.value || !menu.value) return
    const left = trigger.value.getBoundingClientRect().left
    alignEnd.value =
      left + menu.value.offsetWidth > document.documentElement.clientWidth - MENU_EDGE
  },
  { flush: 'post' },
)

/**
 * 平板直向（≤ 899px）的 .sorts 是橫向捲動容器：新加的一層排序排在最後，常常在可見範圍外（動畫稽核 T15）。
 * chip 原地展開期間逐幀把 .sorts 捲到「剛好看得到這顆 chip」的位置：從原本的捲動位置照 --t-panel / --ease 補間過去，
 * 目標每幀用 chip 當下的位置重算（chip 還在變寬），最後一幀整顆 chip 都在可見範圍內。桌機不是捲動容器，不做。
 * TransitionGroup 的 enter hook 只收一個參數：Vue 照樣自己偵測 CSS 過渡結束。
 */
let revealRaf: number | undefined

function stopReveal(): void {
  if (revealRaf !== undefined) cancelAnimationFrame(revealRaf)
  revealRaf = undefined
}

function revealChip(el: Element): void {
  const box = el.parentElement
  if (!box || typeof requestAnimationFrame !== 'function') return
  if (getComputedStyle(box).overflowX === 'visible') return
  const cs = getComputedStyle(document.documentElement)
  const duration = parseDuration(cs.getPropertyValue('--t-panel'))
  const ease = parseEasing(cs.getPropertyValue('--ease'))
  // 前後各留 padding 的寬度：.sorts 用 padding 留給 focus 光圈（見下方樣式），捲到 chip 貼邊會切到光圈
  const pad = parseFloat(getComputedStyle(box).paddingLeft) || 0
  const start = box.scrollLeft
  const t0 = performance.now()
  stopReveal()
  const step = (): void => {
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    // chip 在捲動內容裡的左右緣（padding box 座標）
    const left = r.left - b.left - box.clientLeft + box.scrollLeft
    const right = left + r.width
    let target = start
    if (right + pad > target + box.clientWidth) target = right + pad - box.clientWidth
    if (left - pad < target) target = left - pad
    target = Math.min(Math.max(target, 0), box.scrollWidth - box.clientWidth)
    const p = duration ? Math.min(1, (performance.now() - t0) / duration) : 1
    box.scrollLeft = start + (target - start) * ease(p)
    revealRaf = p < 1 && el.isConnected ? requestAnimationFrame(step) : undefined
  }
  revealRaf = requestAnimationFrame(step)
}

onBeforeUnmount(stopReveal)

useDismiss(
  menuRoot,
  () => open.value,
  () => overview.closeDropdown(),
  trigger,
)
</script>

<template>
  <div ref="bar" class="sort-bar">
    <!--
      加 / 移除一層排序時 chip 原地橫向展開 / 收起（動畫稽核 T7；ov-chip，見 overview-motion.css）：
      排序鈕跟著版面逐幀滑動、不會蓋到收到一半的 chip；兩個 chip 一起離場時 .sorts 也不會塌成 0 高。
      每顆外面兩層：.ov-slot（欄寬 0fr ↔ 1fr）、.ov-slot-clip（進出場時裁切）。
    -->
    <TransitionGroup name="ov-chip" tag="div" class="sorts" @enter="revealChip">
      <span v-for="c in chips" :key="c.k" class="ov-slot sort-slot">
        <span class="ov-slot-clip">
          <span class="sort-chip-wrap">
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
        </span>
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
      <!-- 進出場用 base.css 的 pop（動畫稽核 T12） -->
      <Transition name="pop">
        <div v-if="open" ref="menu" class="sort-menu" :class="{ 'align-end': alignEnd }" :style="menuStyle">
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
/* 排序選單的定位基準（選單位置在開啟時量好，見 anchor） */
.sort-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  flex-wrap: wrap;
  min-width: 0;
}

.sorts {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  flex-wrap: wrap;
  min-width: 0;
}

/* chip 之間隔著 .sorts 的 flex gap：寬度 0 時用負右邊界抵掉，插入 / 移除當幀排序鈕不先跳一個 gap */
.sort-slot {
  --ov-slot-mr0: calc(-1 * var(--r-badge));
}

/*
 * 平板直向：標題列要維持一行，chips 不換行，放不下時在原地左右滑。
 * flex-basis 0：標題列是 flex-wrap，basis 照內容寬的話整組會先被擠到下一行，輪不到縮小。
 * 捲動容器會裁掉 focus 光圈，四周用 padding 留出光圈的位置、再用負 margin 抵掉。
 */
@media (max-width: 899px) {
  .sort-bar {
    flex: 1 1 0;
    flex-wrap: nowrap;
  }

  .sorts {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding: var(--sp-1);
    margin: calc(-1 * var(--sp-1));
    scrollbar-width: none;
  }

  .sorts::-webkit-scrollbar {
    display: none;
  }
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

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方（本檔其他 hover 同理） */
@media (hover: hover) {
  .sort-chip-wrap:hover .sort-chip {
    background: var(--accent-tint-2);
  }
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

@media (hover: hover) {
  .chip-x:hover {
    background: var(--accent);
    color: var(--surface-1);
  }
}

/* 手指操作：✕ 只有 18px，緊貼著點了會翻方向的 chip 本體；用看不見的外擴熱區（同 SortChips） */
@media (pointer: coarse) {
  .chip-x::after {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--sp-3));
  }
}

/* 不是定位基準：選單以 .sort-bar 為基準，位置在開啟時量好（--menu-x / --menu-r / --menu-y） */
.sort-dd {
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

.sort-dd.is-open .sort-trigger {
  border-color: var(--text-placeholder);
  color: var(--text-2);
}

@media (hover: hover) {
  .sort-trigger:hover {
    border-color: var(--text-placeholder);
    color: var(--text-2);
  }
}

.sort-icon {
  font-size: var(--fs-caption);
}

.sort-menu {
  position: absolute;
  top: calc(var(--menu-y) + var(--ctrl-h) + var(--sp-1));
  left: var(--menu-x);
  z-index: 100;
  min-width: 208px;
  padding: var(--sp-2);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
}

.sort-menu.align-end {
  left: auto;
  right: var(--menu-r);
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

@media (hover: hover) {
  .sort-option:hover {
    background: var(--surface-3);
  }
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

@media (hover: hover) {
  .sort-clear:hover {
    color: var(--danger-text);
  }
}
</style>
