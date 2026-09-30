<script setup lang="ts">
// 總覽的專案卡：名稱、狀態 pill、排序依據的 meta、實際 / 理論進度；右緣一條「進入」直條（user 選的 D 稿「右緣入口條」）。
// 卡片拆成兩個並排的點擊區：左邊主體 .card-main 點了展開速覽，右緣直條點了進入 Dashboard；
// 兩者是兄弟元素，不再把連結包在 role="button" 裡（巢狀互動元素，報讀與鍵盤事件都會互相干擾）。
// 卡片本身不換底色與框色：狀態只看右上角 pill 與進度條色，整頁顏色才不會太雜（user 決定）。
// 速覽不在卡片裡：是泳道裡插在這張卡所在列下方的抽屜（LaneDrawer，每條泳道一個），展開時卡片大小不變，只換外框並加一個指向抽屜的箭頭。
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
  if (e.key !== 'Enter' && e.key !== ' ') return
  // Space 不擋的話頁面會跟著捲動
  e.preventDefault()
  toggle()
}
</script>

<template>
  <article
    class="card"
    :class="{ 'is-open': open }"
    :data-project="p.id"
  >
    <div
      class="card-main"
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
      </div>
    </div>
    <EnterLink :id="p.id" :name="p.name" variant="edge" />
  </article>
</template>

<style scoped>
/*
 * 沿用看板卡：白底、1px 邊框、hover 邊框轉色＋陰影＋上浮 1px（A1，照 TaskCard）。
 * 兩欄：主體 ＋ 右緣 44px 的「進入」直條（觸控下限 44，整張卡高）。
 */
.card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-panel);
  /*
   * hover 上浮用獨立的 translate 屬性，不用 transform：transform 留給欄內重排（useRelativeFlip），
   * 兩者寫在同一個屬性會互相覆蓋，重排時卡片會先跳位再飄回來。
   */
  transition:
    border-color var(--t-base) var(--ease),
    box-shadow var(--t-base) var(--ease),
    translate var(--t-base) var(--ease);
}

/* 主體：點了展開速覽。右內距 16 → 12：讓出直條寬後，排序鍵那一行在 5 欄時仍放得下一行 */
.card-main {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
  min-width: 0;
  padding: var(--sp-7) var(--sp-6) var(--sp-7) var(--sp-8);
  border-radius: calc(var(--r-panel) - 1px) 0 0 calc(var(--r-panel) - 1px);
  cursor: pointer;
  transition: box-shadow var(--t-fast) var(--ease);
}

/* 焦點框畫在主體內側，和直條自己的焦點框分得開 */
.card-main:focus-visible {
  outline: none;
  box-shadow: inset var(--ring-focus);
}

/*
 * 只有滑到主體才浮起；滑到直條時卡片不動，兩種 hover 分得開。
 * hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方。
 */
@media (hover: hover) {
  .card:not(.is-open):has(> .card-main:hover) {
    border-color: var(--text-placeholder);
    box-shadow: var(--shadow-card-hover);
    translate: 0 -1px;
  }
}

/* 展開中：卡片下緣中央的箭頭指向下方的速覽抽屜（LaneDrawer），和抽屜框同為 PM 色 */
/*
 * 進出場（篩選 / 搜尋讓卡片出現或消失）：過渡照 overview-motion.css 的 ov-card-*（淡入淡出＋縮放）。
 * 上面 .card 的 transition 是 scoped（特異度較高），會蓋掉全域的 .ov-card-enter-active，所以在這裡明寫一次。
 */
.card.ov-card-enter-active,
.card.ov-card-leave-active {
  transition:
    opacity var(--t-panel) var(--ease),
    transform var(--t-panel) var(--ease);
}

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
 * 不上浮（上面的 hover 規則排除了 .is-open）：卡片一上移，下緣的箭頭就和速覽之間出現縫隙。
 */
.card.is-open {
  border-color: var(--pm-frame);
  box-shadow: 0 0 0 1px var(--pm-frame);
  transition:
    border-color var(--t-base) var(--ease),
    box-shadow var(--t-fast) var(--ease),
    translate var(--t-base) var(--ease);
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

/*
 * 排序鍵直接寫在卡上：落後百分點 · 到期日 · Issue，看得出排序為什麼是這個順序。
 * 橫向間距 6 → 4：主體讓出直條寬後仍維持一行。
 */
.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-3) var(--sp-2);
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

/* 實際進度：大數字 + 實際 / 理論合一進度條，條色跟狀態走；「進入」移到右緣直條，這一列整條給進度 */
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
</style>
