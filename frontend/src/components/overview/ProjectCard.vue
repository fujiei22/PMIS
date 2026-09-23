<script setup lang="ts">
// 總覽的專案卡：名稱、狀態 pill、排序依據的 meta、實際進度、「進入」；點整張卡展開速覽。
// 模板：整張卡可點展開是需求優先，所以 role="button" 裡面包了「進入」連結（巢狀互動元素，照 B2 保留）。
// 「進入」自帶 @click.stop，速覽外殼也擋掉冒泡，兩者都不會觸發展開切換。
import { computed, ref } from 'vue'
import EnterLink from '@/components/overview/EnterLink.vue'
import ProjectBadge from '@/components/overview/ProjectBadge.vue'
import QuickView from '@/components/overview/QuickView.vue'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'
import { BADGE_CLASS, PANEL_UNMOUNT_MS } from '@/constants/overview'
import { gapTone, type ProjectRow } from '@/lib/portfolio'
import { useOverviewStore } from '@/stores/overview'

const props = defineProps<{ row: ProjectRow }>()

const overview = useOverviewStore()

const p = computed(() => props.row.p)
const d = computed(() => props.row.d)

const root = ref<HTMLElement | null>(null)

const open = computed(() => overview.isExpanded(p.value.id))
/** 收合動畫跑完再卸載速覽內容，高度才收得平順。 */
const mounted = useDelayedUnmount(open, PANEL_UNMOUNT_MS)

function toggle(): void {
  overview.toggleExpanded(p.value.id)
}

function onKey(e: KeyboardEvent): void {
  // 只認卡片本身的焦點；焦點在「進入」上按 Enter 是要導頁，不該同時展開
  if (e.target !== e.currentTarget) return
  if (e.key !== 'Enter' && e.key !== ' ') return
  // Space 不擋的話頁面會跟著捲動
  e.preventDefault()
  toggle()
}

/**
 * A28：速覽的高度過渡跑完後，把卡片捲到看得見的地方。
 * 要等過渡結束才量得到最終高度；scroll-margin-top 已預留 sticky 標題列與欄首的高度。
 */
function onQuickTransitionEnd(e: TransitionEvent): void {
  // 速覽裡面的淡入等過渡也會冒泡上來，只認外殼自己的高度過渡
  if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return
  const el = root.value
  if (!el) return
  if (open.value) {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    return
  }
  // 收合後內容變短，卡頭可能已經被捲到 sticky 層後面或畫面上方，拉回來
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
  if (el.getBoundingClientRect().top < margin) el.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <article
    ref="root"
    class="card"
    :class="['card-' + BADGE_CLASS[d.badge], { 'is-open': open }]"
    :data-project="p.id"
    tabindex="0"
    role="button"
    :aria-expanded="open"
    @click="toggle"
    @keydown="onKey"
  >
    <div class="card-head">
      <svg class="caret card-caret" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M2.5 4.5 6 8l3.5-3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <h3 class="card-name">{{ p.name }}</h3>
      <ProjectBadge :kind="d.badge" />
    </div>
    <div class="card-meta">
      <span class="meta-gap" :class="gapTone(d.gap)">落後 {{ d.gap }} 個百分點</span><span class="sep">·</span>
      <span>到期 <b>{{ p.dueDate }}</b></span><span class="sep">·</span>
      <span>Issue <b>{{ d.openIssueTotal }}</b></span>
    </div>
    <div class="progress">
      <div class="hero">{{ d.actualPct }}<span class="hero-unit">%</span></div>
      <div
        class="track"
        role="progressbar"
        :aria-valuenow="d.actualPct"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="實際進度"
      >
        <div class="fill fill-actual" :style="{ width: d.actualPct + '%' }"></div>
      </div>
      <EnterLink :id="p.id" />
    </div>
    <!-- 外殼常駐 DOM，只切 grid-template-rows，高度才有過渡可跑（A2） -->
    <div
      class="quick-wrap"
      :style="{ gridTemplateRows: open ? '1fr' : '0fr' }"
      @click.stop
      @transitionend="onQuickTransitionEnd"
    >
      <div class="quick-clip">
        <Transition name="ov-fade" appear>
          <QuickView v-if="mounted" :row="row" />
        </Transition>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* 沿用看板卡：白底、1px 邊框、hover 邊框轉色＋陰影＋上浮 1px（A1，照 TaskCard） */
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-panel);
  padding: var(--pad-card);
  cursor: pointer;
  /* 展開後捲到看得見時，要避開 sticky 的面板標題列與欄首（56px 是 B2 .col-head 的高度） */
  scroll-margin-top: calc(var(--ov-top, 0px) + var(--ov-head, 0px) + 56px);
  /*
   * hover 上浮用獨立的 translate 屬性，不用 transform：transform 留給欄內重排（useRelativeFlip），
   * 兩者寫在同一個屬性會互相覆蓋，重排時卡片會先跳位再飄回來。
   */
  transition:
    border-color var(--t-base) var(--ease),
    box-shadow var(--t-base) var(--ease),
    translate var(--t-base) var(--ease);
}

