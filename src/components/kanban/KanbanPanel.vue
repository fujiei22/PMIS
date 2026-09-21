<script setup lang="ts">
// 任務看板：四個狀態欄，卡片依 filter.taskSort 排序。
// legacy 對照：模板 :533-642，columns :2989-3117。
import { computed } from 'vue'
import PanelShell from '@/components/common/PanelShell.vue'
import SortChips from '@/components/common/SortChips.vue'
import SortMenu from '@/components/common/SortMenu.vue'
import KanbanHeader from '@/components/kanban/KanbanHeader.vue'
import TaskCard from '@/components/kanban/TaskCard.vue'
import { useDomRegistry, registerEl } from '@/composables/useDomRegistry'
import { useFocusRequest, scrollIntoContainer } from '@/composables/useFocusScroll'
import { useTaskActions } from '@/composables/useTaskActions'
import { TASK_STATUS } from '@/constants/dashboard'
import { applySort } from '@/lib/sort'
import { useClockStore } from '@/stores/clock'
import { useFilterStore } from '@/stores/filter'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useTaskStore } from '@/stores/task'
import type { TaskStatus } from '@/types/models'

/** 看板欄的順序，逐字取自 legacy :2989。 */
const COLUMNS: TaskStatus[] = ['todo', 'doing', 'paused', 'done']

const actions = useTaskActions()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const memberStore = useMemberStore()
const filter = useFilterStore()
const clock = useClockStore()
const registry = useDomRegistry()

const sortCtx = computed(() => ({
  taskById: taskStore.taskById,
  memberById: memberStore.byId,
  openIssueCount: issueStore.openCount,
  // created 沒填時的後備值；lib 不自己讀時鐘（review m5）
  todayIdx: clock.todayIdx,
}))

const columns = computed(() =>
  COLUMNS.map((k) => {
    const list = applySort(
      taskStore.tasks.filter((t) => t.status === k && filter.passTask(t)),
      filter.taskSort,
      'task',
      sortCtx.value,
    )
    return { k, label: TASK_STATUS[k].label, color: TASK_STATUS[k].dot, tasks: list }
  }),
)

/**
 * 選到任務時把它的卡片捲進所在欄位。legacy `focus()` :2404-2411。
 * 來源是卡片本身（src='card'）就不捲——使用者已經看得到它了。
 */
useFocusRequest((req) => {
  if (req.src === 'card') return
  // 卡片與欄位都在登錄表裡（契約 F）；卡片一定在自己狀態那一欄
  const status = taskStore.taskById(req.taskId)?.status
  scrollIntoContainer(registry.cards.get(req.taskId), status && registry.cols.get(status), 10)
})
</script>

<template>
  <PanelShell panel="kanban">
    <template #head>
      <h2 class="panel-title">任務看板</h2>
      <!-- 計數字樣在 filterStore，與甘特共用一份（legacy :3532；review m4） -->
      <div class="panel-count" data-testid="task-count">{{ filter.taskCountLabel }}</div>
      <div class="sorts">
        <SortChips kind="task" />
        <SortMenu kind="task" />
      </div>
      <div class="spacer"></div>
      <button class="mini" @click="taskStore.addGroup()">＋ 新增分類</button>
      <button class="mini" @click="actions.addTaskWithDefaults()">＋ 新增任務</button>
    </template>

    <div class="board">
      <div v-for="c in columns" :key="c.k" class="col">
        <KanbanHeader :label="c.label" :color="c.color" :count="c.tasks.length" />
        <!-- 欄位只吃掉預設行為、不改狀態：legacy 的看板欄 onDrop 就只有 preventDefault（:2994） -->
        <div
          :ref="registerEl(registry.cols, c.k)"
          class="col-body"
          :data-col="c.k"
          @dragover.prevent
          @drop.prevent
        >
          <TaskCard v-for="t in c.tasks" :key="t.id" :task="t" />
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

.sorts {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  flex-wrap: wrap;
  min-width: 0;
}

.mini {
  height: var(--sp-12);
  padding: 0 var(--sp-5);
  display: flex;
  align-items: center;
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  border-radius: var(--r-control);
  cursor: pointer;
  font-size: var(--fs-meta);
  color: var(--text-2);
  white-space: nowrap;
  transition:
    background var(--t-fast) ease,
    border-color var(--t-fast) ease,
    color var(--t-fast) ease;
}

.mini:hover {
  background: var(--surface-3);
  border-color: var(--text-placeholder);
  color: var(--text-1);
}

.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
