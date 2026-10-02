<script setup lang="ts">
// 頂部列的成員篩選器：疊起來的頭像觸發鈕 + 成員清單面板。
// legacy 對照：模板 :72-112、memberRows :2736-2760。
// legacy 可以把成員列拖到甘特條 / 任務卡上指派，新版不提供（user 決定移除，指派改在詳細視窗的「＋指派」）。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import { filterableMembers } from '@/lib/filter'
import { useFilterStore } from '@/stores/filter'
import { useMemberStore } from '@/stores/member'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

withDefaults(
  defineProps<{
    /**
     * 面板對齊觸發鈕的哪一側。`start`（預設）：左緣對齊、往右展開；`end`：右緣對齊、往左展開。
     * 頂欄一行時篩選器靠右排，勾了人觸發鈕的頭像與人數會變，寬度變化落在左緣、右緣不動，
     * TopBar 傳 `end` 讓面板錨在不動的那一側，開著勾人時不被帶著跑（動畫稽核 G7）。
     */
    align?: 'start' | 'end'
  }>(),
  { align: 'start' },
)

const ui = useUiStore()
const filter = useFilterStore()
const memberStore = useMemberStore()
const taskStore = useTaskStore()

const selected = computed(() => filter.memberIds)
const selCount = computed(() => selected.value.length)
const hasSel = computed(() => selCount.value > 0)

/** 列得出來的人：這個專案有被指派任務的成員（加上已勾選的），照 members 順序。 */
const listed = computed(() =>
  filterableMembers(memberStore.members, taskStore.tasks, selected.value),
)

/** 沒勾人時顯示前三位當示意，勾了就只顯示勾選的。legacy `memberAvatars`（:3662） */
const avatars = computed(() =>
  hasSel.value
    ? listed.value.filter((m) => selected.value.includes(m.id))
    : listed.value.slice(0, 3),
)
const moreMembers = computed(() => !hasSel.value && listed.value.length > 3)

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

    <!-- 進出場用 base.css 的 pop（動畫稽核 G12） -->
    <Transition name="pop">
      <div
        v-if="ui.memberPickerOpen"
        class="mp-panel"
        :class="{ end: align === 'end' }"
        data-dd="1"
      >
        <div class="mp-head">
          <span class="mp-title">專案成員</span>
          <span class="mp-sub">已選 {{ selCount }} 位</span>
        </div>
        <div class="mp-list">
          <div
            v-for="m in listed"
            :key="m.id"
            class="mp-row"
            :class="{ on: selected.includes(m.id) }"
            role="button"
            @click="toggle(m.id)"
          >
            <Avatar :member="m" :size="28" />
            <div class="mp-info">
              <div class="mp-name" :title="m.name">{{ m.name }}</div>
              <div class="mp-role" :title="m.role">{{ m.role }}</div>
            </div>
            <span class="mp-box">{{ selected.includes(m.id) ? '✓' : '' }}</span>
          </div>
        </div>
        <button v-if="hasSel" class="mp-clear" @click="filter.memberIds = []">清除勾選</button>
      </div>
    </Transition>
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
}

/* 右緣對齊觸發鈕、往左展開（align="end"） */
.mp-panel.end {
  left: auto;
  right: 0;
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
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px var(--sp-4);
  border-radius: var(--r-card-sm);
  cursor: pointer;
  border: 1px solid var(--border-hair);
  background: var(--surface-1);
}

.mp-row.on {
  border-color: var(--accent);
  background: var(--accent-tint-1);
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
