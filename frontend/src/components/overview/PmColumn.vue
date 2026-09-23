<script setup lang="ts">
// 卡片檢視裡一位 PM 的直欄：sticky 欄首（頭像、名字、計數）＋ 該 PM 專案卡的 TransitionGroup。
import Avatar from '@/components/common/Avatar.vue'
import ProjectCard from '@/components/overview/ProjectCard.vue'
import { freezeLeave } from '@/composables/freezeLeave'
import type { PmGroup } from '@/lib/portfolio'

defineProps<{ group: PmGroup }>()
</script>

<template>
  <!-- PM 色來自資料，不是 token，所以走 inline --pm；衍生的淡色在 .col 裡用 color-mix 算 -->
  <div class="col" :data-pm-col="group.pm.id" :style="{ '--pm': group.pm.color }">
    <div class="col-head">
      <Avatar class="col-avatar" :member="group.pm" :size="34" />
      <!-- 第一個子節點必須是名字的文字節點，e2e 的 columnNames() 靠這個結構取名字 -->
      <div class="pm-name">{{ group.pm.name }}<span class="pm-role">{{ group.pm.role }}</span></div>
      <div class="pm-counts">
        <span><b>{{ group.rows.length }}</b> 個專案</span><span class="sep">·</span>
        <span :class="{ 'is-danger': group.alertCount > 0 }"><b>{{ group.alertCount }}</b> 個需要注意</span>
      </div>
    </div>
    <!-- 篩選造成卡片進出、排序造成重排（A7 / A8）；離場的卡由 freezeLeave 釘在原位 -->
    <TransitionGroup name="ov-card" tag="div" class="col-body" @before-leave="freezeLeave">
      <ProjectCard v-for="row in group.rows" :key="row.p.id" :row="row" />
    </TransitionGroup>
  </div>
</template>

<style scoped>
.col {
  /* 欄底 PM 色 5%、欄首 12%（spec 目標 5） */
  --pm-bg: color-mix(in srgb, var(--pm) 5%, var(--surface-2));
  --pm-head: color-mix(in srgb, var(--pm) 12%, var(--surface-2));
  --pm-line: color-mix(in srgb, var(--pm) 22%, var(--border-1));
  /* 卡片展開時的 PM 色系：外框、箭頭字色、速覽分隔線（照 B2 .g, .col） */
  --pm-frame: var(--pm);
  --pm-ink: color-mix(in srgb, var(--pm) 60%, var(--text-1)); /* 淡底上仍 ≥4.5:1 */
  --pm-soft: color-mix(in srgb, var(--pm) 30%, var(--surface-1));
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--pm-bg);
  border: 1px solid var(--pm-line);
  border-radius: var(--r-card);
}

/* 欄首黏在面板標題列下方；--ov-head 由 OvPanel 量出標題列高度提供 */
.col-head {
  position: sticky;
  top: calc(var(--ov-top, 0px) + var(--ov-head, 0px));
  z-index: 6;
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-areas:
    'avatar name counts'
    'avatar bar bar';
  column-gap: var(--sp-5);
  row-gap: var(--sp-3);
  align-items: center;
  padding: var(--sp-5) var(--sp-7);
  border-bottom: 1px solid var(--pm-line);
  background: var(--pm-head);
  border-radius: var(--r-card) var(--r-card) 0 0;
  /* 逼出合成層，避免 sticky 欄首在捲動時閃爍（同 OvPanel 標題列） */
  transform: translateZ(0);
  backface-visibility: hidden;
}

.col-avatar {
  grid-area: avatar;
}

.col-avatar :deep(.glyph) {
  font-size: var(--fs-control);
}

.pm-name {
  grid-area: name;
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  font-size: var(--fs-panel);
  font-weight: var(--fw-bold);
  color: var(--text-1);
  line-height: var(--lh-tight);
}

/* 淡 PM 底上 --text-muted 對比不到 4.5，次要字一律用 --text-3 */
.pm-role {
  font-size: var(--fs-date);
  font-weight: var(--fw-regular);
  color: var(--text-3);
}

.pm-counts {
  grid-area: counts;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-meta);
  color: var(--text-3);
  white-space: nowrap;
}

.pm-counts b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-medium);
  color: var(--text-1);
}

.pm-counts .is-danger,
.pm-counts .is-danger b {
  color: var(--danger-text);
  font-weight: var(--fw-bold);
}

.pm-counts .sep {
  color: var(--text-3);
}

/* position: relative 讓 freezeLeave 的 offset 以這裡為基準 */
.col-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--pad-kanban-card);
  padding: var(--pad-kanban-card);
  min-height: 90px;
}
</style>
