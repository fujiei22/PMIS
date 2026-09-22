<script setup lang="ts">
// 任務 / Issue 的詳細視窗外殼：遮罩、開關動畫、鎖 body 捲動，內容分左（屬性）右（留言 / 檔案）。
// legacy 對照：模板 :858-1292，detailOpen / modalAnim / detailClose :3795-3812，鎖捲動 :1765-1771。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ActivityToolbar from '@/components/detail/ActivityToolbar.vue'
import CommentsTab from '@/components/detail/CommentsTab.vue'
import DetailHeader from '@/components/detail/DetailHeader.vue'
import FilesTab from '@/components/detail/FilesTab.vue'
import IssueProperties from '@/components/detail/IssueProperties.vue'
import TaskProperties from '@/components/detail/TaskProperties.vue'
import { useEditDraft } from '@/composables/useEditDraft'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const comment = useCommentStore()

/** 關閉動畫的 320ms 內 detail 已是 null，改畫 lastDetail 的快照。legacy :3795 */
const shown = computed(() => ui.detail ?? ui.lastDetail ?? null)
/** 真的開著（false = 正在播關閉動畫）。 */
const open = computed(() => !!ui.detail)

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
/** 刪除後資料已經沒了，標題改用關閉前記下的字，免得關閉動畫途中整段閃成空白。 */
const nameSnapshot = ref('')
watch(name, (v) => {
  if (v) nameSnapshot.value = v
})
const headerName = computed(() => name.value || nameSnapshot.value)

/** 任務 ↔ Issue 切換時左右滑入。legacy `paneAnim` :3804 */
const paneClass = computed(() =>
  ui.navAnim === 'in' ? 'pane-in' : ui.navAnim === 'back' ? 'pane-back' : '',
)

/**
 * 改標題：任務寫 name、Issue 寫 title。legacy `detail.onName` :3094 / :3292。
 * 本地逐鍵、api debounce 300ms，離開編輯時由 DetailHeader 的 `flush` 事件送出（契約 B-2）。
 */
const titleDraft = useEditDraft({
  get: () => name.value,
  applyLocal: (v) => {
    if (task.value) taskStore.applyLocalPatch(task.value.id, { name: v })
    else if (issue.value) issueStore.applyLocalPatch(issue.value.id, { title: v })
  },
  commit: async (v) => {
    if (task.value) await taskStore.commitTaskPatch(task.value.id, { name: v })
    else if (issue.value) await issueStore.commitIssuePatch(issue.value.id, { title: v })
  },
  // 詳情標題的 ui.editing 是 { kind: 'dt', id: 這一筆的 id }
  editingId: () => task.value?.id ?? issue.value?.id ?? null,
})

function rename(v: string): void {
  titleDraft.onInput(v)
}

// ── 鎖 body 捲動（legacy componentDidUpdate :1765-1771）──────────────────────
let savedScrollY = 0
watch(open, (v) => {
  if (v) {
    savedScrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    return
  }
  document.body.style.overflow = ''
  window.scrollTo(0, savedScrollY)
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <template v-if="shown">
    <div class="detail-backdrop" :class="{ closing: !open }" @click="ui.closeDetail()"></div>
    <div class="detail-layer">
      <div class="detail-modal" :class="{ closing: !open }" role="dialog" aria-modal="true">
        <DetailHeader
          :name="headerName"
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
  </template>
</template>

<style scoped>
.detail-backdrop {
  position: fixed;
  inset: 0;
  background: var(--backdrop-modal);
  z-index: 170;
  animation: fadeIn var(--t-modal) ease-out;
}

.detail-backdrop.closing {
  animation: fadeOut var(--t-modal) ease-out forwards;
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
  animation: popIn var(--t-modal) var(--ease);
}

.detail-modal.closing {
  animation: popOut var(--t-modal) var(--ease) forwards;
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
