import type {
  Comment,
  Dependency,
  Group,
  Issue,
  PortfolioData,
  ProjectData,
  Task,
} from '@/types/models'

/** ===== wire 約定（後端 / adapter 必讀）=====
 * - 讀取兩支、都不分頁：
 *   - loadProject(id) 回單一專案整包；tasks / groups 陣列順序 = 顯示順序（後端自存排序鍵）。
 *     整包裡的 project（id / name / pmId）是專案本身；canEdit 由後端算（登入者是不是這個專案的 PM），
 *     前端不自己拿 pmId 比對登入者——權限規則只留在後端一處。
 *   - listProjects() 回所有專案的摘要（總覽頁）；projects 順序無意義（前端自己排），members 順序 = 顯示順序。
 * - 哪些方法帶 projectId：建立分類（沒有上層實體可以反查專案）、整份重排任務 / 分類、訂閱事件，
 *   第一個參數是 projectId。其他建立 / 修改 / 刪除由後端從實體反查專案（任務看 groupId、Issue 看 taskId、
 *   留言看 targetId），不另外帶。
 * - ProjectSummary 由後端彙整，規則：
 *   - status 不存欄位，依任務算：有任務且全部 done → 'done'；有任何 doing 或 done → 'doing'；
 *     其他（含沒有任務、只有暫停）→ 'todo'。參考實作：api/mock/portfolio.ts 的 projectStatusOf()。
 *   - startDate / dueDate = 任務 start 最小值 / end 最大值；taskPlanned = end 早於伺服器當日的任務數。
 *     前端的已過 / 剩餘天數用前端 clock 算，跨日時可能差一天，可接受。
 *   - delayedTasks = 未完成且 end 已過的任務數（與 Dashboard「已延遲」同定義，和 taskCounts 重疊計數）。
 *   - upcoming = 未完成任務依 end 升冪取前 3（含已逾期），memberId = 第一位負責人，沒有就 ''。
 *   - 不變式：taskDone === taskCounts.done、taskTotal === taskCounts 各項加總；adapter 負責驗。
 *   - 實際 / 理論 %、落後百分點、需注意（alert）**不由後端給**：門檻只存在前端 lib/portfolio.ts。
 *   - 參考實作：api/mock/portfolio.ts 的 summarizeProject()。
 * - Member.color 必須是合法的 CSS 顏色值（例 '#2563eb'），adapter 建議驗證格式。前端目前只經 Vue 的
 *   `:style` 物件綁定寫進 CSS 變數，無法跳脫成其他規則；但日後若有地方改用字串拼接組 CSS，就沒有這層保護。
 * - Member.active = 沒停用。指派類的下拉只列 active 的人，原本就指派給停用者的照樣顯示、可以移除。
 * - id 一律由 client 產（UUID v4）；create 帶 id，重複回 409 conflict。
 * - patch = JSON merge patch（只送有變的欄位）；'' 是有效值（空日期），不是「未設」。adapter 負責 null ↔ ''。
 *   後端收到 patch 要用 schema 白名單逐欄位驗，不可整包 merge（mass-assignment / __proto__）。
 * - updateTasks 是例外：語意是**整批 PUT**，body 是整筆 Task[]（不是 patch），內容已含 cascade 後的下游。
 * - 日期：Task/Issue 的 ISODate 'YYYY-MM-DD'；Comment.at / Attachment.at 前端用本地 'YYYY-MM-DDTHH:mm' / 'YYYY-MM-DD'，後端存 ISO 8601 含 offset，adapter 轉。
 * - 後端不跑 cascade：updateTasks 已含下游、done 已由前端填；後端只存，response 回最終狀態（可糾正）。
 * - 事件依專案訂閱（subscribe(projectId)，只收那個專案的事件；Task 等實體裡沒有專案 id，分專案靠訂閱）。
 *   廣播含發起者；client 對同 id 同值事件 no-op。事件可能早於或晚於對應 response 到達，兩種順序 client 都正確——
 *   這是 client 的責任，後端不必為此排順序。事件的 payload 同樣要走 adapter 轉換（null ↔ ''、日期、Attachment.id）。
 * - project.reloaded 由 adapter 自己造：偵測到重連（EventSource.onopen 第二次起 / WS reconnect）就 loadProject(id) 後 emit，後端不需要做。
 * - Group 沒有 collapsed（UI 狀態）；currentUserId 由 adapter 填（登入未做），只是顯示用，不是身分——authn / authz 每支端點後端自己做。
 */

/**
 * 後端推給 client 的變更事件。
 *
 * 補充（mock 的實作選擇，後端照做即可）：
 * - `reorderTasks` / `reorderGroups` 沒有對應事件——順序不在這個 union 裡。
 *   只有搬動造成 `groupId` 改變時會補一則 `task.updated`；純順序變更要讓其他 client 看到，
 *   靠的是重連時 adapter 自己補的 `project.reloaded`（實務上順序衝突的代價低，先不做細緻同步）。
 * - `deleteTask` / `deleteGroup` / `deleteIssue` 的連動刪除，server 要把每一筆被連帶刪掉的
 *   實體都各發一則 deleted 事件，最後才發主體自己的 deleted（client 依賴這個順序清懸空 id）。
 */
