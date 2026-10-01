<script setup lang="ts">
// 任務 / Issue 的詳細視窗外殼：遮罩、開關動畫、鎖 body 捲動，內容分左（屬性）右（留言 / 檔案）。
// legacy 對照：模板 :858-1292，detailOpen / modalAnim / detailClose :3795-3812，鎖捲動 :1765-1771。
import { computed, ref, watch } from 'vue'
import ActivityToolbar from '@/components/detail/ActivityToolbar.vue'
import CommentsTab from '@/components/detail/CommentsTab.vue'
import DetailHeader from '@/components/detail/DetailHeader.vue'
import FilesTab from '@/components/detail/FilesTab.vue'
import IssueProperties from '@/components/detail/IssueProperties.vue'
import TaskProperties from '@/components/detail/TaskProperties.vue'
import { useEditDraft } from '@/composables/useEditDraft'
import { useScrollLock } from '@/composables/useScrollLock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const comment = useCommentStore()

/**
 * 開著的詳情。關閉動畫交給 <Transition>：離場中的 DOM 停在關閉前最後一次畫出的樣子
 * （子元件已卸載、不再更新），刪除後的淡出、從任務點進的 Issue 的返回膠囊都不會先變（G3 / G4），
 * 不用另外保存快照（legacy 用 `_lastDetail` :3066）。
 */
const shown = computed(() => ui.detail)

/** 畫面上有詳情（含關閉動畫還在跑）：鎖捲動撐到離場結束，遮罩還深色時捲軸不先冒回來。 */
const present = ref(!!ui.detail)
watch(
  () => !!ui.detail,
  (v) => {
    if (v) present.value = true
  },
  { flush: 'sync' },
)
useScrollLock(present)

/** 離場動畫結束（或被「關閉途中又開」提早結束）時才放開；又開了就繼續鎖。 */
function onAfterLeave(): void {
  present.value = !!ui.detail
}

const task = computed(() =>
  shown.value?.kind === 'task' ? taskStore.taskById(shown.value.id) : undefined,
)
const issue = computed(() =>
  shown.value?.kind === 'issue' ? issueStore.byId(shown.value.id) : undefined,
)

/** 堆疊導覽：Issue 詳情是從某個任務點進來的，標題列要出現返回鈕。legacy `stackOpen` :3805 */
const stackTitle = computed(() => {
  const from = ui.detail?.from
  if (!from || ui.detail?.kind !== 'issue') return null
  return taskStore.taskById(from)?.name ?? ''
})

const name = computed(() => task.value?.name ?? issue.value?.title ?? '')

/** 任務 ↔ Issue 切換時左右滑入。legacy `paneAnim` :3804 */
const paneClass = computed(() =>
  ui.navAnim === 'in' ? 'pane-in' : ui.navAnim === 'back' ? 'pane-back' : '',
)

/**
 * 標題草稿屬於哪一筆：打字當下開著的那一筆。debounce 到期前詳情可能已經關掉或換到別筆
 * （平板點遮罩不會 blur），送出一律送回這一筆，實體已刪就略過。
 */
let draftTarget: { kind: 'task' | 'issue'; id: string } | null = null

/** 草稿那一筆目前的名稱；還沒打過字時看開著的這一筆。 */
function draftName(): string {
  const t = draftTarget
  if (!t) return name.value
  return (t.kind === 'task' ? taskStore.taskById(t.id)?.name : issueStore.byId(t.id)?.title) ?? ''
}

/**
 * 改標題：任務寫 name、Issue 寫 title。legacy `detail.onName` :3094 / :3292。
 * 本地逐鍵、api debounce 300ms，離開編輯時由 DetailHeader 的 `flush` 事件送出（契約 B-2）。
 */
const titleDraft = useEditDraft({
  get: draftName,
  applyLocal: (v) => {
    if (task.value) {
      draftTarget = { kind: 'task', id: task.value.id }
      taskStore.applyLocalPatch(task.value.id, { name: v })
    } else if (issue.value) {
      draftTarget = { kind: 'issue', id: issue.value.id }
      issueStore.applyLocalPatch(issue.value.id, { title: v })
    }
  },
  commit: async (v) => {
    const t = draftTarget
    if (!t) return
    if (t.kind === 'task') {
      if (taskStore.taskById(t.id)) await taskStore.commitTaskPatch(t.id, { name: v })
    } else if (issueStore.byId(t.id)) {
      await issueStore.commitIssuePatch(t.id, { title: v })
    }
  },
  // 詳情標題的 ui.editing 是 { kind: 'dt', id: 這一筆的 id }
  editingId: () => task.value?.id ?? issue.value?.id ?? null,
})

