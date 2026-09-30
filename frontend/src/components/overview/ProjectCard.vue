<script setup lang="ts">
// 總覽的專案卡：名稱、狀態 pill、排序依據的 meta、實際 / 理論進度、「進入」；點整張卡展開速覽。
// 速覽不在卡片裡：是泳道裡插在這張卡所在列下方的抽屜（LaneDrawer，每條泳道一個），展開時卡片大小不變，只換外框並加一個指向抽屜的箭頭。
// 模板：整張卡可點展開是需求優先，所以 role="button" 裡面包了「進入」連結（巢狀互動元素，照 B2 保留）。
// 「進入」自帶 @click.stop，不會觸發展開切換。
import { computed } from 'vue'
import EnterLink from '@/components/overview/EnterLink.vue'
import PlanActualBar from '@/components/overview/PlanActualBar.vue'
import ProjectBadge from '@/components/overview/ProjectBadge.vue'
import { BADGE_CLASS } from '@/constants/overview'
import { gapTone, type ProjectRow } from '@/lib/portfolio'
import { useOverviewStore } from '@/stores/overview'

const props = defineProps<{
  row: ProjectRow
  /** 同一條泳道的專案 id：展開這張時收起其他張（每條泳道只展開一張）。 */
  laneIds: readonly string[]
}>()

const overview = useOverviewStore()

const p = computed(() => props.row.p)
const d = computed(() => props.row.d)

const open = computed(() => overview.isExpanded(p.value.id))

function toggle(): void {
  overview.toggleExpandedInLane(p.value.id, props.laneIds)
}

function onKey(e: KeyboardEvent): void {
  // 只認卡片本身的焦點；焦點在「進入」上按 Enter 是要導頁，不該同時展開
  if (e.target !== e.currentTarget) return
  if (e.key !== 'Enter' && e.key !== ' ') return
  // Space 不擋的話頁面會跟著捲動
  e.preventDefault()
  toggle()
}
</script>

<template>
  <article
    class="card"
    :class="['card-' + BADGE_CLASS[d.badge], { 'is-open': open }]"
    :data-project="p.id"
    tabindex="0"
    role="button"
    :aria-expanded="open"
    :aria-controls="`lane-qv-${p.pmId}`"
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
      <span class="meta-gap" :class="gapTone(d.gap)">落後 {{ d.gap }}%</span><span class="sep">·</span>
      <span>到期 <b>{{ p.dueDate }}</b></span><span class="sep">·</span>
      <span>Issue <b>{{ d.openIssueTotal }}</b></span>
    </div>
    <div class="progress">
      <div class="hero">{{ d.actualPct }}<span class="hero-unit">%</span></div>
      <PlanActualBar
        class="card-bar"
        :actual="d.actualPct"
        :planned="d.plannedPct"
        :tone="BADGE_CLASS[d.badge]"
      />
      <EnterLink :id="p.id" :name="p.name" variant="edge" />
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
  /*
   * hover 上浮用獨立的 translate 屬性，不用 transform：transform 留給欄內重排（useRelativeFlip），
   * 兩者寫在同一個屬性會互相覆蓋，重排時卡片會先跳位再飄回來。
   */
  transition:
    border-color var(--t-base) var(--ease),
    box-shadow var(--t-base) var(--ease),
    translate var(--t-base) var(--ease);
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方（本檔其他 hover 同理） */
@media (hover: hover) {
  .card:hover {
    border-color: var(--text-placeholder);
    box-shadow: var(--shadow-card-hover);
    translate: 0 -1px;
  }
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

/* 展開中：卡片下緣中央的箭頭指向下方的速覽抽屜（LaneDrawer），和抽屜框同為 PM 色 */
.card.is-open::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: calc(-1 * var(--sp-5) - 1px);
  margin-left: calc(-1 * var(--sp-5));
  border: var(--sp-5) solid transparent;
  border-bottom-color: var(--pm-frame);
  pointer-events: none;
}

/*
 * 展開中：整張卡換成 PM 色外框（--pm-frame 由 PmLane 提供），框線切換用較短的 --t-fast。
 * hover 不上浮：卡片一上移，下緣的箭頭就和速覽之間出現縫隙。
 */
.card.is-open,
.card.is-open:hover {
  border-color: var(--pm-frame);
  box-shadow: 0 0 0 1px var(--pm-frame);
  translate: none;
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

/* 實際進度：大數字 + 實際 / 理論合一進度條 + 「進入」，條色跟狀態走 */
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

.card-bar {
  flex: 1;
  min-width: 0;
}

/* 「進入」放在進度列右端，不獨佔一列 */
.progress :deep(.btn-enter) {
  flex: 0 0 auto;
  margin-left: var(--sp-4);
}
</style>
