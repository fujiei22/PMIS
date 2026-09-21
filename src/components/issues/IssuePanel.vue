<script setup lang="ts">
// Issue 看板：依 filter.issueGroupBy 分成處理狀態 / 等級 / 分類三種分欄方式。
// legacy 對照：模板 :644-853，issueList :3119-3239，iColumns :3562-3573。
import { computed } from 'vue'
import PanelShell from '@/components/common/PanelShell.vue'
import IssueCard from '@/components/issues/IssueCard.vue'
import IssuePanelHeader from '@/components/issues/IssuePanelHeader.vue'
import { ISSUE_ITEM, ISSUE_LEVEL, ISSUE_STATUS, TASK_STATUS } from '@/constants/dashboard'
import { isLateIssue } from '@/lib/schedule'
import { applySort } from '@/lib/sort'
import { useFilterStore } from '@/stores/filter'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Issue, IssueItem, IssueLevel, IssueStatus } from '@/types/models'

/** Issue 狀態的小圓點沿用任務狀態的 dot。legacy :3563 */
const ISSUE_DOT = { open: 'todo', doing: 'doing', paused: 'paused', closed: 'done' } as const
const GROUP_LABEL = { status: '處理狀態', level: '等級', item: '分類' } as const

const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const memberStore = useMemberStore()
const filter = useFilterStore()

const sortCtx = computed(() => ({
  taskById: taskStore.taskById,
  memberById: memberStore.byId,
  openIssueCount: issueStore.openCount,
}))

/**
 * Issue 面板永遠只顯示符合篩選的任務底下的 Issue（用 matchTask，不是 passTask；legacy :3119），
 * 再套 Issue 專屬的等級 / 狀態篩選與排序。
 */
const visibleIssues = computed<Issue[]>(() => {
  let list = issueStore.issues.filter((i) => {
    const t = taskStore.taskById(i.taskId)
    return !!t && filter.matchTask(t)
  })
  if (filter.issueLevels.length) list = list.filter((i) => filter.issueLevels.includes(i.level))
  if (filter.issueStatuses.length) {
    list = list.filter(
      (i) =>
        filter.issueStatuses.includes(i.status) ||
        (filter.issueStatuses.includes('delayed') && isLateIssue(i, ui.todayIdx)),
    )
  }
  return applySort(list, filter.issueSort, 'issue', sortCtx.value)
})

interface Column {
  k: string
  label: string
  color: string
  items: Issue[]
}

const columns = computed<Column[]>(() => {
  const by = filter.issueGroupBy
  const defs: { k: string; label: string; color: string; of: (i: Issue) => string }[] =
    by === 'status'
      ? (['open', 'doing', 'paused', 'closed'] as IssueStatus[]).map((k) => ({
          k,
          label: ISSUE_STATUS[k].label,
          color: TASK_STATUS[ISSUE_DOT[k]].dot,
          of: (i) => i.status,
        }))
      : by === 'level'
        ? (['A', 'B', 'C', 'D'] as IssueLevel[]).map((k) => ({
            k,
            label: ISSUE_LEVEL[k].label,
            color: ISSUE_LEVEL[k].color,
            of: (i) => i.level,
          }))
        : (Object.keys(ISSUE_ITEM) as IssueItem[]).map((k) => ({
            k,
            label: ISSUE_ITEM[k].zh,
            color: 'var(--text-placeholder)',
            of: (i) => i.item || 'O',
          }))

  const buckets = new Map<string, Issue[]>(defs.map((d) => [d.k, []]))
  for (const i of visibleIssues.value) buckets.get(defs[0]!.of(i))?.push(i)
  return defs.map((d) => ({ k: d.k, label: d.label, color: d.color, items: buckets.get(d.k) ?? [] }))
})

const gridCols = computed(() => `repeat(${columns.value.length}, minmax(0, 1fr))`)

/** 「共 N 筆 Issue」／「已篩選 N/M 筆 Issue」。legacy `issueCountLabel` :3533 */
const issueCountLabel = computed(() => {
  const n = issueStore.issues.length
  const c = visibleIssues.value.length
  return c === n ? `共 ${n} 筆 Issue` : `已篩選 ${c}/${n} 筆 Issue`
})

