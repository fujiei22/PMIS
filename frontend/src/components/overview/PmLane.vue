<script setup lang="ts">
// 卡片檢視裡一位 PM 的橫向泳道：左側 sticky 標頭（頭像、名字、專案數、需注意數）＋ 右側卡片網格；
// 看板窄（平板直向）時標頭改放在卡片上方成一列。
// 卡片放不下自動換列；展開的速覽是插在該卡「所在那一列」正下方的抽屜（LaneDrawer），同列其他卡不會被擠走。
// 每條泳道同時只展開一張（抽屜只有一個箭頭，兩張同時展開時對不回自己的卡片）。
// 模板：PM 色來自資料，不是 token，所以走 inline --pm；衍生的淡色在 .lane 裡用 color-mix 算
import Avatar from '@/components/common/Avatar.vue'
import LaneDrawer from '@/components/overview/LaneDrawer.vue'
import PmCountPill from '@/components/overview/PmCountPill.vue'
import ProjectCard from '@/components/overview/ProjectCard.vue'
import {
  computed,
  onBeforeUnmount,
  onBeforeUpdate,
  onUpdated,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import { freezeLeave } from '@/composables/freezeLeave'
import { cancelHeight, holdHeight, releaseHeight } from '@/composables/heightTween'
import { useFreezeReenter } from '@/composables/useFreezeReenter'
import { useGridColumns } from '@/composables/useGridColumns'
import { useRelativeFlip } from '@/composables/useRelativeFlip'
import type { PmGroup } from '@/lib/portfolio'
import { useOverviewStore } from '@/stores/overview'

const props = defineProps<{ group: PmGroup }>()

const laneIds = computed(() => props.group.rows.map((r) => r.p.id))

/*
 * 巢狀 FLIP：泳道本身有重排動畫（CardBoard 的 ov-col），泳道內卡片若也用 TransitionGroup 內建的 move，
 * 會用頁面上的絕對位置算位移、把泳道的位移再算一次。所以卡片的重排改用相對於 .lane-body 的位移
 * （useRelativeFlip），內建 move 以 `ov-card-still`（overview-motion.css 裡只寫 transition: none）停用；卡片的進出場照舊由 TransitionGroup 處理。
 */
const body = ref<ComponentPublicInstance | null>(null)
const bodyEl = computed(() => body.value?.$el as HTMLElement | undefined)
const flip = useRelativeFlip(bodyEl, 'data-project')

/**
 * 離場的卡釘在更新前看得到的位置（C5）。速覽開著時篩掉同列的卡，抽屜的 order 在同一次 patch 裡
 * 先被改掉（keyed diff 先更新留下來的抽屜、才移除離場的卡），freezeLeave 當下量到的已是重排後的 grid，
 * 那張卡會先瞬移到抽屜下方再淡出；所以用 useRelativeFlip 在更新前記的快照。
 */
function freezeAtSnapshot(el: Element): void {
  freezeLeave(el, flip.snapshotOf)
}

// 淡出途中的卡又被加回來（打錯字馬上刪）：從舊卡當下的位置、透明度與大小接續，不先消失再從頭淡入（R3）
useFreezeReenter(bodyEl, 'data-project')

/**
 * 卡片網格的高度撐住再補間（C1 泳道層）：離場的卡釘成 absolute 後網格當幀就是新高度，泳道框會一幀縮掉、卡片畫到框外。
 * 只在卡片有進出或換順序時撐：篩選時每條泳道都會重新渲染（group 每次都是新的），卡片沒變的也撐住再放開的話，
 * 每條都要多逼一次版面計算（review M1）；抽屜開合、換箭頭也會讓泳道重新渲染，高度由抽屜自己的過渡逐幀帶動，本來就不用撐。
 * onBeforeUpdate 時 props 已是新的，所以和上一次畫出來的卡片（rendered）比。
 */
let rendered = laneIds.value
let held = false
onBeforeUpdate(() => {
  const ids = laneIds.value
  held = ids.length !== rendered.length || ids.some((id, i) => id !== rendered[i])
  rendered = ids
  if (held) holdHeight(bodyEl.value)
})
onUpdated(() => {
  if (held) releaseHeight(bodyEl.value)
  held = false
})
// 泳道被篩掉（或切檢視）時停掉進行中的補間：元件拿掉後 rAF 不會自己停
onBeforeUnmount(() => cancelHeight(bodyEl.value))

const cols = useGridColumns(bodyEl)

const overview = useOverviewStore()

// 時間軸可以同時展開多張：切回卡片（或篩選讓別的卡進到這條泳道）時，只留最後展開的那張
watch(laneIds, (ids) => overview.keepLastExpandedInLane(ids), { immediate: true })

/**
 * 抽屜實際展開在哪張卡下方（LaneDrawer 回報）；那張卡畫指向抽屜的箭頭。換列時和選取不同步，所以不直接用 isExpanded。
 * 初值同 LaneDrawer 掛載時的狀態（展開中的那張一掛上就是全開）：等它回報會晚一次更新，
 * 切回卡片檢視、從 Dashboard 返回時箭頭會在已經全開的抽屜上方重新淡入。
 */
const openId = ref<string | null>(
  props.group.rows.find((r) => overview.isExpanded(r.p.id))?.p.id ?? null,
)
</script>

<template>
  <div class="lane" :data-pm-col="group.pm.id" :style="{ '--pm': group.pm.color }">
    <div class="lane-head">
      <Avatar class="lane-avatar" :member="group.pm" :size="34" />
      <span class="pm-name">{{ group.pm.name }}</span>
      <span class="pm-meta">
        <PmCountPill :count="group.rows.length" unit="個專案" />
        <span v-if="group.alertCount > 0" class="pm-alert"
          ><b>{{ group.alertCount }}</b
          >&nbsp;需注意</span
        >
      </span>
    </div>
    <!-- 篩選造成卡片進出、排序造成重排（A7 / A8）；離場的卡由 freezeLeave 釘在更新前看得到的位置 -->
    <TransitionGroup
      name="ov-card"
      tag="div"
      class="lane-body"
      ref="body"
      move-class="ov-card-still"
      @before-leave="freezeAtSnapshot"
    >
      <!-- 卡片與抽屜在同一個 grid 裡，用 order 排位置：第 i 張卡是 2i，抽屜由 LaneDrawer 算出排在哪一列之後 -->
      <ProjectCard
        v-for="(row, i) in group.rows"
        :key="row.p.id"
        :row="row"
        :lane-ids="laneIds"
        :arrow="openId === row.p.id"
        :style="{ order: i * 2 }"
      />
      <LaneDrawer
        key="lane-drawer"
        :pm-id="group.pm.id"
        :rows="group.rows"
        :cols="cols"
        @open-id="openId = $event"
      />
    </TransitionGroup>
  </div>
</template>

<style scoped>
.lane {
  /* 泳道底 8%、標頭 16%，都混在 --surface-1 上（照 user 核可的 F / H 設計稿） */
  --pm-bg: color-mix(in srgb, var(--pm) 8%, var(--surface-1));
  --pm-head: color-mix(in srgb, var(--pm) 16%, var(--surface-1));
  --pm-line: color-mix(in srgb, var(--pm) 22%, var(--border-1));
  /* 卡片展開時的 PM 色系：外框、箭頭、抽屜框；速覽標頭底色與分隔線（QuickView with-head 讀 --pm-sel / --pm-soft） */
  --pm-frame: var(--pm);
  --pm-ink: color-mix(in srgb, var(--pm) 60%, var(--text-1)); /* 淡底上仍 ≥4.5:1 */
  --pm-sel: var(--pm-head);
  --pm-soft: color-mix(in srgb, var(--pm) 30%, var(--surface-1));
  --lane-head-w: 170px;
  display: grid;
  grid-template-columns: var(--lane-head-w) minmax(0, 1fr);
  align-items: start;
  min-width: 0;
  /* 標頭欄的底色畫滿整條泳道高度，不跟著 sticky 的標頭內容走 */
  background: linear-gradient(
    to right,
    var(--pm-head) var(--lane-head-w),
    var(--pm-bg) var(--lane-head-w)
  );
  border: 1px solid var(--pm-line);
  border-radius: var(--r-card);
}

/*
 * 標頭黏在面板標題列下方（泳道很高時仍看得到是誰的專案）；--ov-head 由 OvPanel 量出標題列高度提供。
 * 頭像、名字、兩顆帶字標籤由上往下置中排（user 選的 I 稿提案 A）。
 * 間距壓緊到約 130px 高，不超過一列卡片的泳道高度（約 160px），只有一列卡片的泳道不會被撐高。
 */
.lane-head {
  position: sticky;
  top: calc(var(--ov-top, 0px) + var(--ov-head, 0px));
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
  padding: var(--sp-6) var(--sp-5);
  text-align: center;
  /* 逼出合成層，避免 sticky 標頭在捲動時閃爍（同 OvPanel 標題列） */
  transform: translateZ(0);
  backface-visibility: hidden;
}

.lane-avatar :deep(.glyph) {
  font-size: var(--fs-control);
}

.pm-name {
  max-width: 100%;
  font-size: var(--fs-panel);
  font-weight: var(--fw-bold);
  color: var(--text-1);
  line-height: var(--lh-tight);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
}

/* 和帶單位的專案數膠囊同高同形，紅色系 */
.pm-alert {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--sp-4);
  border: 1px solid var(--danger-bd);
  border-radius: var(--r-pill);
  background: var(--danger-bg);
  color: var(--danger-text);
  font-size: var(--fs-date);
  font-weight: var(--fw-bold);
  line-height: 1;
  white-space: nowrap;
}

