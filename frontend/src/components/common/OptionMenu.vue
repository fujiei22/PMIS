<script setup lang="ts">
// 卡片上點狀態 / 優先度 / 分類 / Issue 欄位跳出的浮動選項選單（全域只會有一個）。
// legacy 對照：optItems :3386-3452、模板 :1305-1320；位置由 ui.optionMenu 帶進來。
import { computed } from 'vue'
import { ISSUE_ITEM, ISSUE_LEVEL, ISSUE_STATUS, PRIORITY, TASK_STATUS } from '@/constants/dashboard'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { IssueItem, IssueLevel, IssueStatus, Priority, TaskStatus } from '@/types/models'

interface OptionItem {
  key: string
  label: string
  /** 左邊的小圓點；不給就不畫（分類 / Issue 類別 / 所屬任務都沒有）。 */
  dot?: string
  checked: boolean
  pick: () => void
}

const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const memberStore = useMemberStore()

const menu = computed(() => ui.optionMenu)

function close(): void {
  ui.optionMenu = null
}

/** 改任務欄位後關掉選單（單選）。legacy :3391 */
function setTask(id: string, patch: Parameters<typeof taskStore.updateTask>[1]): void {
  taskStore.updateTask(id, patch)
  close()
}

/** 改 Issue 欄位後關掉選單（單選）。legacy :3405 */
function setIssue(id: string, patch: Parameters<typeof issueStore.updateIssue>[1]): void {
  issueStore.updateIssue(id, patch)
  close()
}

const items = computed<OptionItem[]>(() => {
  const m = menu.value
  if (!m) return []

  // ── 任務欄位 ────────────────────────────────────────────────────────────
  if (m.kind === 'priority' || m.kind === 'status' || m.kind === 'group') {
    const t = taskStore.taskById(m.id)
    if (!t) return []
    if (m.kind === 'priority') {
      return (['high', 'mid', 'low'] as Priority[]).map((k) => ({
        key: k,
        label: `${PRIORITY[k].label}優先`,
        dot: PRIORITY[k].color,
        checked: t.priority === k,
        pick: () => setTask(t.id, { priority: k }),
      }))
    }
    if (m.kind === 'status') {
      return (['todo', 'doing', 'paused', 'done'] as TaskStatus[]).map((k) => ({
        key: k,
        label: TASK_STATUS[k].label,
        dot: TASK_STATUS[k].bar,
        checked: t.status === k,
        pick: () => setTask(t.id, { status: k }),
      }))
    }
    return taskStore.groups.map((g) => ({
      key: g.id,
      label: g.name,
      checked: t.groupId === g.id,
      pick: () => setTask(t.id, { groupId: g.id }),
    }))
  }

  // ── Issue 欄位 ──────────────────────────────────────────────────────────
  const issue = issueStore.byId(m.id)
  if (!issue) return []
  switch (m.kind) {
    case 'ipri':
      return (['A', 'B', 'C', 'D'] as IssueLevel[]).map((k) => ({
        key: k,
        label: ISSUE_LEVEL[k].label,
        dot: ISSUE_LEVEL[k].color,
        checked: issue.level === k,
        pick: () => setIssue(issue.id, { level: k }),
      }))
    case 'iitem':
      return (Object.keys(ISSUE_ITEM) as IssueItem[]).map((k) => ({
        key: k,
        label: `${ISSUE_ITEM[k].label}　${ISSUE_ITEM[k].zh}`,
        checked: (issue.item || 'O') === k,
        pick: () => setIssue(issue.id, { item: k }),
      }))
    case 'istatus':
      return (['open', 'doing', 'paused', 'closed'] as IssueStatus[]).map((k) => ({
        key: k,
        label: ISSUE_STATUS[k].label,
        dot: ISSUE_STATUS[k].fg,
        checked: issue.status === k,
        pick: () => setIssue(issue.id, { status: k }),
      }))
    case 'itask':
      return taskStore.tasks.map((t) => ({
        key: t.id,
        label: t.name,
        checked: issue.taskId === t.id,
        pick: () => setIssue(issue.id, { taskId: t.id }),
      }))
    case 'icreator':
      return memberStore.members.map((mm) => ({
        key: mm.id,
        label: mm.name,
        dot: mm.color,
        checked: issue.creatorId === mm.id,
        pick: () => setIssue(issue.id, { creatorId: mm.id }),
      }))
    default: {
      // iowner 是多選，點了不關選單。legacy :3437
      const owners = issue.ownerIds ?? []
      return memberStore.members.map((mm) => {
        const on = owners.includes(mm.id)
        return {
          key: mm.id,
          label: mm.name,
          dot: mm.color,
          checked: on,
          pick: () =>
            issueStore.updateIssue(issue.id, {
              ownerIds: on ? owners.filter((x) => x !== mm.id) : owners.concat([mm.id]),
            }),
        }
      })
    }
  }
})
</script>

<template>
  <!-- 遮罩不掛 data-dd，維持 legacy 行為：點它會順帶清掉選取（:1908 / :1306） -->
  <div v-if="menu" class="opt-mask" @click="close()"></div>
  <div
    v-if="menu"
    class="opt-menu"
    :style="{ left: `${menu.left}px`, top: `${menu.top}px` }"
  >
    <div
      v-for="o in items"
      :key="o.key"
      class="opt-item"
      :class="{ on: o.checked }"
      role="button"
      @click="o.pick()"
    >
      <span v-if="o.dot" class="opt-dot" :style="{ background: o.dot }"></span>
      <span class="opt-label">{{ o.label }}</span>
      <span class="opt-check">{{ o.checked ? '✓' : '' }}</span>
    </div>
  </div>
</template>

<style scoped>
.opt-mask {
  position: fixed;
  inset: 0;
  z-index: 190;
}

.opt-menu {
  position: fixed;
  z-index: 200;
  min-width: 150px;
  max-width: 230px;
  max-height: 280px;
  overflow: auto;
  padding: var(--r-badge);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
  animation: popIn var(--t-pop) ease-out;
}

.opt-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: var(--r-badge) 7px;
  border-radius: var(--r-control);
  cursor: pointer;
  background: transparent;
}

.opt-item.on {
  background: var(--surface-2);
}

.opt-item:hover {
  background: var(--surface-3);
}

.opt-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
}

.opt-label {
  font-size: var(--fs-meta);
  color: var(--text-2);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opt-check {
  font-size: var(--fs-caption);
  color: var(--accent);
  width: var(--fs-10);
  flex: 0 0 var(--fs-10);
}
</style>
