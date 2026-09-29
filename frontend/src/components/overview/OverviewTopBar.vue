<script setup lang="ts">
// 總覽頂欄：標題、檢視切換、成員 / 狀態 / 需注意篩選、清除篩選、登入者。
// 版面照 Dashboard TopBar 的單列與 B2；專案計數只放在面板標題列，頂欄不放（spec 目標 3）。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import OvDropdown from '@/components/overview/OvDropdown.vue'
import PmFilter from '@/components/overview/PmFilter.vue'
import {
  PROJECT_ALERT_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
} from '@/constants/overview'
import { useOverviewStore, type OverviewView } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'
import type { ProjectAlert, ProjectStatus } from '@/types/models'

const overview = useOverviewStore()
const portfolio = usePortfolioStore()

const views: { key: OverviewView; label: string; icon: string }[] = [
  { key: 'cards', label: '卡片', icon: '▦' },
  { key: 'timeline', label: '時間軸', icon: '▤' },
]

/** 狀態下拉的圓點色，順序照 PROJECT_STATUS_ORDER。 */
const STATUS_DOT: Record<ProjectStatus, string> = {
  todo: 'var(--st-todo-dot)',
  doing: 'var(--st-doing-dot)',
  done: 'var(--st-done-dot)',
}

const ALERT_ORDER: readonly ProjectAlert[] = ['late', 'watch', 'none']
const ALERT_DOT: Record<ProjectAlert, string> = {
  late: 'var(--st-delayed-dot)',
  watch: 'var(--st-paused-dot)',
  none: 'var(--st-todo-dot)',
}

/** 資料還沒到就不給篩（選項計數都還是空的）。 */
const notReady = computed(() => overview.loadState !== 'ready')

/** 觸發鈕 label：沒選時只有名稱，有選時接上勾選數，例如「狀態 2」。 */
function ddLabel(name: string, n: number): string {
  return n ? `${name} ${n}` : name
}

const me = computed(() => portfolio.byId(portfolio.currentUserId))
</script>

<template>
  <header class="top-row">
    <!-- 總覽本身就是首頁，三條線只保留視覺，不做連結 -->
    <span class="burger" aria-hidden="true"><i></i><i></i><i></i></span>
    <h1 class="project">所有專案</h1>

    <nav class="views" aria-label="檢視">
      <button
        v-for="v in views"
        :key="v.key"
        type="button"
        class="view-link"
        :aria-pressed="overview.view === v.key"
        :data-view-switch="v.key"
        @click="overview.setView(v.key)"
      >
        <span class="view-icon" aria-hidden="true">{{ v.icon }}</span><span>{{ v.label }}</span>
      </button>
    </nav>

    <!-- 右半組：篩選 + 登入者。窄螢幕放不下時整組換行、組內再換行，都靠右 -->
    <div class="top-right">
      <div class="filters" role="group" aria-label="篩選">
        <span class="section">成員</span>
        <PmFilter :disabled="notReady" />

        <span class="divider"></span>
        <span class="section">專案</span>
        <OvDropdown
          data-ov-dd="status"
          :label="ddLabel('狀態', overview.statuses.length)"
          :active="overview.statuses.length > 0"
          :open="overview.openDropdown === 'status'"
          :disabled="notReady"
          @toggle="overview.toggleDropdown('status')"
          @close="overview.closeDropdown()"
        >
          <button
            v-for="s in PROJECT_STATUS_ORDER"
            :key="s"
            type="button"
            class="dd-item"
            :aria-pressed="overview.statuses.includes(s)"
            @click="overview.toggleStatus(s)"
          >
            <span class="dd-dot" :style="{ background: STATUS_DOT[s] }"></span>
            <span class="dd-label">{{ PROJECT_STATUS_LABEL[s] }}</span>
            <span class="dd-check" aria-hidden="true">✓</span>
          </button>
        </OvDropdown>
        <OvDropdown
          data-ov-dd="alert"
          :label="ddLabel('需注意', overview.alerts.length)"
          :active="overview.alerts.length > 0"
          :open="overview.openDropdown === 'alert'"
          :disabled="notReady"
          @toggle="overview.toggleDropdown('alert')"
          @close="overview.closeDropdown()"
        >
          <button
            v-for="a in ALERT_ORDER"
            :key="a"
            type="button"
            class="dd-item"
            :aria-pressed="overview.alerts.includes(a)"
            @click="overview.toggleAlert(a)"
          >
            <span class="dd-dot" :style="{ background: ALERT_DOT[a] }"></span>
            <span class="dd-label">{{ PROJECT_ALERT_LABEL[a] }}</span>
            <span class="dd-check" aria-hidden="true">✓</span>
          </button>
        </OvDropdown>

        <button
          type="button"
          class="clear"
          :class="{ on: overview.anyFilter }"
          :disabled="!overview.anyFilter"
          data-testid="overview-clear"
          @click="overview.clearFilters()"
        >
          <span class="clear-x" aria-hidden="true">✕</span><span>清除篩選</span>
        </button>
      </div>

      <div class="tail">
        <template v-if="me">
          <span class="me-name">{{ me.name }}</span>
          <span class="me-role">{{ me.role }}</span>
          <Avatar class="me-av" :member="me" :size="30" />
        </template>
      </div>
    </div>
  </header>