const groupOptions = [
  { k: 'status', label: GROUP_LABEL.status },
  { k: 'level', label: GROUP_LABEL.level },
  { k: 'item', label: GROUP_LABEL.item },
] as const

function pickGroupBy(k: 'status' | 'level' | 'item'): void {
  filter.issueGroupBy = k
  ui.openDropdown = null
}
</script>

<template>
  <PanelShell panel="issues">
    <template #head>
      <h2 class="panel-title">Issue 看板</h2>
      <div class="panel-count" data-testid="issue-count">{{ issueCountLabel }}</div>
      <div class="tools">
        <div class="dd">
          <div
            class="dashed-trigger"
            data-dd="1"
            role="button"
            @click="ui.toggleDropdown('igroup')"
          >
            <span class="tool-icon">▦</span><span>分組</span>
            <span class="tool-value">{{ GROUP_LABEL[filter.issueGroupBy] }}</span>
          </div>
          <div v-if="ui.openDropdown === 'igroup'" class="dd-menu" data-dd="1">
            <div
              v-for="o in groupOptions"
              :key="o.k"
              class="dd-item"
              :class="{ on: filter.issueGroupBy === o.k }"
              role="button"
              @click="pickGroupBy(o.k)"
            >
              <span class="dd-label">{{ o.label }}</span>
              <span class="dd-check">{{ filter.issueGroupBy === o.k ? '✓' : '' }}</span>
            </div>
          </div>
        </div>
        <!-- 排序 chip 與排序選單是 S4 的範圍，這裡只放觸發鈕 -->
        <div class="dashed-trigger" data-dd="1" role="button" @click="ui.toggleDropdown('isort')">
          <span class="tool-icon">⇅</span><span>排序</span>
        </div>
      </div>
      <div class="spacer"></div>
      <button class="mini">＋ 新增 Issue</button>
    </template>

    <div class="board" :style="{ gridTemplateColumns: gridCols }">
      <div v-for="c in columns" :key="c.k" class="col">
        <IssuePanelHeader :label="c.label" :color="c.color" :count="c.items.length" />
        <div class="col-body">
          <IssueCard v-for="i in c.items" :key="i.id" :issue="i" />
        </div>
      </div>
    </div>
  </PanelShell>
</template>

<style scoped>
.panel-title {
  font-size: var(--fs-panel);
  font-weight: var(--fw-bold);
  margin: 0;
}

.panel-count {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.spacer {
  flex: 1;
}

.tools {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  flex-wrap: nowrap;
  min-width: 0;
}

.dd {
  position: relative;
  flex: 0 0 auto;
}

.dashed-trigger {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 26px;
  padding: 0 var(--sp-5);
  font-size: var(--fs-meta);
  border: 1px dashed var(--border-control);
  border-radius: var(--r-pill);
  color: var(--text-muted);
  background: var(--surface-1);
  cursor: pointer;
  white-space: nowrap;
}

.dashed-trigger:hover {
  border-color: var(--text-placeholder);
  color: var(--text-2);
}

.tool-icon {
  font-size: var(--fs-caption);
}

.tool-value {
  color: var(--accent-hover);
  font-weight: 600;
}

.dd-menu {
  position: absolute;
  top: 30px;
  left: 0;
  z-index: 100;
  min-width: 150px;
  padding: var(--sp-2);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
  animation: popIn var(--t-menu) ease-out;
}

.dd-item {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: 28px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-control);
  font-size: var(--fs-control);
  color: var(--text-2);
  cursor: pointer;
}

.dd-item.on {
  color: var(--accent-hover);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.dd-item:hover {
  background: var(--surface-3);
}

.dd-label {
  flex: 1;
}

.dd-check {
  font-size: var(--fs-pill);
  color: var(--accent);
}

.mini {
  height: var(--sp-12);
  padding: 0 var(--sp-5);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  border-radius: var(--r-control);
  cursor: pointer;
  font-size: var(--fs-meta);
  color: var(--text-2);
  display: flex;
  align-items: center;
}

.mini:hover {
  background: var(--surface-3);
  border-color: var(--text-placeholder);
  color: var(--text-1);
}

.board {
  display: grid;
  gap: var(--sp-5);
  padding: var(--sp-6);
  background: var(--surface-2);
  border-radius: 0 0 var(--r-panel) var(--r-panel);
}

.col {
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.col-body {
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-height: 90px;
}
</style>
