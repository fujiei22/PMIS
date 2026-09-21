<script setup lang="ts">
// 頂部列的成員篩選器：疊起來的頭像觸發鈕 + 成員清單面板。
// legacy 對照：模板 :72-112、memberRows :2736-2760。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import { useFilterStore } from '@/stores/filter'
import { useMemberStore } from '@/stores/member'
import { useUiStore } from '@/stores/ui'

/** 拖曳時被收起的列往來源列靠攏的間距（px）。legacy `(fromIdx - idx) * 46`（:2745） */
const ROW_PITCH = 46

const ui = useUiStore()
const filter = useFilterStore()
const memberStore = useMemberStore()

const selected = computed(() => filter.memberIds)
const selCount = computed(() => selected.value.length)
const hasSel = computed(() => selCount.value > 0)

/** 沒勾人時顯示前三位當示意，勾了就只顯示勾選的。legacy `memberAvatars`（:3662） */
const avatars = computed(() =>
  hasSel.value
    ? memberStore.members.filter((m) => selected.value.includes(m.id))
    : memberStore.members.slice(0, 3),
)
const moreMembers = computed(() => !hasSel.value && memberStore.members.length > 3)

/** 拖曳來源在清單裡的位置，用來算被收起的列要往哪飛。S5 才會填 memberDrag。 */
const fromIdx = computed(() =>
  ui.memberDrag ? memberStore.members.findIndex((m) => m.id === ui.memberDrag!.from) : -1,
)

/** 每一列的 transform / opacity / z-index，legacy :2740-2747。 */
function rowStyle(id: string, idx: number): Record<string, string | number> {
  const drag = ui.memberDrag
  const inDrag = !!drag?.ids.includes(id)
  const isSrc = drag?.from === id
  const collapsing = inDrag && !isSrc
  return {
    transform: collapsing
      ? `translateY(${(fromIdx.value - idx) * ROW_PITCH}px) scale(.72)`
      : isSrc
        ? 'scale(1.02)'
        : 'none',
    opacity: collapsing ? 0 : drag && !inDrag ? 0.4 : 1,
    zIndex: isSrc ? 3 : 1,
  }
}

/** 多選拖曳時來源列右上角的「＋N」。legacy `m.badge`（:2748） */
function badgeOf(id: string): string {
  const drag = ui.memberDrag
  if (!drag || drag.from !== id || drag.ids.length <= 1) return ''
  return '＋' + (drag.ids.length - 1)
}

function toggle(id: string): void {
  filter.memberIds = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
}
</script>

<template>
  <div class="mp">
    <div
      class="mp-trigger"
      :class="{ open: ui.memberPickerOpen }"
      data-dd="1"
      role="button"
      @click="ui.toggleMemberPicker()"
    >
      <div class="mp-stack">
        <Avatar v-for="m in avatars" :key="m.id" :member="m" :size="20" :ring="2" :overlap="7" />
        <span v-if="moreMembers" class="mp-more">…</span>
      </div>
      <span v-if="hasSel" class="mp-count">{{ selCount }}</span>
    </div>

    <div v-if="ui.memberPickerOpen" class="mp-panel" data-dd="1">
      <div class="mp-head">
        <span class="mp-title">專案成員</span>
        <span class="mp-sub">已選 {{ selCount }} 位</span>
      </div>
      <div class="mp-list">
        <div
          v-for="(m, idx) in memberStore.members"
          :key="m.id"
          class="mp-row"
          :class="{ on: selected.includes(m.id) }"
          :style="rowStyle(m.id, idx)"
          draggable="true"
          role="button"
          @click="toggle(m.id)"
        >
          <Avatar :member="m" :size="28" />
          <div class="mp-info">
            <div class="mp-name" :title="m.name">{{ m.name }}</div>
            <div class="mp-role" :title="m.role">{{ m.role }}</div>
          </div>
          <span class="mp-box">{{ selected.includes(m.id) ? '✓' : '' }}</span>
          <span v-if="badgeOf(m.id)" class="mp-badge">{{ badgeOf(m.id) }}</span>
        </div>
      </div>
      <button v-if="hasSel" class="mp-clear" @click="filter.memberIds = []">清除勾選</button>
    </div>
  </div>
</template>

<style scoped>
.mp {
  position: relative;
  flex: 0 0 auto;
}

.mp-trigger {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: 5px var(--sp-5) 5px var(--sp-4);
  border: 1px solid var(--border-1);
  background: var(--surface-1);
  border-radius: var(--r-pill);
  cursor: pointer;
}

.mp-trigger.open {
  border-color: var(--accent);
  background: var(--surface-3);
}

.mp-stack {
  display: flex;
  align-items: center;
}

.mp-more {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--border-1);
  color: var(--text-3);
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--surface-1);
  margin-right: -7px;
  letter-spacing: 0.5px;
}

.mp-count {
  font-size: var(--fs-meta);
  color: var(--accent);
  font-weight: 600;
  font-family: var(--font-mono);
}

.mp-panel {
  position: absolute;
  top: 40px;
  left: 0;
  z-index: 100;
  width: 264px;
  padding: var(--sp-6);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-popover);
  animation: popIn var(--t-pop) ease-out;
}

.mp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--sp-2);
}

.mp-title {
  font-size: var(--fs-month);
  font-weight: var(--fw-bold);
}

.mp-sub {
  font-size: var(--fs-meta);
  color: var(--accent);
  font-weight: var(--fw-medium);
}

.mp-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  max-height: 430px;
  overflow: auto;
  padding-right: var(--r-2);
}

.mp-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px var(--sp-4);
  border-radius: var(--r-card-sm);
  cursor: pointer;
  border: 1px solid var(--border-hair);
  background: var(--surface-1);
  transition:
    transform var(--t-panel) var(--ease),
    opacity var(--t-hover) ease;
}

.mp-row.on {
  border-color: var(--accent);
  background: var(--accent-tint-1);
}

.mp-row:active {
  cursor: grabbing;
}

.mp-info {
  min-width: 0;
  flex: 1;
}

.mp-name {
  font-size: var(--fs-month);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-role {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-box {
  width: 16px;
  height: 16px;
  border-radius: var(--r-badge);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  color: var(--surface-1);
  font-size: var(--fs-meta);
  line-height: 14px;
  text-align: center;
}

.mp-row.on .mp-box {
  border-color: var(--accent);
  background: var(--accent);
}

.mp-badge {
  position: absolute;
  right: -6px;
  top: -6px;
  background: var(--text-1);
  color: var(--surface-1);
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  padding: var(--r-2) 7px;
  border-radius: var(--r-999);
  box-shadow: var(--shadow-badge);
}

.mp-clear {
  width: 100%;
  margin-top: var(--sp-5);
  padding: var(--sp-3);
  font-size: var(--fs-select);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  border-radius: var(--r-input);
  cursor: pointer;
  color: var(--text-3);
}

.mp-clear:hover {
  background: var(--surface-3);
}
</style>
