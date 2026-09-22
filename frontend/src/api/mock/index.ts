import { createMockStore } from '@/api/mock/store'
import { ApiError, type MockApi, type ProjectApi, type ProjectEvent } from '@/api/types'
import { sampleProject } from '@/mocks/sampleProject'
import type {
  Comment,
  Dependency,
  Group,
  Issue,
  ProjectData,
  Task,
} from '@/types/models'

/**
 * 記憶體版的 `ProjectApi`：後端還不存在時的唯一實作，也是單元測試與 e2e 的替身。
 *
 * 傳輸行為刻意做成「事件先於 response」：
 * 資料改動與事件廣播在呼叫的當下同步發生，response 才在 `latency` 之後 resolve。
 * 真後端也是這個順序（server 先寫入並廣播，回應才走完網路），
 * R2 的乐觀更新必須在「事件先到」與「事件後到」兩種順序下都正確，
 * 後者用 `mockApi.emit()` 手動製造。
 *
 * review F11：預設資料由這一層自己帶。`src/api/index.ts` 是所有 build 都會走的
 * 進入點，它 import `@/mocks/*` 等於把示範資料釘進每一份 bundle。
 */
export function createMockApi(initial: ProjectData = structuredClone(sampleProject)): MockApi {
  const store = createMockStore(initial)
  const handlers = new Set<(e: ProjectEvent) => void>()
  /** 方法 → 還要擋幾次、擋的時候丟什麼。 */
  const failures = new Map<keyof ProjectApi, { times: number; err?: ApiError }>()
  let latency = 0

  function emit(e: ProjectEvent): void {
    // review M4：一個 handler 拋錯不能連累其他 handler，更不能讓呼叫端的 promise 變成 reject
    for (const h of handlers) {
      try {
        h(e)
      } catch (err) {
        console.error('[mock api] 事件 handler 拋錯', e.type, err)
      }
    }
  }

  /** 取出並消耗一次注入的失敗；沒有就回 undefined。 */
  function takeFailure(method: keyof ProjectApi): ApiError | undefined {
    const hit = failures.get(method)
    if (!hit) return undefined
    if (hit.times <= 1) failures.delete(method)
    else hit.times--
    return hit.err ?? new ApiError('network', `注入的失敗（mock）：${method}`, undefined, method)
  }

  /** 把已經算好的結果包成 promise，延遲只影響 resolve 的時機。 */
  function settle<T>(make: () => T): Promise<T> {
    if (latency <= 0) return Promise.resolve().then(make)
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(make())
        } catch (err) {
          reject(err)
        }
      }, latency)
    })
  }

  /**
   * 一次呼叫的完整流程：注入的失敗 → 動資料（同時發事件）→ 依 latency resolve。
   * `work` 拋錯（409 / 404 / 422）時資料不會被改到，錯誤照樣走 latency 才 reject。
   */
  function call<T>(method: keyof ProjectApi, work: () => T): Promise<T> {
    const injected = takeFailure(method)
    if (injected) return settle<T>(() => {
      throw injected
    })
    let result: T
    try {
      result = work()
    } catch (err) {
      return settle<T>(() => {
        throw asApiError(err, method)
      })
    }
    return settle(() => result)
  }

  /** store 丟出來的已經是 ApiError；其他意外包成 unknown，並補上是哪個方法出的事。 */
  function asApiError(err: unknown, method: keyof ProjectApi): ApiError {
    if (err instanceof ApiError) {
      err.method ??= method
      return err
    }
    return new ApiError('unknown', err instanceof Error ? err.message : String(err), undefined, method)
  }

  return {
    loadProject: () => call('loadProject', () => store.snapshot()),

    createTask: (task: Task) =>
      call('createTask', () => {
        const out = store.createTask(task)
        emit({ type: 'task.created', payload: out })
        return out
      }),

    updateTask: (id: string, patch: Partial<Task>) =>
      call('updateTask', () => {
        const out = store.updateTask(id, patch)
        emit({ type: 'task.updated', payload: out })
        return out
      }),

    updateTasks: (tasks: Task[]) =>
      call('updateTasks', () => {
        const out = store.updateTasks(tasks)
        for (const t of out) emit({ type: 'task.updated', payload: t })
        return out
      }),

    deleteTask: (id: string) =>
      call('deleteTask', () => {
        const gone = store.deleteTask(id)
        emitCascade(gone)
        emit({ type: 'task.deleted', payload: { id } })
      }),

    reorderTasks: (order: { id: string; groupId: string }[]) =>
      call('reorderTasks', () => {
        // 純順序變更沒有對應事件（見 types.ts）；換了分類的才補一則 task.updated
        for (const t of store.reorderTasks(order)) emit({ type: 'task.updated', payload: t })
      }),

    createGroup: (g: Group) =>
      call('createGroup', () => {
        const out = store.createGroup(g)
        emit({ type: 'group.created', payload: out })
        return out
      }),

    updateGroup: (id: string, patch: Partial<Group>) =>
      call('updateGroup', () => {
        const out = store.updateGroup(id, patch)
        emit({ type: 'group.updated', payload: out })
        return out
      }),

    deleteGroup: (id: string) =>
      call('deleteGroup', () => {
        const gone = store.deleteGroup(id)
        emitCascade(gone)
        for (const taskId of gone.tasks) emit({ type: 'task.deleted', payload: { id: taskId } })
        emit({ type: 'group.deleted', payload: { id } })
      }),

    reorderGroups: (ids: string[]) => call('reorderGroups', () => store.reorderGroups(ids)),

    createDep: (d: Dependency) =>
      call('createDep', () => {
        const out = store.createDep(d)
        emit({ type: 'dep.created', payload: out })
        return out
      }),

    deleteDep: (id: string) =>
      call('deleteDep', () => {
        store.deleteDep(id)
        emit({ type: 'dep.deleted', payload: { id } })
      }),

    createIssue: (i: Issue) =>
      call('createIssue', () => {
        const out = store.createIssue(i)
        emit({ type: 'issue.created', payload: out })
        return out
      }),

    updateIssue: (id: string, patch: Partial<Issue>) =>
      call('updateIssue', () => {
        const out = store.updateIssue(id, patch)
        emit({ type: 'issue.updated', payload: out })
        return out
      }),

    deleteIssue: (id: string) =>
      call('deleteIssue', () => {
        const gone = store.deleteIssue(id)
        for (const c of gone.comments) emit({ type: 'comment.deleted', payload: { id: c } })
        emit({ type: 'issue.deleted', payload: { id } })
      }),

    createComment: (c: Comment, files: File[]) =>
      call('createComment', () => {
        const out = store.createComment(c, files)
        emit({ type: 'comment.created', payload: out })
        return out
      }),

    deleteComment: (id: string) =>
      call('deleteComment', () => {
        store.deleteComment(id)
        emit({ type: 'comment.deleted', payload: { id } })
      }),

    downloadAttachment: (attachmentId: string) =>
      call('downloadAttachment', () => store.attachment(attachmentId)),

    subscribe(handler: (e: ProjectEvent) => void): () => void {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },

    // ── 測試鉤子 ──────────────────────────────────────────────────────────
    emit,

    failNext(method: keyof ProjectApi, err?: ApiError, times = 1): void {
      if (times <= 0) failures.delete(method)
      else failures.set(method, { times, err })
    },

    setLatency(ms: number): void {
      latency = Math.max(0, ms)
    },

    reset(data?: ProjectData): void {
      store.reset(data ?? initial)
      failures.clear()
      latency = 0
    },
  }

  /** 連動刪除：被一起刪掉的 issue / dep / comment 各發一則 deleted。 */
  function emitCascade(gone: { issues: string[]; deps: string[]; comments: string[] }): void {
    for (const id of gone.issues) emit({ type: 'issue.deleted', payload: { id } })
    for (const id of gone.deps) emit({ type: 'dep.deleted', payload: { id } })
    for (const id of gone.comments) emit({ type: 'comment.deleted', payload: { id } })
  }
}
