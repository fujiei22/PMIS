<script setup lang="ts">
// 相依編輯器：列出一個任務的前置與後續，並用 <select> 新增。
// 候選會排除自己、已建立的那條，以及會造成循環的任務（reachable）。
// legacy 對照：模板 :1412-1457，depPreds / depPredOptions :4030-4058。
import { computed } from 'vue'
import { reachable } from '@/lib/schedule'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const taskStore = useTaskStore()

const targetId = computed(() => ui.depEditFor)
const target = computed(() => (targetId.value ? taskStore.taskById(targetId.value) : undefined))

interface DepRow {
  /** dependency 的 id，移除時用。 */
  id: string
  name: string
  range: string
}

function rowOf(depId: string, taskId: string): DepRow {
  const t = taskStore.taskById(taskId)
  return {
    id: depId,
    name: t?.name ?? '（已刪除）',
    range: t ? `${t.start} → ${t.end}` : '',
  }
}

const preds = computed<DepRow[]>(() =>
  taskStore.deps.filter((d) => d.to === targetId.value).map((d) => rowOf(d.id, d.from)),
)
const succs = computed<DepRow[]>(() =>
  taskStore.deps.filter((d) => d.from === targetId.value).map((d) => rowOf(d.id, d.to)),
)

/** 可以當前置的任務：不是自己、還沒連過、且反過來走不到（連了不會成環）。legacy :4047 */
const predOptions = computed(() => {
  const id = targetId.value
  if (!id) return []
  return taskStore.tasks.filter(
    (t) =>
      t.id !== id &&
      !taskStore.deps.some((d) => d.from === t.id && d.to === id) &&
      !reachable(id, t.id, taskStore.deps),
  )
})

/** 可以當後續的任務；判斷方向與前置相反。legacy :4052 */
const succOptions = computed(() => {
  const id = targetId.value
  if (!id) return []
  return taskStore.tasks.filter(
    (t) =>
      t.id !== id &&
      !taskStore.deps.some((d) => d.from === id && d.to === t.id) &&
      !reachable(t.id, id, taskStore.deps),
  )
})

/** 選完把 select 拉回空白選項，才能再選同一個。legacy :4057 */
function addPred(e: Event): void {
  const el = e.target as HTMLSelectElement
  const v = el.value
  el.value = ''
  if (v && targetId.value) taskStore.addDep(v, targetId.value)
}

function addSucc(e: Event): void {
  const el = e.target as HTMLSelectElement
  const v = el.value
  el.value = ''
  if (v && targetId.value) taskStore.addDep(targetId.value, v)
}

function close(): void {
  ui.depEditFor = null
}
</script>

<template>
  <div v-if="target" class="dep-backdrop" @click="close()">
    <div class="dep-editor" role="dialog" aria-modal="true" @click.stop>
      <div class="dep-title">相依關係</div>
      <div class="dep-sub">
        {{ target.name }}｜可設定多個前置與多個後續任務，下游開始日不會早於上游結束日
      </div>

      <div class="dep-section">前置任務（必須先完成）</div>
      <div class="dep-list">
        <div v-for="p in preds" :key="p.id" class="dep-row dep-pred-row">
          <div class="dep-name">{{ p.name }}</div>
          <div class="dep-range">{{ p.range }}</div>
          <div class="dep-x" role="button" @click="taskStore.removeDep(p.id)">✕</div>
        </div>
      </div>
      <select class="dep-select dep-pred-select" @change="addPred">
        <option value="">＋ 新增前置任務…</option>
        <option v-for="o in predOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
      </select>

      <div class="dep-section">後續任務（等待此任務）</div>
      <div class="dep-list">
        <div v-for="s in succs" :key="s.id" class="dep-row dep-succ-row">
          <div class="dep-name">{{ s.name }}</div>
          <div class="dep-range">{{ s.range }}</div>
          <div class="dep-x" role="button" @click="taskStore.removeDep(s.id)">✕</div>
        </div>
      </div>
      <select class="dep-select dep-succ-select" @change="addSucc">
        <option value="">＋ 新增後續任務…</option>
        <option v-for="o in succOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
      </select>

      <div class="dep-actions">
        <button class="dep-done" @click="close()">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dep-backdrop {
  position: fixed;
  inset: 0;
  background: var(--backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: var(--sp-10);
  animation: fadeIn var(--t-pop) ease-out;
}

.dep-editor {
  width: 100%;
  max-width: 460px;
  background: var(--surface-1);
  border-radius: var(--r-dialog);
  padding: var(--sp-10);
  box-shadow: var(--shadow-dialog);
  max-height: 80vh;
  overflow: auto;
  animation: popIn var(--t-fast) ease-out;
}

.dep-title {
  font-size: var(--fs-dialog);
  font-weight: var(--fw-bold);
  margin-bottom: var(--sp-2);
}

.dep-sub {
  font-size: 13.7px;
  color: var(--text-muted);
  margin-bottom: var(--sp-8);
}

.dep-section {
  font-size: 13.2px;
  font-weight: var(--fw-bold);
  color: var(--text-2);
  margin-bottom: 7px;
}

.dep-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin-bottom: 9px;
}

.dep-row {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: 7px 9px;
  border: 1px solid var(--border-1);
  border-radius: var(--r-input);
  background: var(--surface-2);
}

.dep-name {
  font-size: 13.7px;
  color: var(--text-1);
  flex: 1;
  min-width: 0;
}

.dep-range {
  font-size: var(--fs-date);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.dep-x {
  font-size: 13.2px;
  color: var(--glyph-disabled);
  cursor: pointer;
}

.dep-x:hover {
  color: var(--danger);
}

.dep-select {
  appearance: none;
  width: 100%;
  padding: 7px 26px 7px var(--sp-5);
  font-size: 13.2px;
  border: 1px dashed var(--border-control);
  border-radius: var(--r-pill);
  color: var(--text-3);
  background-color: var(--surface-1);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0h8L4 5z' fill='%2394a3b8'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--sp-5) center;
  margin-bottom: var(--sp-9);
  cursor: pointer;
  font-family: inherit;
}

.dep-select:last-of-type {
  margin-bottom: 0;
}

.dep-select:hover {
  border-color: var(--text-placeholder);
  color: var(--text-2);
}

.dep-select:focus {
  border-color: var(--accent);
  outline: none;
}

.dep-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--sp-9);
}

.dep-done {
  padding: var(--sp-4) var(--sp-7);
  font-size: var(--fs-month);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  border-radius: var(--r-input);
  cursor: pointer;
  color: var(--text-2);
}

.dep-done:hover {
  border-color: var(--text-placeholder);
  color: var(--text-1);
}
</style>
