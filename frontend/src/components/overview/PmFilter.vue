<script setup lang="ts">
// 總覽頂欄的成員（PM）篩選：頭像疊觸發鈕 ＋ PM 清單面板。
// 語意照 Dashboard 的 MemberPicker：沒勾任何人＝不篩選。外殼共用 OvDropdown，樣式照 B2 `.mp-*`。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import OvDropdown from '@/components/overview/OvDropdown.vue'
import { freezeLeave } from '@/composables/freezeLeave'
import { useOverviewStore } from '@/stores/overview'

defineProps<{
  /** 資料還沒到時整顆停用。 */
  disabled?: boolean
}>()

const overview = useOverviewStore()

const selCount = computed(() => overview.pmIds.length)
const hasSel = computed(() => selCount.value > 0)

/** 有勾人就只疊勾選的 PM；沒勾就拿前三位當示意（同 MemberPicker）。 */
const avatars = computed(() =>
  hasSel.value
    ? overview.pms.filter((m) => overview.pmIds.includes(m.id))
    : overview.pms.slice(0, 3),
)
const morePms = computed(() => !hasSel.value && overview.pms.length > 3)
</script>

<template>
  <OvDropdown
    class="mp"
    data-ov-dd="pm"
    label="成員"
    aria-label="成員篩選"
    menu-width="300px"
    :active="false"
    :open="overview.openDropdown === 'pm'"
    :disabled="disabled"
    @toggle="overview.toggleDropdown('pm')"
    @close="overview.closeDropdown()"
  >
    <template #trigger>
      <span class="mp-avs">
        <!-- 頭像增減時淡入淡出、其餘頭像滑過去（A23）；離場的釘在原位，所以 .mp-stack 要 relative -->
        <TransitionGroup name="ov-av" tag="span" class="mp-stack" @before-leave="freezeLeave">
          <Avatar v-for="m in avatars" :key="m.id" :member="m" :size="22" :ring="2" :overlap="7" />
        </TransitionGroup>
        <span v-if="morePms" class="mp-more" aria-hidden="true">…</span>
      </span>
      <span v-if="hasSel" class="mp-count">{{ selCount }}</span>
    </template>

    <div class="mp-head">
      <span class="mp-title">PM 成員</span>
      <span v-if="hasSel" class="mp-sub">已選 {{ selCount }} 位</span>
    </div>
    <div class="mp-list">
      <button
        v-for="o in overview.pmOptionList"
        :key="o.pm.id"
        type="button"
        class="mp-row"
        :class="{ on: overview.pmIds.includes(o.pm.id) }"
        :aria-pressed="overview.pmIds.includes(o.pm.id)"
        :data-pm-option="o.pm.id"
        @click="overview.togglePm(o.pm.id)"
      >
        <Avatar :member="o.pm" :size="28" />
        <span class="mp-info">
          <span class="mp-name">
            <i v-if="o.hasAlert" class="alert-dot" role="img" aria-label="有需注意的專案"></i>
            <span class="mp-name-text">{{ o.pm.name }}</span>
          </span>
          <span class="mp-meta">
            進行中 <b>{{ o.doing }}</b><span class="sep">·</span>未開始 <b>{{ o.todo }}</b>
          </span>
        </span>
        <span class="mp-box" aria-hidden="true">✓</span>
      </button>
    </div>
    <div v-if="hasSel" class="mp-tools">
      <button type="button" class="mp-btn" @click="overview.clearPms()">清除勾選</button>
    </div>
  </OvDropdown>
</template>

<style scoped>
/* 觸發鈕幾何照 B2 .mp-trigger：左側留少一點給頭像疊 */
.mp :deep(.dd-trigger) {
  gap: var(--sp-4);
  padding: 0 var(--sp-5) 0 var(--sp-3);
}

/* 成員下拉沒有「active」變色，開著時才轉 accent 邊（B2 .mp.is-open .mp-trigger） */
.mp.is-open :deep(.dd-trigger) {
  border-color: var(--accent);
  background: var(--surface-3);
}

/* 面板照 B2 .mp-panel：比一般下拉寬鬆、陰影較重 */
.mp :deep(.dd-menu) {
  top: calc(var(--ctrl-h) + var(--sp-3));
  padding: var(--sp-6);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-popover);
}

/* 頭像疊 ＋「…」；每顆往右收 7px，最後補回 7px */
.mp-avs {
  display: flex;
  align-items: center;
  padding-right: 7px;
}

.mp-stack {
  position: relative;
  display: flex;
  align-items: center;
}

.mp-more {
  width: 22px;
  height: 22px;
  margin-right: -7px;
  border: 2px solid var(--surface-1);
  border-radius: 50%;
  background: var(--border-1);
  color: var(--text-3);
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mp-count {
  font-size: var(--fs-meta);
  color: var(--accent-hover);
  font-weight: var(--fw-bold);
  font-family: var(--font-mono);
}

.mp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--sp-4);
}

.mp-title {
  font-size: var(--fs-month);
  font-weight: var(--fw-bold);
}

.mp-sub {
  font-size: var(--fs-meta);
  color: var(--accent-hover);
  font-weight: var(--fw-medium);
}

.mp-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* hover、勾選態都走 --t-fast（A6 / A19 / A22） */
.mp-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 48px;
  padding: 7px var(--sp-4);
  border: 1px solid var(--border-hair);
  border-radius: var(--r-card-sm);
  background: var(--surface-1);
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    background var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方（本檔其他 hover 同理） */
@media (hover: hover) {
  .mp-row:hover {
    background: var(--surface-3);
  }
}

.mp-row.on {
  border-color: var(--accent);
  background: var(--accent-tint-1);
}

.mp-row:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.mp-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.mp-name {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--text-1);
  line-height: var(--lh-tight);
}

.mp-name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-meta {
  display: inline-flex;
  align-items: baseline;
  gap: var(--sp-2);
  font-size: var(--fs-date);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mp-meta b {
  font-family: var(--font-mono);
  font-weight: var(--fw-medium);
  color: var(--text-1);
}

.mp-meta .sep {
  color: var(--text-placeholder);
}

/* 勾選框：白底白字，勾選時填 accent 讓 ✓ 浮現（A22） */
.mp-box {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border-radius: var(--r-badge);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  color: var(--surface-1);
  font-size: var(--fs-meta);
  line-height: 14px;
  text-align: center;
  transition:
    background var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}

.mp-row.on .mp-box {
  border-color: var(--accent);
  background: var(--accent);
}

.alert-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--danger);
}

.mp-tools {
  display: flex;
  gap: var(--sp-3);
  margin-top: var(--sp-5);
}

.mp-btn {
  flex: 1;
  height: var(--ctrl-h);
  font: inherit;
  font-size: var(--fs-select);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  border-radius: var(--r-input);
  cursor: pointer;
  color: var(--text-3);
  transition:
    background var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

@media (hover: hover) {
  .mp-btn:hover {
    background: var(--surface-3);
  }
}

.mp-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