.pm-alert b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: inherit;
}

/*
 * 卡片網格；position: relative 讓 freezeLeave 與 useRelativeFlip 的 offset 以這裡為基準。
 * 列間距不用 row-gap：收合的抽屜也各佔一列（高度 0），row-gap 會變成多出來的空隙。
 * 改由卡片的 margin-bottom 與抽屜內的 padding 撐開。
 * align-content: start：高度被 heightTween 撐在舊值時（卡片離場、網格少一列），多出來的空間留在下方；
 * 預設 normal 等於 stretch，會把剩下的列拉高去填滿，留下的卡跟著變高（一欄寬時 142 → 294px）。平常網格高度等於內容，沒有差別。
 */
.lane-body {
  position: relative;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  align-content: start;
  column-gap: var(--sp-5);
  padding: var(--sp-5) var(--sp-5) 0;
  min-height: 90px;
}

.lane-body > .card {
  margin-bottom: var(--sp-5);
}

/*
 * 窄的看板（平板直向，容器是 CardBoard 的 .board）：標頭改放在卡片上方，卡片區拿回整個寬度（user 選的 J 稿提案）。
 * 841px 是左側標頭還放得下兩欄卡片的最小寬度：框線 2 + 標頭 170 + 卡片區內距 20 + 兩張 320 + 欄距 10 = 842。
 * 再窄的話左側標頭只剩一欄卡片，標頭改放上方就能排兩欄（看板 672px 以上），速覽抽屜也拿到整條泳道的寬度。
 */
@container board (max-width: 841px) {
  .lane {
    grid-template-columns: minmax(0, 1fr);
    background: var(--pm-bg);
  }

  /* 標頭在卡片上方時改成一列：頭像、名字、兩顆標籤；照樣黏在面板標題列下方，底色不透明才蓋得住捲上來的卡片 */
  .lane-head {
    flex-direction: row;
    gap: var(--sp-5);
    padding: var(--sp-5) var(--sp-7);
    text-align: left;
    background: var(--pm-head);
    border-bottom: 1px solid var(--pm-line);
    border-radius: calc(var(--r-card) - 1px) calc(var(--r-card) - 1px) 0 0;
  }

  /* 一列的標頭用 28px 頭像；尺寸是 Avatar 依 prop 寫在 inline style 的 --av-size，只能用 !important 蓋 */
  .lane-avatar {
    --av-size: 28px !important;
  }

  .lane-avatar :deep(.glyph) {
    font-size: var(--fs-pill);
  }

  .pm-meta {
    flex-direction: row;
    gap: var(--sp-3);
  }
}
</style>
