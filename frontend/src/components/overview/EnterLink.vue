<script setup lang="ts">
// 「進入」連結：導到該專案的 Dashboard。專案卡與速覽標頭共用，樣式只寫這一份（user 選的 D 稿「右緣入口條」）。
// - edge：卡片右緣、整張卡高的直條，只畫箭頭；平時 PM 淡色，hover 填滿 PM 色。
// - head：速覽標頭右端貼邊、整個標頭高的色塊，寫「進入」。
// 兩種都讀使用端給的 PM 色（--pm / --pm-ink，由 PmLane / TimelineGroup 提供）。
// 不擋冒泡：直條是卡片主體的兄弟、入口塊在速覽裡，上層都不是展開用的點擊區。
import { RouterLink } from 'vue-router'

defineProps<{
  /** 專案 id。 */
  id: string
  /** 專案名：組可讀名稱，一頁很多條直條都只畫箭頭，報讀時靠它分辨是哪一張。 */
  name: string
  /** 樣式：edge＝卡片右緣直條（只有箭頭），head＝速覽標頭右端的入口塊（寫「進入」）。 */
  variant: 'edge' | 'head'
}>()
</script>

<template>
  <RouterLink
    class="btn-enter"
    :class="'enter-' + variant"
    :to="{ name: 'dashboard', params: { id } }"
    :aria-label="`進入 ${name} Dashboard`"
    :title="variant === 'edge' ? '進入 Dashboard' : undefined"
  >
    <span v-if="variant === 'head'">進入</span>
    <svg class="enter-arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.75 8h10M9 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </RouterLink>
</template>

<style scoped>
.btn-enter {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  text-decoration: none;
}

/* 蓋掉 base.css 的 a:hover（變色＋底線）；各樣式的 hover 顏色在下面另寫 */
.btn-enter:hover {
  text-decoration: none;
}

.enter-arrow {
  flex: 0 0 auto;
  transition: translate var(--t-base) var(--ease);
}

/* ── edge：卡片右緣直條，左側分隔線同卡片框色 ── */
.enter-edge {
  min-width: 0;
  /* 平時 PM 色 16%（= 泳道標頭的比例）混在卡片的白底上 */
  background: color-mix(in srgb, var(--pm) 16%, var(--surface-1));
  border-left: 1px solid var(--border-1);
  border-radius: 0 calc(var(--r-panel) - 1px) calc(var(--r-panel) - 1px) 0;
  color: var(--pm-ink);
  transition:
    background var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.enter-edge .enter-arrow {
  width: 18px;
  height: 18px;
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方 */
@media (hover: hover) {
  .enter-edge:hover {
    background: var(--pm);
    border-left-color: var(--pm);
    color: var(--surface-1);
  }

  .enter-edge:hover .enter-arrow {
    translate: 3px 0;
  }
}

/* 按下：深一階（--pm-ink，也就是速覽標頭入口塊平時的底色），箭頭退回 1px */
.enter-edge:active {
  background: var(--pm-ink);
  border-left-color: var(--pm-ink);
  color: var(--surface-1);
}

.enter-edge:active .enter-arrow {
  translate: 1px 0;
}

/* 疊在隔壁卡片與抽屜之上，焦點光暈才不會被蓋住 */
.enter-edge:focus-visible {
  position: relative;
  z-index: 1;
  outline: none;
  box-shadow: var(--ring-focus);
}

/* ── head：速覽標頭右端的入口塊，整個標頭高 ── */
.enter-head {
  align-self: stretch;
  /* 蓋住標頭底線，整塊從框頂接到內容區 */
  margin-bottom: -1px;
  gap: var(--sp-3);
  flex: 0 0 auto;
  padding: 0 var(--sp-8);
  /* 帶字用 --pm-ink：白字對每個成員色都 ≥ 4.5:1（純 --pm 在琥珀、青色成員上只有 3.2～3.8） */
  background: var(--pm-ink);
  color: var(--surface-1);
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
  white-space: nowrap;
  transition:
    filter var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.enter-head:hover {
  color: var(--surface-1);
}

.enter-head .enter-arrow {
  width: 16px;
  height: 16px;
}

@media (hover: hover) {
  .enter-head:hover {
    filter: var(--hover-dim);
  }

  .enter-head:hover .enter-arrow {
    translate: 3px 0;
  }
}

.enter-head:active {
  filter: var(--hover-dim) var(--hover-dim);
}

.enter-head:active .enter-arrow {
  translate: 1px 0;
}

/* 貼在框內、深底：外圈光暈會被抽屜的圓角裁掉，藍色在深底上也看不清，改成內嵌 ring ＋ 2px 白色內框 */
.enter-head:focus-visible {
  outline: 2px solid var(--surface-1);
  outline-offset: -5px;
  box-shadow: inset var(--ring-focus);
}
</style>