.card:hover {
  border-color: var(--text-placeholder);
  box-shadow: var(--shadow-card-hover);
  translate: 0 -1px;
}


.card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* 狀態淡底色：落後 / 需注意（不用左側彩色 border 條） */
.card-late {
  background: var(--bg-late);
  border-color: var(--danger-bd);
}

.card-paused {
  background: var(--ist-paused-bg);
  border-color: var(--ist-paused-bd);
}

/* 展開中：整張卡換成 PM 色外框（--pm-frame 由 PmColumn 提供），框線切換用較短的 --t-fast */
.card.is-open,
.card.is-open:hover {
  border-color: var(--pm-frame);
  box-shadow: 0 0 0 1px var(--pm-frame);
  transition:
    border-color var(--t-base) var(--ease),
    box-shadow var(--t-fast) var(--ease),
    translate var(--t-base) var(--ease);
}

.card.is-open:focus-visible {
  box-shadow:
    0 0 0 1px var(--pm-frame),
    var(--ring-focus);
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-5);
}

/* 標題前的箭頭只是提示：收合朝右、展開朝下（A2） */
.card-caret {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  align-self: center;
  color: var(--text-3);
  transform: rotate(-90deg);
  transition:
    transform var(--t-layout) var(--ease),
    color var(--t-fast) var(--ease);
}

.card.is-open .card-caret {
  transform: none;
  color: var(--pm-ink);
}

.card-name {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-dialog);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  color: var(--text-1);
}

/* 排序鍵直接寫在卡上：落後百分點 · 到期日 · Issue，看得出排序為什麼是這個順序 */
.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin-top: calc(var(--sp-2) * -1);
  font-size: var(--fs-meta);
  color: var(--text-3);
}

.card-meta b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-medium);
  color: var(--text-2);
}

.card-meta .sep {
  color: var(--text-placeholder);
}

.meta-gap.behind {
  color: var(--danger-text);
  font-weight: var(--fw-bold);
}

.meta-gap.warn {
  color: var(--ist-paused-fg);
  font-weight: var(--fw-bold);
}

.meta-gap.flat {
  color: var(--text-muted);
}

/* 實際進度：大數字 + 進度條 + 「進入」，條色跟狀態走 */
.progress {
  display: flex;
  align-items: center;
  gap: var(--sp-6);
}

.hero {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-hero);
  font-weight: var(--fw-medium);
  line-height: 1;
  color: var(--text-1);
}

.hero-unit {
  padding-left: 1px;
  font-size: var(--fs-control);
  color: var(--text-muted);
}

.track {
  flex: 1;
  height: var(--sp-4);
  border-radius: var(--r-4);
  background: var(--border-1);
  overflow: hidden;
}

/* 背景重載後進度改變時，條寬用過渡帶過去（A30） */
.fill {
  height: 100%;
  border-radius: inherit;
  transition: width var(--t-progress) var(--ease);
}

.card-late .fill-actual {
  background: var(--st-delayed-bar);
}

.card-paused .fill-actual {
  background: var(--st-paused-bar);
}

.card-doing .fill-actual {
  background: var(--st-doing-bar);
}

/* B2 沒有未開始的卡，比照 QuickView 的 .fill-todo 補上 */
.card-todo .fill-actual {
  background: var(--st-todo-bar);
}

.card-done .fill-actual {
  background: var(--st-done-bar);
}

/* 「進入」放在進度列右端，不獨佔一列 */
.progress :deep(.btn-enter) {
  flex: 0 0 auto;
  margin-left: var(--sp-4);
}

/* 速覽：grid-template-rows 0fr ↔ 1fr 做高度過渡（A2），值由 inline style 切 */
.quick-wrap {
  display: grid;
  cursor: default;
  transition: grid-template-rows var(--t-panel) var(--ease);
}

.quick-clip {
  min-height: 0;
  overflow: hidden;
}

/* 速覽上緣分隔線跟卡片色系走；展開中改用 PM 淡色（照 B2 .card-late .quick 等） */
.card-late :deep(.quick) {
  border-top-color: var(--danger-bd);
}

.card-paused :deep(.quick) {
  border-top-color: var(--ist-paused-bd);
}

.card.is-open :deep(.quick) {
  border-top-color: var(--pm-soft);
}
</style>