// 關閉或換到別筆的當下，把還沒送的標題草稿送出去（不等 debounce）
watch(
  () => ui.detail?.id,
  (id, old) => {
    if (old && id !== old) void titleDraft.flush()
  },
)

function rename(v: string): void {
  titleDraft.onInput(v)
}
</script>

<template>
  <Transition name="detail-fade">
    <div v-if="shown" class="detail-backdrop" @click="ui.closeDetail()"></div>
  </Transition>
  <Transition name="detail-pop" @after-leave="onAfterLeave">
    <div v-if="shown" class="detail-layer">
      <div class="detail-modal" role="dialog" aria-modal="true">
        <DetailHeader
          :name="name"
          :edit-id="shown.id"
          :stack-title="stackTitle"
          :pane-class="paneClass"
          @update:name="rename"
          @flush="titleDraft.flush()"
        />

        <div class="detail-body" :class="paneClass">
          <div class="detail-left">
            <TaskProperties v-if="task" :task="task" />
            <IssueProperties v-else-if="issue" :issue="issue" />
          </div>

          <div class="detail-right">
            <ActivityToolbar :target-id="shown.id" />
            <CommentsTab
              v-if="comment.tab === 'comments'"
              :target-id="shown.id"
              :target-kind="shown.kind"
            />
            <FilesTab v-else :target-id="shown.id" />
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.detail-backdrop {
  position: fixed;
  inset: 0;
  background: var(--backdrop-modal);
  z-index: 170;
}

/* 外層只負責置中；pointer-events 關掉讓遮罩仍吃得到點擊（legacy :862） */
.detail-layer {
  position: fixed;
  inset: 0;
  z-index: 180;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-12);
  pointer-events: none;
}

.detail-modal {
  position: relative;
  pointer-events: auto;
  width: var(--modal-w);
  height: var(--modal-h);
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border-radius: var(--r-modal);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

/*
 * 開關用 <Transition> 的 class（不是 keyframes）：開到一半就關時從當下的值往回走，keyframes 會從頭（全亮）重播（G10）。
 * 外觀同 popIn / popOut；Modal 的淡入淡出寫在外層 layer（Transition 的根元素，Vue 量它的過渡長度），位移縮放寫在 Modal。
 * 遮罩（detail-fade）與 layer（detail-pop）的離場時長必須相同：鎖捲動的解鎖綁在 layer 的 after-leave，
 * 遮罩比 layer 長的話，解鎖時遮罩還看得到、捲軸先冒回來（G1）；比 layer 短的話 Modal 會先失去遮罩。
 */
.detail-fade-enter-active,
.detail-fade-leave-active {
  transition: opacity var(--t-modal) ease-out;
}

.detail-pop-enter-active,
.detail-pop-leave-active {
  transition: opacity var(--t-modal) var(--ease);
}

.detail-fade-enter-from,
.detail-fade-leave-to,
.detail-pop-enter-from,
.detail-pop-leave-to {
  opacity: 0;
}

.detail-pop-enter-active .detail-modal,
.detail-pop-leave-active .detail-modal {
  transition: transform var(--t-modal) var(--ease);
}

.detail-pop-enter-from .detail-modal {
  transform: var(--pop-from);
}

.detail-pop-leave-to .detail-modal {
  transform: var(--pop-to);
}

/* 離場中不攔點擊（G2）：Modal 自己寫了 pointer-events: auto，要一起壓掉 */
.detail-fade-leave-active,
.detail-pop-leave-active .detail-modal {
  pointer-events: none;
}

.detail-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.detail-left {
  width: var(--modal-left-pane);
  flex: 0 0 var(--modal-left-pane);
  border-right: 1px solid var(--border-hair);
  padding: var(--sp-9) var(--sp-10);
  overflow: auto;
}

.detail-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-2);
}

/* 任務 ↔ Issue 切換的方向感（legacy paneIn / paneBack :3804） */
.pane-in {
  animation: paneIn var(--t-layout) var(--ease);
}

.pane-back {
  animation: paneBack var(--t-layout) var(--ease);
}
</style>
