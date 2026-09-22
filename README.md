# PMIS

專案管理資訊系統（Project Management Information System）前端。目前只有一個頁面：Dashboard（`/`），內含四張摘要卡、專案時程（甘特圖）、任務看板與 Issue 看板。

技術棧與使用慣例見 [`docs/reference/tech-stack.md`](docs/reference/tech-stack.md)；設計語言區塊地圖見 [`docs/reference/design-map.md`](docs/reference/design-map.md)。

## 安裝

需要 Node.js 22 以上（版本記在 `.nvmrc`）。

```sh
npm install
npx playwright install chromium   # 只有要跑 e2e 時才需要
```

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 啟動開發伺服器（預設 <http://localhost:5174>，可用 `PLAYWRIGHT_PORT` 改） |
| `npm run build` | 型別檢查（`vue-tsc`）+ 打包（`vite build`），輸出到 `dist/` |
| `npm run preview` | 預覽打包結果 |
| `npm run lint` | ESLint 檢查並自動修正 |
| `npm run format` | Prettier 格式化 `src/` |
| `npm run type-check` | 只跑型別檢查 |
| `npm run test:unit` | Vitest（watch 模式；CI 用 `npm run test:unit -- --run`） |
| `npm run test:e2e` | Playwright E2E |

### 跑單一 e2e

```sh
npm run test:e2e -- e2e/smoke.spec.ts                 # 單一檔案
npm run test:e2e -- e2e/smoke.spec.ts -g '首頁可開'    # 單一測試（用標題關鍵字）
npm run test:e2e -- --headed --debug                  # 開瀏覽器逐步除錯
PLAYWRIGHT_PORT=5175 npm run test:e2e                 # 換 port（多個工作區同時跑時）
```

`playwright.config.ts` 會自己起一份 dev server（`reuseExistingServer: false`），所以不必事先 `npm run dev`；port 由 `PLAYWRIGHT_PORT` 決定，預設 5174。

全部 e2e 的時鐘固定在 `2026-09-18T10:00:00`（`e2e/helpers/clock.ts` 的 `setFixedTime(page)`），否則「已延遲」「今天」這類跟當下時間有關的斷言會隨日期改變。