export type ProjectEvent =
  | { type: 'task.created' | 'task.updated'; payload: Task }
  | { type: 'task.deleted'; payload: { id: string } }
  | { type: 'group.created' | 'group.updated'; payload: Group }
  | { type: 'group.deleted'; payload: { id: string } }
  | { type: 'dep.created'; payload: Dependency }
  | { type: 'dep.deleted'; payload: { id: string } }
  | { type: 'issue.created' | 'issue.updated'; payload: Issue }
  | { type: 'issue.deleted'; payload: { id: string } }
  | { type: 'comment.created'; payload: Comment }
  | { type: 'comment.deleted'; payload: { id: string } }
  | { type: 'project.reloaded'; payload: ProjectData }

export type ApiErrorCode =
  'network' | 'validation' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unknown'

/**
 * api 層唯一往外拋的錯誤型別。呼叫端（store）靠 `code` 決定要不要還原與顯示什麼中文。
 *
 * code ↔ HTTP：network = fetch 拋錯 / 無回應；validation = 400, 413, 415, 422；
 * unauthorized = 401（沒登入或登入已失效）；forbidden = 403（登入了但沒有權限，例：改別人的專案）；
 * not_found = 404；conflict = 409；unknown = 其他。message = server 原文（只進 console，不上畫面）。
 */
export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status?: number,
    public method?: keyof ProjectApi,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * 資料進出的唯一介面。store 只認這個介面，換後端就是換一份實作（`src/api/index.ts` 選）。
 *
 * 每個方法後面標的是建議的 REST 端點；後端若不同，在 adapter 裡對應即可，
 * 介面本身（參數、回傳、錯誤碼）才是契約。
 */
export interface ProjectApi {
  /** 整包專案資料（含 `project` 與 `canEdit`）；陣列順序就是顯示順序。 */
  loadProject(id: string): Promise<ProjectData> //                           GET    /api/projects/:id
  /** 所有專案的摘要清單與成員名錄；總覽頁用。 */
  listProjects(): Promise<PortfolioData> //                                  GET    /api/projects

  createTask(task: Task): Promise<Task> //                                   POST   /api/tasks
  updateTask(id: string, patch: Partial<Task>): Promise<Task> //             PATCH  /api/tasks/:id
  /**
   * 語意是**整批 PUT**：body 是整筆 `Task[]`（cascade 結果），不是 patch。
   * response 是 server 最終狀態，client 直接套回。
   */
  updateTasks(tasks: Task[]): Promise<Task[]> //                             PATCH  /api/tasks
  /** server 連動刪 issue / dep / comment。 */
  deleteTask(id: string): Promise<void> //                                   DELETE /api/tasks/:id
  /** 這個專案整份的任務順序 + 每筆的 groupId；後端把它存成排序鍵。 */
  reorderTasks(projectId: string, order: { id: string; groupId: string }[]): Promise<void> // PUT    /api/projects/:pid/tasks/order

  createGroup(projectId: string, g: Group): Promise<Group> //                POST   /api/projects/:pid/groups
  updateGroup(id: string, patch: Partial<Group>): Promise<Group> //          PATCH  /api/groups/:id
  /** server 連動刪底下的任務（以及那些任務的 issue / dep / comment）。 */
  deleteGroup(id: string): Promise<void> //                                  DELETE /api/groups/:id
  /** 這個專案整份的分類 id 順序。 */
  reorderGroups(projectId: string, ids: string[]): Promise<void> //          PUT    /api/projects/:pid/groups/order

  createDep(d: Dependency): Promise<Dependency> //                           POST   /api/deps
  deleteDep(id: string): Promise<void> //                                    DELETE /api/deps/:id

  createIssue(i: Issue): Promise<Issue> //                                   POST   /api/issues
  updateIssue(id: string, patch: Partial<Issue>): Promise<Issue> //          PATCH  /api/issues/:id
  /** server 連動刪它的留言。 */
  deleteIssue(id: string): Promise<void> //                                  DELETE /api/issues/:id

  /**
   * multipart：comment JSON part + files[]；response 的 files 含 server url，
   * client 以 response 覆蓋本地 blob url 並 revoke。
   */
  createComment(c: Comment, files: File[]): Promise<Comment> //              POST   /api/comments
  deleteComment(id: string): Promise<void> //                                DELETE /api/comments/:id
  /** 附件內容；attachmentId = `Attachment.id`。mock 造 demo Blob。 */
  downloadAttachment(attachmentId: string): Promise<Blob> //                 GET    /api/attachments/:id

  /**
   * 訂閱某個專案的變更事件，回傳解訂函式。
   * 事件來源 SSE `/api/projects/:pid/events` 或 WebSocket 或 polling，後端擇一；mock 同步 emit（不分專案）。
   */
  subscribe(projectId: string, handler: (e: ProjectEvent) => void): () => void
}

/**
 * mock 專用的測試鉤子。只有 mock 實作有；e2e 透過 `window.__mockApi` 取用，
 * 接上真後端之後那些測試要 `test.skip(!__mockApi)`。
 */
export interface MockApi extends ProjectApi {
  /** 手動灌一則事件（模擬別的 client 或後端主動推送）。 */
  emit(e: ProjectEvent): void
  /** 讓接下來 times 次呼叫這個方法直接 reject；資料不會被改動。 */
  failNext(method: keyof ProjectApi, err?: ApiError, times?: number): void
  /** 每個呼叫的 response 延遲（ms）；事件仍然同步發出，不等延遲。 */
  setLatency(ms: number): void
  /** 回到初始資料（或換一份），並清掉注入的延遲與失敗。訂閱不受影響。 */
  reset(data?: ProjectData): void
}