</template>

<style scoped>
/*
 * 頂欄；高度由 Task 10 量給面板標題列的 sticky 用（ResizeObserver，換行後的高度也會跟上）。
 * 平板直向放不下一列時篩選區整組換到第二列，不然篩選會往左溢出蓋住檢視切換鈕。
 */
.top-row {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-4) var(--sp-5);
  min-height: calc(var(--ctrl-h) + var(--sp-12));
  padding: var(--sp-4) var(--sp-10);
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-1);
  /* 同 Dashboard TopBar，避免 sticky 列在捲動時閃爍 */
  transform: translateZ(0);
  backface-visibility: hidden;
}

.burger {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 18px;
  flex: 0 0 auto;
}

.burger i {
  height: 2px;
  background: var(--text-3);
  border-radius: var(--r-2);
}

.project {
  margin: 0;
  font-size: var(--fs-dialog);
  font-weight: var(--fw-bold);
  letter-spacing: -0.01em;
  flex: 0 0 auto;
  white-space: nowrap;
}

/* 檢視切換：放在 Dashboard 面板捷徑（board-link）的位置，選取態用 accent 淡底 */
.views {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 0 auto;
  padding-left: var(--sp-2);
}

/* 選取態的底色與文字色過渡（A11 / A19） */
.view-link {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: var(--ctrl-h);
  padding: 0 var(--sp-6);
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--text-3);
  font: inherit;
  font-size: var(--fs-control);
  font-weight: var(--fw-medium);
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
  .view-link:hover {
    background: var(--surface-3);
    color: var(--text-1);
  }
}

.view-link[aria-pressed='true'] {
  border-color: var(--accent-tint-3);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent-hover);
}

.view-link:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.view-icon {
  font-size: var(--fs-micro);
  opacity: 0.75;
}

.top-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-4) var(--sp-5);
  flex: 0 1 auto;
  min-width: 0;
  margin-left: auto;
}

.filters {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-3);
  flex: 0 1 auto;
  min-width: 0;
}

.section {
  font-size: var(--fs-date);
  color: var(--text-muted);
  font-weight: var(--fw-bold);
  letter-spacing: 0.06em;
  flex: 0 0 auto;
}

.divider {
  width: 1px;
  height: 18px;
  margin: 0 var(--sp-2);
  background: var(--border-1);
  flex: 0 0 auto;
}

/* 清除篩選：沒篩選時灰且停用，有篩選時轉紅可點；色彩與透明度過渡（A15） */
.clear {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: 0 0 auto;
  height: var(--ctrl-h);
  padding: 0 var(--sp-6);
  font: inherit;
  font-size: var(--fs-control);
  border: 1px solid var(--border-1);
  background: var(--surface-1);
  color: var(--text-muted);
  border-radius: var(--r-pill);
  cursor: default;
  white-space: nowrap;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    opacity var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.clear.on {
  border-color: var(--danger-bd);
  background: var(--danger-bg);
  color: var(--danger-text);
  cursor: pointer;
}

.clear:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.clear-x {
  font-size: var(--fs-pill);
}

/* 登入者：左側分隔線，名字、職稱、頭像（照 B2 .tail） */
.tail {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  flex: 0 0 auto;
  padding-left: var(--sp-4);
  border-left: 1px solid var(--border-1);
}

.me-name {
  font-size: var(--fs-control);
  font-weight: var(--fw-medium);
  color: var(--text-2);
}

.me-role {
  font-size: var(--fs-date);
  color: var(--text-muted);
}

/* 30px 頭像的縮寫字放大一階（B2 .avatar.lg） */
.me-av :deep(.glyph) {
  font-size: var(--fs-control);
}
</style>