目前共 50 條 e2e，分在 6 個檔：`smoke`(2) / `render`(3) / `interactions`(11) / `dragdrop`(9) / `detail`(7) / `compare`(18)。其中 `interactions.spec.ts` 有兩條靠 `window.__mockApi` 注入 api 失敗，接上真後端之後會自動跳過（見[怎麼接後端](#怎麼接後端)）。

## 目錄結構

```
legacy/            改寫前的原型（唯讀基準，見下）
public/            原樣複製到 dist/ 的靜態檔
src/
  api/             資料存取層；接後端時只換這一層
    types.ts       ProjectApi / ProjectEvent / ApiError 契約，檔頭是給後端看的 wire 約定
    mock/          記憶體實作（store.ts + index.ts）；可注入延遲與失敗
    index.ts       挑實作的唯一出口（VITE_API 未設或 'mock' 用 mock；dev build 掛 window.__mockApi）
  assets/          tokens.css（設計 token）、base.css（全域樣式與 keyframes）
  components/      元件，依畫面區塊分子目錄（common / layout / summary / gantt / kanban / issues / detail / dialogs）
  composables/     可重用的組合式函式
    useProjectBoot.ts    啟動層：注入 error sink、載入狀態、訂閱事件
    useDomRegistry.ts    DOM 登錄表（執行期不再用選擇器找元素）
    useTaskActions.ts    新增任務 / Issue 的預設值（派生層讀取集中在這）
    useEditDraft.ts      逐鍵編輯：本地即時 + api debounce
    useConfirmProps.ts   確認對話框的文案與 onConfirm（ConfirmDialog 純展示）
    （其餘：usePointerDrag / useGanttScroll / useAutoScroll / useClickOutside /
      useMenus / useFocusScroll / useNow / useStickyOffsets / useDelayedUnmount）
  constants/       畫面用常數（狀態 / 優先度 / 等級的標籤與顏色、API_ERROR_TEXT）
  lib/             純函式（日期、月曆格、排程連動、篩選、排序、格式化、id…）
  mocks/           範例資料
  router/          路由
  stores/          Pinia store（三層，見下）
    clock.ts               時鐘層
    task / issue / comment / member.ts   資料層
    _optimistic.ts         乐觀更新的共用機制（tracker / runOptimistic / error sink）
    _sync.ts               api.subscribe 的唯一訂閱點，把事件路由到各資料 store
    rows / filter / selection / ui.ts    派生層
  types/           資料模型型別
  views/           頁面
  __tests__/       跨目錄的結構守衛（readme / no-query-selector）
e2e/               Playwright 測試與 helper
docs/reference/    長期參考文件
```

單元測試放在被測檔案旁的 `__tests__/`（例如 `src/lib/__tests__/date.spec.ts`）。不屬於任何單一檔案的結構守衛放 `src/__tests__/`：`no-query-selector.spec.ts`（執行期不得用 DOM 選擇器）、`readme.spec.ts`（本檔的端點表與 `ProjectApi` 一致），另有 `src/stores/__tests__/imports.spec.ts`（store 分層白名單）。

## `legacy/` 是唯讀基準

`legacy/` 收的是改寫前的原型：

| 檔 | 作用 |
|---|---|
| `legacy/Dashboard.html` | 行為基準。原型的模板與 `DCLogic` 邏輯類別 |
| `legacy/support.js` | 原型的 runtime（dc-runtime），標明不可手改 |
| `legacy/design-system.html` | 設計基準。`<style id="tokens">` 是 `src/assets/tokens.css` 的來源 |
| `legacy/vendor/*.js` | React 18.3.1 / ReactDOM 18.3.1 / @babel/standalone 7.29.0 的 UMD 檔，讓原型離線也能開 |

**除了讓 vendor 生效所需的那一段 `window.__resources` 之外，`legacy/` 不再修改。** 新舊行為有差異時改的是 `src/`，不是 `legacy/`。

開發伺服器把它掛在 <http://localhost:5174/legacy/Dashboard.html>，可以和 `/` 並排比對。

## 與 legacy 對照

`e2e/compare.spec.ts` 是驗收用的對照測試：**同一組操作分別在 `/legacy/Dashboard.html` 與 `/` 跑一遍**，再比對兩邊的結果。涵蓋 8 項行為（選取連動、篩選、排序與分組、甘特拖曳與相依、重排與收合與新增、就地編輯、詳細視窗、刪除確認與相依編輯器），視窗 1440×900 與 1920×1080 各跑一輪。

```sh
PLAYWRIGHT_PORT=5174 npm run test:e2e -- e2e/compare.spec.ts        # 全部
npm run test:e2e -- e2e/compare.spec.ts --grep '1440.*行為 4'        # 單一情境
COMPARE_DUMP=node_modules/.tmp/cmp npm run test:e2e -- e2e/compare.spec.ts
```

`COMPARE_DUMP=<目錄>` 會把兩邊每一步的原始快照寫成 JSON，人工 diff 時很好用（測試本身的失敗訊息只會指出第一個不同的位置）。

比對的內容（`e2e/helpers/compare.ts`）：

| 類別 | 比什麼 |
|---|---|
| 文字 / 結構 | 摘要卡、三個面板標題列、甘特列與分類列順序與文字、甘特條、看板卡（依欄與序位）、Issue 卡、所有 `[data-dd]`、浮層、**整頁文字**、所有表單控制項的值；元素的 `opacity` 一併帶入（選取連動的淡化） |
| 幾何 | 甘特列、甘特條、看板卡、看板欄、Issue 卡、浮層、表單控制項的 boundingBox，加上甘特左欄寬、畫布尺寸與整頁高度；容許 ±1px |

選擇器只用 [DOM 鉤子](#dom-鉤子)表裡標「legacy 也有」的屬性與畫面上的文字。浮層（選單、對話框、詳細視窗）新舊沒有共同的選擇器，測試改用「computed style 的 `position` 是 `fixed`」這個兩頁都成立的特徵，臨時打上 `data-e2e-float` 再操作——標記只加在 DOM 上、兩頁一視同仁，不影響行為。

### 刻意保留的差異

這幾項新舊**本來就不該一樣**，對照測試已排除或反向斷言：

- **從詳細視窗刪任務**：legacy 的 `detail` 還指向已刪 id，視窗不會消失且 `body` 捲動被鎖死（`Dashboard.html:1761`）。新頁 `removeTask` 會清掉 `ui.detail`，走正常關閉動畫。對照測試反向斷言「legacy 有這個 bug、新頁沒有」。
- **檔案多選跨任務殘留**：legacy 的 `fileSel` 不會在換任務時清掉（`:3901`），計數會沿用上一個任務。新頁在 `openDetail` 時清空。
- **附件同日的相對順序**：`filesForTarget` 對同一天的附件沒有定義先後，兩邊可能不同，對照不比這個。
- **重排節流的時間來源**：legacy 用 `Date.now()`，被 e2e 的 `page.clock.setFixedTime` 凍住之後，一次拖曳裡除了第一次以外的 `dragTick` 全部被節流擋掉；新頁用 `performance.now()`，不受固定時鐘影響。這是測試環境造成的差異，不是行為差異——對照測試的重排只送一次 `mousemove`，比第一次落點。
- **文字之間的空白**：兩頁的文字節點切法不同（legacy 把每個 `{{ }}` 包成一層元素、元素之間留著模板縮排的空白節點），比對前會把文字裡的空白全部去掉。字級與間距的差異改由幾何量測把關。

## lib 與 store 的分工

| | `src/lib/*.ts` | `src/stores/*.ts` |
|---|---|---|
| 內容 | 純函式：輸入 → 輸出，不碰 Vue、不碰全域狀態 | 響應式狀態與改動它的 action |
| 例子 | `dayIndex()`、`cascade()`、`matchTask()`、`applySort()`、`monthGrid()`、`newId()` | `useTaskStore()`、`useFilterStore()`、`useUiStore()` |
| 測試 | Vitest，直接呼叫、不需要 Pinia | Vitest + `setActivePinia(createPinia())` |

規則：**演算法寫在 `lib/`，store 只負責存狀態並把 `lib/` 的結果接起來。** 只有單一元件用得到的狀態（下拉的 hover 列、卡片 hover）留在元件內。

### store 的三層

store 分三層，依賴**只能由上往下**：

| 層 | 檔 | 職責 | 可以 import 誰 |
|---|---|---|---|
| 時鐘層 | `clock.ts` | `now` / `todayIdx` / `todayIso`（60 秒 tick） | 誰都不用 |
| 資料層 | `task.ts`、`issue.ts`、`comment.ts`、`member.ts`（＋共用的 `_optimistic.ts`、`_sync.ts`） | 專案資料的唯一擁有者；所有寫入都經 `@/api` | `@/api/*`、`@/lib/*`、`@/types/*`、`@/stores/clock`、其他資料 store、`_optimistic` / `_sync` |
| 派生層 | `rows.ts`、`filter.ts`、`selection.ts`、`ui.ts` | 從資料層算出畫面要的東西（可見列、篩選、選取、浮層 / 錯誤條 / 收合） | 所有層 |

**資料層不知道派生層存在**，所以三件原本會反向依賴的事改成這樣：

- 新增的預設值（分類、負責人、起訖日）由 `composables/useTaskActions.ts` 的 `addTaskWithDefaults()` 算好再傳進 `taskStore.addTask()`；建立後的選取也在那裡做。
- 刪除後的懸空 id 由 `selection.ts` / `ui.ts` 各自的 `watch(..., { flush: 'sync' })` 清（`selection.taskId` / `issueId` / `groupId`、`ui.detail`（含 `detail.from`）、`confirm`、`depEditFor`、`pickerFor`、`expandedIssues[id]`）。
- api 失敗的錯誤條不是 import 來的，是**注入**的：`_optimistic.setErrorSink()`，實際接上 `ui.pushError` 的是 `useProjectBoot()`。

白名單由 `src/stores/__tests__/imports.spec.ts` 守著——它直接讀原始碼的 `import` 敘述，資料層引用白名單以外的 `@/` 路徑就紅（`import type` 豁免，因為型別在編譯後就消失；禁 barrel `@/stores`）。派生層之間不做環檢：Pinia 的 `useX()` 是延遲呼叫，`ui ↔ selection` 這種互相引用在執行期沒有問題。

### 誰可以寫哪些欄位

| | 誰可以寫 | 例子 |
|---|---|---|
| **UI 狀態欄位**：`ui` / `filter` / `comment` 裡描述畫面狀態的 `ref` | 元件可以直接寫 | `ui.editing = { kind: 't', id }`、`filter.issueMode = 'has'`、`comment.tab = 'files'` |
| **資料欄位**：`tasks` / `issues` / `deps` / `groups` / `comments` | 只經 action | `taskStore.updateTask()`、`issueStore.update()`、`commentStore.send()` |

分界在「有沒有連動」：資料欄位背後有 cascade 排程、api 呼叫與失敗還原、刪除時的懸空 id 清理，繞過 action 直接改陣列就會漏做這些；UI 狀態欄位沒有這層規則，走 action 只是多包一層。

## DOM 鉤子

畫面上這些屬性**只給測試與 CSS 用**，改元件時要一起維護。標「legacy 也有」的可以用在新舊對照測試裡。

執行期的元素定位不走這裡：需要量測或命中判定的元素由元件自己登錄進 `composables/useDomRegistry.ts` 的登錄表（`rows` / `groups` / `bars` / `linkDots` / `cards` / `cols` / `issueRows` / `panels`），`usePointerDrag`、面板捲動與捷徑都查那張表。`src/__tests__/no-query-selector.spec.ts` 守著這條：`src/**`（不含 `__tests__`）不得出現 `querySelector` / `querySelectorAll` / `getElementById` / `elementFromPoint`。

**唯一例外**：`composables/useClickOutside.ts`。它做的是「這一下點在哪」的 hit-test，對象是任意祖先而不是某個登錄過的元素，所以仍用 `Element.closest`——`KEEP_SELECTION`（`[data-card],[data-taskid],[data-rowtask],[data-rowgroup],[data-issuerow],[data-dd],[data-errorbar],input,textarea,select,label`，逐字取自 legacy）與 `KEEP_POPUP`（`[data-dd],[data-errorbar]`）。改動這些屬性名會弄壞「點外面清選取 / 關浮層」，不是只有測試變紅。它也是 `no-query-selector.spec.ts` 的白名單唯一一筆。

| 屬性 | 掛在 | 值 | legacy 也有 |
|---|---|---|---|
| `data-rowtask` | 甘特左欄任務列 | taskId | ✓ |
| `data-rowgroup` | 甘特左欄分類列 | groupId | ✓ |
| `data-taskid` | 甘特條（收合分類的摘要條為 `sum-<groupId>`） | taskId | ✓ |
| `data-linkfor` | 甘特條兩側的連線圓點 | taskId | ✓ |
| `data-card` | 看板任務卡 | taskId | ✓（legacy 值固定為 `1`，對照時只比存在性） |
| `data-issuerow` | Issue 卡 | issueId | ✓ |
| `data-col` | 看板欄內容區 | 狀態 key | ✓ |
| `data-dd` | 所有下拉的觸發器與面板 | `1` | ✓ |
| `data-zoom` | 甘特縮放滑桿 | `1` | ✓ |
| `data-errorbar` | 錯誤條容器（同一元素帶 `role="alert"`） | 空值 | ✗ |
| `data-selected` | 甘特任務列 / 任務卡 / Issue 卡 | `true` / `false` | ✗ |
| `data-rel` | 任務卡 | `up` / `down` / `group` / 空 | ✗ |
| `data-status` | 甘特條 / 任務卡 / Issue 卡 | 狀態 key，或 `delayed` | ✗ |
| `data-panel` | 面板外殼 | `gantt` / `kanban` / `issues` | ✗ |
| `data-testid` | 摘要卡 `summary-duration` / `summary-progress` / `summary-tasks` / `summary-issues`；頂部 `filter-clear` / `only-filtered`；面板標題 `task-count` / `issue-count` | 固定字串 | ✗ |

## 怎麼接後端

前端已經整成「換掉 `src/api/` 的實作就能接」：**所有資料進出都經過 `src/api/types.ts` 的 `ProjectApi` 介面**，store 與元件都不認識 `src/mocks/`。現在的實作是記憶體 mock（`src/api/mock/`），示範資料由 `createMockApi()` 自己帶（`src/mocks/sampleProject.ts`），進入點 `src/api/index.ts` 不碰它。

`src/api/types.ts` 檔頭的 wire 約定註解跟這一節是同一份內容；改契約要兩邊一起改（端點表的一致性由 `src/__tests__/readme.spec.ts` 守著）。

### 步驟

1. **寫實作**：新增 `src/api/http/index.ts`，`export function createHttpApi(): ProjectApi`，照下面的端點表實作 19 支方法。不要改介面去遷就後端——後端形狀不同就在這一層轉，介面本身是契約。
2. **切換**：`src/api/index.ts` 的 `createApi()` 依 `VITE_API` 挑實作（未設、空字串或 `'mock'` 用 mock，其他值丟錯）。加一支 `'http'` 分支即可，其餘檔案一行都不用改。`VITE_API` 的型別宣告在 `env.d.ts`。走非 mock 實作時 `export const mockApi` 是 `undefined`（型別就是 `MockApi | undefined`）。
3. **adapter 的職責**（後端形狀 → 前端模型，全部在這一層做完，`src/types/models.ts` 不因後端而變）：

   | 項目 | 前端 | 後端 / wire | 誰轉 |
   |---|---|---|---|
   | 空值 | `''`（`ISODate`、`done`、`Attachment.url`） | 多半是 `null` | adapter 雙向 `null ↔ ''`；`''` 是**有效值**（代表「沒有日期」），不是「這個欄位沒送」 |
   | `Task.start / end / done`、`Issue.due / done / created` | `'YYYY-MM-DD'` | 同上或 ISO 8601 日期 | adapter |
   | `Comment.at` | `'YYYY-MM-DDTHH:mm'`（**本地**時間、到分鐘） | ISO 8601 含 offset | adapter 兩邊轉，前端不做時區運算 |
   | `Attachment.at` | `'YYYY-MM-DD'`（本地日） | ISO 8601 | adapter |
   | `Group` | 只有 `id` / `name` | 後端若存了收合狀態要忽略 | 收合是畫面狀態，在 `ui.collapsedGroups`，不上 wire |
   | `ProjectData.currentUserId` | 必填字串 | 登入還沒做 | adapter 從 session / token 填；沒有登入就先填一個固定成員 id |
   | `Attachment.id` | `'<commentId>:<index>'`（`downloadAttachment` 的鍵） | 後端自己的附件主鍵 | adapter；只要 `loadProject` 與 `createComment` 回的 id 能餵回 `downloadAttachment` 就行 |

4. **跑測試**：`npm run test:unit -- --run` 全綠、`PLAYWRIGHT_PORT=5174 npm run test:e2e` 全綠（兩條靠 mock 的會自動跳過，見下）。

### 端點對照表

路徑是建議值；後端不同就在 adapter 對應，**介面的參數 / 回傳 / 錯誤碼才是契約**。單一專案、不分頁。

| 方法 | HTTP | 路徑 | request | response |
|---|---|---|---|---|
| `loadProject()` | GET | `/api/project` | — | `ProjectData`（整包；`tasks` / `groups` 的陣列順序就是顯示順序） |
| `createTask()` | POST | `/api/tasks` | `Task`（含 client 產的 `id`） | `Task` |
| `updateTask()` | PATCH | `/api/tasks/:id` | `Partial<Task>`（JSON merge patch） | `Task` |
| `updateTasks()` | PATCH | `/api/tasks` | `Task[]`（**語意是整批 PUT**：body 是整筆 `Task[]`，不是 patch；已含 cascade 後的下游） | `Task[]`（server 最終狀態，client 直接套回） |
| `deleteTask()` | DELETE | `/api/tasks/:id` | — | — |
| `reorderTasks()` | PUT | `/api/tasks/order` | `{ id, groupId }[]`（整份順序） | — |
| `createGroup()` | POST | `/api/groups` | `Group` | `Group` |
| `updateGroup()` | PATCH | `/api/groups/:id` | `Partial<Group>` | `Group` |
| `deleteGroup()` | DELETE | `/api/groups/:id` | — | — |
| `reorderGroups()` | PUT | `/api/groups/order` | `string[]`（分類 id 的完整順序） | — |
| `createDep()` | POST | `/api/deps` | `Dependency` | `Dependency` |
| `deleteDep()` | DELETE | `/api/deps/:id` | — | — |
| `createIssue()` | POST | `/api/issues` | `Issue` | `Issue` |
| `updateIssue()` | PATCH | `/api/issues/:id` | `Partial<Issue>` | `Issue` |
| `deleteIssue()` | DELETE | `/api/issues/:id` | — | — |
| `createComment()` | POST | `/api/comments` | multipart：comment 的 JSON part + `files[]` | `Comment`（`files[].url` 換成 server url） |
| `deleteComment()` | DELETE | `/api/comments/:id` | — | — |
| `downloadAttachment()` | GET | `/api/attachments/:id` | — | `Blob`（檔案本身） |
| `subscribe()` | — | `/api/events`（SSE）或 WS 或 polling | — | `ProjectEvent` 串流；回傳解訂函式 |

後端要注意的四件事：

- **id 由 client 產**（UUID v4，`src/lib/id.ts` 的 `newId()`：`crypto.randomUUID?.()`，非 https / 非 localhost 沒有這支時退回 `crypto.getRandomValues` 自己組）。主鍵接受 client 給的 id，重複回 **409**。
- **後端不跑 cascade**。相依連動（`start` / `end` 改動推下游、`status=done` 填 `done` 日）前端已經算完，`updateTasks` 送的是整段結果。後端只存，response 回最終狀態（要糾正就在 response 糾正，client 會套回）。
- **連動刪除由後端做**：`deleteTask` 連帶刪它的 issue / dep / comment，`deleteGroup` 連帶刪底下的任務（以及那些任務的 issue / dep / comment），`deleteIssue` 連帶刪它的留言。事件順序見下。
- **事件與 response 的到達順序後端不必保證**。client 兩種順序都正確（機制見〈乐觀更新怎麼運作〉的 in-flight 規則）：事件先到就只更新「最後已知的 server 狀態」，等該 id 的請求全部結束才對齊本地。不要為了排順序而延後廣播或延後回應。

### 錯誤碼對照表

api 層只往外拋 `ApiError`（`code` / `message` / `status` / `method`）。`code` 決定畫面文案，`message`（server 原文）只進 console，不上畫面。

| `ApiError.code` | HTTP status | 錯誤條文案 |
|---|---|---|
| `network` | fetch 直接拋錯 / 沒有回應 | 連線失敗 |
| `validation` | 400、422 | 資料不合法 |
| `not_found` | 404 | 資料已不存在 |
| `conflict` | 409 | 與伺服器狀態衝突 |
| `unknown` | 其他 | 發生錯誤 |

對照表在 `src/constants/dashboard.ts`（`API_ERROR_TEXT` / `apiErrorCode()`）。錯誤條 `ErrorBar` 顯示的是「操作名稱（`label`，例如『更新任務』）＋ 上表文案」，同 label 會合併成 `×N`，最多留 5 筆、畫面顯示 3 筆，不自動關閉。

「同 label 合併」的視窗是 **`clock` 的 60 秒 tick**，不是牆鐘 5 秒：`ui.pushError` 的時間戳取 `clock.now`（每 60 秒才走一次），所以實際行為是「同一個 tick 內的同 label 合併成一筆」。刻意如此——連續失敗不該把錯誤條洗版。

### 事件

`subscribe(handler)` 是後端推變更的唯一入口，前端只有 `src/stores/_sync.ts` 的 `useProjectSync()` 訂閱它（`DashboardView` 掛載時 `start()`、卸載時 `stop()`），再依 `type` 前綴路由到各資料 store 的 `applyEvent`。

三種實作都可以，介面不變：

| 做法 | 怎麼接 | 取捨 |
|---|---|---|
| polling | `setInterval` 打 `loadProject()`，跟上一份 diff 出事件；或後端給 `/api/events?since=<cursor>` | 最好做、後端零長連線；延遲等於輪詢間隔，流量大 |
| SSE | `new EventSource('/api/events')`，每則 `data` 是一個 `ProjectEvent`；`onerror` 時瀏覽器自動重連 | 單向推送、走一般 HTTP，最貼合這個介面 |
| WebSocket | `new WebSocket(...)`，訊息就是 `ProjectEvent` 的 JSON | 雙向、延遲最低；要自己做心跳與重連 |

不論哪一種，client 端的規則是固定的：

- **廣播含發起者**：自己改的東西也會收到自己的事件。不要為了省流量排除發起者——前端靠這則事件確認 server 的最終值。
- **同值 no-op**：同一個 id 收到跟本地一樣的值，不重繪也不算變更。
- **in-flight 期間只寫 `serverState`**：某個 id 還有請求在飛時，事件只更新「最後已知的 server 狀態」，不動本地；等該 id 的請求全部結束才對齊（硬規則見端點表下方第四點）。
- **順序不保證**，但連動刪除例外：被連帶刪掉的實體要**先**各發一則 `deleted`，主體自己的 `deleted` **最後**發（前端依這個順序清懸空 id）。
- **事件的 payload 也要走 adapter 轉換**：`ProjectEvent.payload` 就是 `Task` / `Issue` / `Comment` / `ProjectData` 本身，所以上表那份對照（`null ↔ ''`、日期格式、`Attachment.id`）在事件這條路徑上要**再做一次**。只轉 response 不轉事件，本地會被推來的 `null` 汙染成非法值。
- **`project.reloaded` 由 adapter 自己造，後端不用做**：重連偵測在前端這一層（`EventSource` 的 `onopen` 從**第二次**起、或 WebSocket 的 reconnect callback），adapter 自己 `await loadProject()` 之後 `emit({ type: 'project.reloaded', payload })`。後端只要能重新建立連線就好，不必記得補推什麼。
- **`reorderTasks` / `reorderGroups` 沒有對應事件**。純順序變更要讓別的 client 看到，靠的是重連時 adapter 補的 `project.reloaded`；只有搬動造成 `groupId` 改變時才會有一則 `task.updated`。

### 乐觀更新怎麼運作

所有寫入都是先改本地、再打 api，失敗才還原。機制在 `src/stores/_optimistic.ts`：

- 每個 tracker 有三張表：`server`（id → **最後已知的 server 狀態**，Map 的插入順序就是 server 的顯示順序）、`inflight`（id → 還有幾個請求在飛）、`dirty`（id → 本地改了但**還沒送出**）。
- `runOptimistic({ tracker, ids, label, call, reconcile })`：本地由呼叫端先改好 → `inflight++` → `call()` 打 api。response 帶回的實體寫進 `server`；reject 送錯誤。**該 id 的 `inflight` 歸零、而且不在 `dirty` 裡時才 `reconcile`**——成功是套上 server 最終狀態，失敗是放回 server 狀態（不是「送出前的本地快照」，多筆交錯時後者會還原成中途的值）。`runOptimistic` **永不 throw**，store action 不必 try/catch。
- **`dirty` 擋的是「還沒送出」的那一段**：拖曳的每個 tick、逐鍵改名的 debounce 期間根本還沒有請求在飛，`inflight` 保護不到。標成 dirty 的 id 收到別筆的 response 或別人推來的事件時只更新 `server`，不動本地；對應的 commit 一送出就清掉。
- **刪除失敗的還原也走 `server`**：`removeTask / removeGroup / removeDep / removeIssue / comment.remove` 失敗時逐 id `reconcile(tracker.server.get(id), id)`。`server` 裡已經沒有的（`deleted` 事件先到了）就不復活。
- **拖曳放開才送**：`usePointerDrag` 每個 tick 只改本地（`applyLocalPatch` / `moveTaskToLocal` / `moveGroupLocal`），`pointerup` 才送一次 `commitTasks(collectDirtyTasks())` / `commitTaskOrder()` / `commitGroupOrder()`；取消走 `discardTaskDrag(ids)` / `discardGroupDrag()`——只放棄這一段拖曳自己標的 dirty，別處還在 debounce 的改名留著。
- **改名 debounce**：`composables/useEditDraft.ts`——每一鍵都本地立即生效（維持 legacy 行為），api 走 trailing debounce 300ms，離開編輯（Enter / Esc / blur / 卸載）時 flush。
- **錯誤出口 = 注入的 sink**：資料層不 import ui，失敗透過 `_optimistic.setErrorSink()` 送出去。
- **啟動點 = `composables/useProjectBoot.ts`**：它把 `ui.pushError` 註冊成 sink、維護 `ui.loadState` / `ui.loadError`（載入中 / 失敗重試畫面）、確保派生層的清理 `watch` 在資料進來前掛好，並代理事件訂閱的 `start` / `stop`。`DashboardView` 是唯一呼叫端。

### e2e 與 mock 把手

dev build 會把 mock 掛在 `window.__mockApi`（`src/api/index.ts` 的 `if (import.meta.env.DEV)`），e2e 用它注入延遲與失敗（`failNext` / `setLatency` / `reset` / `emit`）。

接上真後端之後 `window.__mockApi` 會是 `undefined`，`e2e/interactions.spec.ts` 裡**那兩條**（api 失敗後還原並顯示錯誤條、載入失敗後重試）開頭就是 `test.skip(!__mockApi)`，會自動跳過，其餘 48 條照跑。要在真後端上也測失敗路徑，就換成在 `page.route()` 攔 HTTP 回錯誤碼。

### 還沒做的（接後端時要補）

- **逾時與取消**：`ProjectApi` 目前沒有 `AbortSignal`，也沒有逾時。網路實作至少要給每個請求一個逾時（逾時 → `ApiError('network')`）；離開頁面或連續改動時要能取消前一發。
- **authn / authz**：`ProjectApi` 完全沒有身分概念，**每一支端點都要後端自己做認證與授權**。`ProjectData.currentUserId` 只是「留言掛誰、頭像顯示誰」的顯示用欄位，是 client 送什麼就是什麼，**絕對不能拿它當身分**。
- **PATCH body 要用 schema 白名單驗欄位**：`updateTask` / `updateGroup` / `updateIssue` 送的是 JSON merge patch，後端必須逐欄位比對允許清單再寫入，**不可以整包 merge 進實體**（mass-assignment；也要擋 `__proto__` / `constructor` / `prototype` 這類鍵造成的原型污染）。同理 `createTask` 這些帶完整實體的端點也要過一次 schema。
- **多人衝突**：現在是「後到的覆蓋先到的」，沒有版本號或 `If-Match`。同時編輯同一筆的情境沒有處理（spec 已排除）。附帶一提：`dirty`（本地改了還沒送出）只保護**本地**不被 reconcile 蓋掉，**不保護 server 端**——那段值還沒上 wire，別的 client 這段時間寫進去的東西，等它送出時一樣會被覆蓋。
- **附件上傳驗證**：`comment.addDraftFiles` 直接 `URL.createObjectURL`，沒有任何檢查。要補檔案大小上限、MIME 型別與副檔名白名單（三者都要，只擋副檔名擋不住偽裝的檔案），**伺服器端再驗一次**。
- **CSP**：目前沒有 Content-Security-Policy；上線前在伺服器或 CDN 層補上，至少限制 `script-src` / `style-src` / `img-src`（`blob:` 要放行，附件預覽用得到）。
