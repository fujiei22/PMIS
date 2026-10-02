import { api } from '@/api'
import type { ProjectEvent } from '@/api/types'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useProjectStore } from '@/stores/project'
import { useTaskStore } from '@/stores/task'

/**
 * 後端事件的**唯一**訂閱點（契約 B、review M6）。
 *
 * 事件依專案訂閱：`start(projectId)` 只收那個專案的事件（id 由 `useProjectBoot` 傳入，就是路由的 `:id`）。
 * `DashboardView` 在 onMounted 經 boot 呼叫 `start`、onBeforeUnmount 呼叫 `stop()`；
 * 其他地方一律不要自己 `api.subscribe`，否則同一則事件會被套用兩次。
 * 路由規則只看 type 的前綴，各 store 的 `applyEvent` 自己判斷要不要動本地（契約 B）。
 */
export function useProjectSync(): { start: (projectId: string) => void; stop: () => void } {
  const taskStore = useTaskStore()
  const issueStore = useIssueStore()
  const commentStore = useCommentStore()
  let off: (() => void) | null = null

  function route(e: ProjectEvent): void {
    if (e.type === 'project.reloaded') {
      // 重連後後端會補一次整包（契約 A）；順序也可能變了，直接重載
      void taskStore.load(e.payload)
      return
    }
    if (e.type === 'project.updated') {
      useProjectStore().setMeta(e.payload)
      return
    }
    if (e.type.startsWith('issue.')) issueStore.applyEvent(e)
    else if (e.type.startsWith('comment.')) commentStore.applyEvent(e)
    else taskStore.applyEvent(e)
  }

  function start(projectId: string): void {
    if (off) return
    off = api.subscribe(projectId, route)
  }

  function stop(): void {
    off?.()
    off = null
  }

  return { start, stop }
}
