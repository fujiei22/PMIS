# PMIS 前端

專案管理資訊系統（Project Management Information System）前端。有兩個頁面：

- **所有專案總覽**（`/`）
  - 專案有兩種檢視：依 PM 分欄的卡片，以及時間軸。
  - 頂欄可以依成員、狀態、需注意篩選，面板標題列可以多鍵排序。
  - 讓 PM 主管一眼看出哪些專案需要注意。
- **單一專案 Dashboard**（`/projects/:id`）：四張摘要卡、專案時程（甘特圖）、任務看板、Issue 看板與詳細視窗。

技術棧與使用慣例見 [`docs/reference/tech-stack.md`](../docs/reference/tech-stack.md)；設計語言區塊地圖見 [`docs/reference/design-map.md`](../docs/reference/design-map.md)。

## 開工前先讀

### 現況

- 由 `legacy/Dashboard.html` 的 React 原型改寫而成，行為已用 `e2e/compare.spec.ts` 逐項和原型對照過；新舊有差異時改 `src/`，不改 `legacy/`。
- 資料全在記憶體 mock（`src/api/mock/`），重新整理就回到範例資料。後端待建，前端已整成「換掉 `src/api/` 的實作就能接」。
- 沒有登入。`currentUserId` 是範例資料裡固定的成員，只決定留言掛誰。總覽頂欄右端顯示的登入者也是它。
- `/projects/:id` 的 `id` 暫時不影響載入。mock 只有一份完整專案資料（`mocks/sampleProject.ts`），任何 id 都顯示這一份，要等後端才會依 id 載入。
- 總覽裡 PMIS 的摘要，是由那份範例專案即時彙整出來的（`api/mock/portfolio.ts` 的 `summarizeProject()`），所以在 Dashboard 改了任務，回到總覽看得到。
  - 其他 6 個專案是靜態摘要（`mocks/samplePortfolio.ts`）。
  - 在這 6 個專案按「進入」，看到的仍是 PMIS 那份資料。這是預期行為，不是 bug。
- 已知未做：請求逾時與取消、多人同時編輯的衝突、附件驗證、CSP。細節在最後一節〈還沒做的〉。

### 資料流

```
寫入  元件 ──▶ 資料層 store 的 action（task / issue / comment / member）
              先改本地 ──▶ runOptimistic ──▶ api.xxx()（src/api/index.ts 依 VITE_API 挑實作）
              失敗：放回最後已知的 server 狀態，錯誤條經注入的 sink 顯示
讀取  元件 ◀── 派生層 store（rows / filter / selection / ui）◀── 資料層
事件  api.subscribe ──▶ stores/_sync.ts ──▶ 各資料層 store 的 applyEvent
啟動  router.beforeEach ──▶ preloadProject() / preloadPortfolio()：切頁一開始就先載目標頁（不阻塞導航）
      DashboardView ──▶ useProjectBoot()：注入 sink、沿用先載的那一發（loadProject()）、訂閱事件
      ProjectsOverviewView ──▶ usePortfolioBoot()：沿用先載的那一發 ──▶ api.listProjects()
      兩頁都是第一次顯示載入中、之後背景重載（畫面維持 ready，失敗只記 console）
```

演算法（日期、cascade、篩選、排序）是 `src/lib/` 的純函式，store 只存狀態並把它們接起來。

### 畫面對元件

`views/DashboardView.vue` 掛的東西，都在 `src/components/`：

| 畫面區塊 | 元件 |
|---|---|
| 頂部篩選列與錯誤條 | `layout/TopBar`（FilterDropdown、FilterCalendar、MemberPicker、common/ErrorBar） |
| 四張摘要卡 | `summary/SummaryCards` |
| 甘特圖 | `gantt/GanttPanel`（GanttTimeline、GanttGroupRow、GanttTaskRow、GanttBars → GanttBar、DependencyLines）；任務列「⋮」的動作選單 `gantt/RowActionMenu` |
| 任務看板 | `kanban/KanbanPanel`（KanbanHeader、TaskCard） |
| Issue 看板 | `issues/IssuePanel`（IssuePanelHeader、IssueCard） |
| 詳細視窗 | `detail/DetailModal`（DetailHeader、TaskProperties、IssueProperties、CommentsTab、FilesTab、ActivityToolbar）、`detail/ImageLightbox` |
| 浮層 | `common/OptionMenu`、`common/DatePicker`、`common/ConfirmDialog`、`dialogs/DependencyEditor`、`gantt/RowActionMenu` |
| 三個面板共用 | `common/PanelShell`、`common/SortChips`、`common/SortMenu` |

`views/ProjectsOverviewView.vue`（總覽）掛的東西，都在 `src/components/overview/`：

| 畫面區塊 | 元件 |
|---|---|
| 頂欄：檢視切換、篩選、登入者 | `OverviewTopBar`（PmFilter、OvDropdown） |
| 卡片檢視 | `CardBoard`（PmLane → ProjectCard、LaneDrawer → QuickView、EnterLink；泳道標頭與時間軸群組共用 PmCountPill） |
| 時間軸檢視 | `OverviewTimeline`（TimelineGroup → TimelineProjectRow → QuickView） |
| 兩種檢視共用 | `OvPanel`（面板外殼與計數）、`OvSortControls`（排序 chip 與選單）、`ProjectBadge`（狀態 pill）、`OvEmpty`（空狀態） |

總覽和 Dashboard 各有一套外觀相近的元件，這是**刻意分開的**。改其中一個的外觀或行為時，另一個要一起看：

| 總覽 | Dashboard |
|---|---|
| `OvDropdown` | `FilterDropdown` |
| `OvSortControls` | `SortChips` ＋ `SortMenu` |
| `OvPanel` | `PanelShell` |

分開的原因是狀態來源和尺寸不同：Dashboard 版綁著 Dashboard 的 `ui` / `filter` store；總覽版讀 `overview` store，尺寸照總覽的設計稿。
### 改動時要碰的檔

| 要做的事 | 依序碰 |
|---|---|
| 加或改資料欄位 | `types/models.ts` → `api/types.ts`（檔頭 wire 約定）→ `api/mock/store.ts` → 對應資料層 store 的 action → 元件 → 各自旁邊的 `__tests__/` → 本檔〈端點對照表〉 |
| 加一支 api 方法 | `api/types.ts` 的 `ProjectApi` → `api/mock/index.ts` → store action → 本檔〈端點對照表〉（`readme.spec.ts` 會比對兩邊） |
| 加畫面狀態（開關、選取、篩選） | 派生層 store 加欄位，元件直接寫：Dashboard 是 `ui` / `filter` / `selection`，總覽是 `overview` |
| 改純邏輯 | `lib/` 加純函式 + 單元測試，再由 store 或元件呼叫 |
| 加設計值（顏色、間距） | 先加 `assets/tokens.css` 的變數，再在 `<style scoped>` 引用；不直接寫色碼 |
| 改使用者操作流程 | 對應的 `e2e/*.spec.ts`；選擇器只用〈DOM 鉤子〉表裡的屬性 |
| 改總覽的畫面狀態（篩選、排序、展開、檢視） | `stores/overview.ts`；純邏輯（派生值、篩選、排序、分組）在 `lib/portfolio.ts` |
| 改總覽的範例專案 | `mocks/samplePortfolio.ts` ＋ `mocks/__tests__/portfolio.spec.ts`（數字要對得上設計稿）；PMIS 摘要改 `api/mock/portfolio.ts` |
| 加總覽的互動或 UI 變化 | 元件 ＋ `assets/overview-motion.css`（過渡 class 唯一定義處）＋ `e2e/overview-motion.spec.ts`（在 spec〈動畫清單〉加一項，就在這裡補一條守衛） |
| 加 Dashboard 的浮層（選單、日期選擇器、對話框） | 元件包 `<Transition name="pop \| dialog \| fade">`（根元素與對話框本體不寫 transition / animation / opacity / transform）；fixed 浮層接 `useCloseOnScroll`、開啟函式放 `useMenus`（記觸發元素）；鎖頁面捲動用 `useScrollLock`；`e2e/popover-motion.spec.ts` / `dialog-motion.spec.ts` 加一條離場守衛。頂欄的篩選下拉 / 成員面板 / 日期日曆、看板與 Issue 的排序選單、Issue 分欄下拉也是 `pop`（absolute 掛在觸發鈕或容器下，不是 fixed）：頂欄一行時傳 `align="end"`（右緣對齊，觸發鈕往左變寬時選單不動）、兩列時 `start`；排序選單以 `.sorts` / `.tools` 為定位基準、打開當下量好位置（`--menu-x` / `--menu-y`），開著期間不跟著觸發鈕；點了不該關掉浮層的觸發元件（例：日期膠囊）標 `data-keep-popup`。守衛在 `e2e/dash-menu-motion.spec.ts` |
| 改 Dashboard 頂欄篩選項或排序 chip 的版面 | 頂欄一行時篩選條件變動會把篩選項 FLIP 到新位置（`TopBar` 的 pre / post watcher，比右緣；一行 / 兩列切換與縮放不做；`measureFit` 扣掉補間中的位移再量）；日期膠囊與「～」用 `fade` 淡入淡出，離場中的由 `freezeLeave` 釘成 absolute（不佔版面、不算進 `measureFit` 與位移補間，一行 / 兩列切換時直接藏起來）；排序 chip 是 `TransitionGroup` ＋ `.sort-chip-slot > .sort-chip-clip` 原地橫向展開 / 收起，父層要提供 `--sorts-gap`；離場中的 chip 還在 DOM，測試讀 chip 要用會重試的寫法（`expect.poll`） |
| 改切頁過渡或頁面的載入流程 | 切頁淡入淡出是 `assets/base.css` 的 `page-view-*`（transition，淡入途中切走會從當下的透明度往回淡出；頁面根元素 `.dash` / `.ov` 不寫 opacity / transition / animation，會蓋掉它）；`router/pageSwap.ts` 等新頁插入（`@enter`）才還原捲動，新頁插入當下要已經是最終高度。載入：`router/index.ts` 的 `beforeEach` 在 path 變或初始導航時呼叫 `preloadProject` / `preloadPortfolio`，頁面掛載時 boot 的 `reload()` 取走沿用——**同一次進頁只打一次 load**（`failNext` 類測試只擋一發，靠這個維持語意）；已經 ready 時背景重載、失敗不蓋掉內容。守衛 `e2e/page-motion.spec.ts`、`e2e/load-motion.spec.ts` |
| 改錯誤條的內容或版面 | `common/ErrorBar.vue`：在 TopBar 第二列、文件流裡（不是浮層，契約 C），兩層 `.error-slot`（`overflow: clip`，`v-if` 拿掉的是這層）/ `.error-bar`（`role="alert"`、`data-errorbar`）；進場、離場、筆數變了而換行三種高度變化都用 Web Animations 在 `.error-slot` 補間 `height` ＋透明度（`<Transition :css="false">` 的 `onEnter` / `onLeave` 與內容 watcher 共用 `tween()`，時長 `--t-panel`、曲線 `--ease`），每次從畫面上看得到的高度與透明度起步，中途接手（進場途中換行、少一行途中關掉最後一筆）不跳；不用 grid `0fr ↔ 1fr`（裡層被補間寫上 px 高度時會撐住外層的 `0fr`）；每次從沒有錯誤變成有錯誤換一個 key（收起途中又來一筆時舊的照收完）。下面的內容與 sticky 面板頭因此逐幀被推開 / 收回；捲到中段時 Chrome 的 scroll anchoring 會補償，內容不動、頂欄往下蓋。守衛 `e2e/errorbar-motion.spec.ts` |
| 改 Dashboard 或總覽在平板上的版面或手指操作 | 見下方〈平板與觸控〉；`e2e/tablet.spec.ts`（Dashboard）、`e2e/overview-tablet.spec.ts`（總覽），都是 768×1024 觸控；Dashboard 1200px 以上的版面要跟 legacy 對得上（`compare.spec.ts` 在 1440 / 1920 對照 legacy 幾何；頂欄例外，見〈刻意保留的差異〉） |
| 改 Dashboard 頂欄的篩選器（加減項目、改文字） | `layout/TopBar.vue`：一行放不下時整排移到第二列，由 `measureFit` 量實際寬度切 `.stacked`（不靠斷點，不用另調寬度）；兩列時日期日曆以日期那一組（`.date-group`）為基準、左緣對齊（`FilterCalendar` 的 `align`），這一組比日曆窄時往左挪到不超出視窗（可超出的量 `--cal-overhang` 取自列的左右留白 `--top-row-pad-x`，改留白只改這個變數）；`e2e/topbar-layout.spec.ts` 守版型與日曆位置，加了篩選項讓 1536 也放不下時要改它的寬度 |

### 平板與觸控

Dashboard 與總覽的平板規則集中在這幾種條件，元件各自在 `<style scoped>` 裡寫：

| 條件 | 寫在哪 | 做什麼 |
|---|---|---|
| `@media (max-width: 1199px)` | `TopBar` | 只收小頂欄間距。版型由 `.stacked` 處理（平板一定放不下一行，桌機 1200～1470px 也會）：篩選器換到第二列、每組「標籤 + 下拉」整組換行（`.fgroup` 單行時是 `display: contents`），日期日曆貼著日期那一組、左緣對齊「日期」 |
| `@media (max-width: 899px)`（JS 端 `NARROW_QUERY`） | `SummaryCards`、`KanbanPanel`、`IssuePanel`、`GanttPanel`、`GanttTaskRow` | 摘要卡與兩個看板改 2 欄；甘特左欄 250px，日期膠囊只寫工期（點了照樣開日期選擇器）；欄頭右端多一顆展開鈕（» / «，`ui.ganttLeftExpanded`），展開後左欄回到完整寬度。列的寫法另由 `ui.ganttLeftDates` 控制：展開時等寬度過渡跑完才換成起訖日，收合時先換回工期再縮 |
| 同上 | `OvPanel`、`OvSortControls`、`OverviewTimeline`、`TimelineProjectRow` | 總覽面板標題列維持一行：計數短寫（「7 專案 · 3 需注意 · 4 PM」）、排序 chips 不換行，放不下時原地左右滑；時間軸左欄 260px（`TIMELINE_LEFT_W_NARROW`），進度欄只留實際 % |
| `@container board (max-width: 841px)`（容器是 `CardBoard` 的 `.board`） | `PmLane` | 左側標頭放不下兩欄卡片時（約視窗 900px 以下），PM 標頭改放在卡片上方成一列（照樣黏在面板標題列下方），卡片排兩欄，速覽抽屜橫跨整列 |
| `@media (pointer: coarse)`（JS 端 `TOUCH_UI_QUERY` 另加 `hover: none`） | 各個小按鈕所在的元件（含總覽排序 chip 的 ✕）、`base.css` 的縮放滑桿 | 加大可點範圍：能外擴的用看不見的 `::after` 熱區（外觀不變），在 `overflow: hidden` 裡的直接加大本體 |
| `@media (hover: hover)` | 總覽各元件的 `:hover` 規則 | hover 樣式只給有滑鼠的裝置：觸控點一下後 `:hover` 會一直黏著，收合的卡片還是浮起、時間軸列還在發光，看起來像沒收合 |

手指操作的約定：

- 會開始拖曳的元素（選取中的甘特條、左右把手、相依圓點、排序把手 ⠿）要宣告 `touch-action: none`，否則手指一動瀏覽器就當成捲動、送 `pointercancel`，拖曳被中止。沒選取的條不宣告，手指照常能在上面滑動捲動。
- 觸控裝置沒有 hover：原本 hover 才出現的相依圓點改成「選取中」就出現。
- 甘特任務列的動作（工期 −1天 / +1天、相依設定、刪除任務）一律收在列尾一直顯示的「⋮」開的選單（`RowActionMenu`，位置 `anchorRowMenu`）；點任務只標記，hover 與選取都不會撐開東西（桌機與平板同一套）。開選單不選取任務（不捲動時間軸、不淡化其他列）；遮罩與選單帶 `data-keep-selection`，點外面只關選單、不清標記。
- 空白處的平移交給瀏覽器原生捲動（`usePointerDrag` 的 pan 在觸控時 `native: true`，不改 `scrollLeft`）。
- 「點到外面清選取」（`useClickOutside`）在觸控時延到 `click`：`pointerdown` 時分不出點一下還是開始捲動，捲動不會有 `click`。
- 看板卡片拖到甘特列（HTML5 原生拖放）在觸控裝置的支援度不一，刻意沒有處理。
- 總覽的排序選單往右開會超出視窗時（直向時排序鈕在標題列右半），改成對齊按鈕右緣往左開（`OvSortControls` 的 `alignEnd`）。
- 時間軸 bar 的名稱是 sticky：bar 起點捲到左欄底下時，名稱停在左欄右緣。`.bar` 因此用 `overflow: clip`，用 `hidden` 的話 bar 自己會變成捲動容器，sticky 跟不上橫捲。

`e2e/tablet.spec.ts` 除了〈DOM 鉤子〉的屬性，還依賴這些 class，**改名時要同步改測試**：`.top-bar` `.col` `.foot` `.caret` `.detail-layer` `.detail-close` `.draft-input` `.name` `.date` `.date-range` `.date-days` `.rm-days` `.gantt-left` `.gantt-scroller`。`e2e/topbar-layout.spec.ts` 依賴 `.top-row` `.stacked` `.filters` `.fgroup` `.section` `.date-pill` `.cal` `.clear` `.project` `.burger`；`e2e/helpers/compare.ts` 依賴 `.top-bar`（量頂欄高度）。`e2e/dash-menu-motion.spec.ts` 依賴 `.top-row` `.stacked` `.filters` `.fgroup` `.date-pill` `.cal` `.cal-end` `.dd-trigger` `.dd-menu` `.dd-item` `.mp-trigger` `.mp-panel` `.mp-row` `.panel-head` `.sort-trigger` `.sort-menu` `.sort-option` `.sort-chip` `.chip-x`。`e2e/overview-tablet.spec.ts` 用到的 class 列在〈DOM 鉤子〉最後的總覽 class 表。

### 守衛測試

這些測試讀的是原始碼或文件本身，違反規則就紅：

| 測試 | 守什麼 |
|---|---|
| `src/stores/__tests__/imports.spec.ts` | store 三層的 import 白名單，資料層不得引用派生層 |
| `src/__tests__/no-query-selector.spec.ts` | `src/**` 執行期不得用 `querySelector` 等 DOM 選擇器（唯一例外 `useClickOutside`） |
| `src/__tests__/readme.spec.ts` | 本檔〈端點對照表〉〈錯誤碼對照表〉與 `api/types.ts` 一致；〈目錄結構〉的 composables 清單提到 `src/composables/` 底下每一支（新增 composable 要一起補說明） |
| `src/mocks/__tests__/consistency.spec.ts` | 範例資料必須已是 cascade 之後的樣子 |
| `src/assets/__tests__/tokens.spec.ts` | `tokens.css` 必須含有程式用到的每個變數與約定值，改名或刪 token 會紅 |
| `src/mocks/__tests__/portfolio.spec.ts` | 總覽靜態專案算出的實際 / 理論 % 與需注意等於設計稿；m1–m7 與 `sampleProject` 的成員是同一份 |
| `e2e/overview-motion.spec.ts` | spec〈動畫清單〉每一項至少有一條守衛：宣告了 transition / animation，或過渡 class 真的出現（A19 hover / focus 另以瀏覽器逐一量測稽核）。重排時逐幀量位置，沒有動畫（直接跳到新位置）或位移算了兩次（先跳過頭再回彈），都會紅 |

### 閱讀指引

| 要做的事 | 讀哪幾節 |
|---|---|
| 任何前端改動 | 本節、〈目錄結構〉、〈lib 與 store 的分工〉 |
| 改元件或 e2e | 加〈DOM 鉤子〉 |
| 動到與原型有關的行為 | 加〈`legacy/` 是唯讀基準〉〈與 legacy 對照〉 |
| 改總覽頁 | 〈畫面對元件〉的總覽表、〈DOM 鉤子〉的兩張總覽表 |
| 接後端、改 api 契約 | 〈怎麼接後端〉整節；前端日常開發不必讀 |

## 安裝與指令

環境安裝、常用指令與提交前檢查在[根目錄 README](../README.md)，指令都在這個 `frontend/` 目錄下執行。本檔只補 e2e 的細節：

- `playwright.config.ts` 會自己起一份 dev server（`reuseExistingServer: false`），不必事先 `npm run dev`；port 由 `PLAYWRIGHT_PORT` 決定，預設 5174。
- 全部 e2e 的時鐘固定在 `2026-09-18T10:00:00`（`e2e/helpers/clock.ts` 的 `setFixedTime(page)`），否則「已延遲」「今天」這類跟當下時間有關的斷言會隨日期改變。
- 靠 `window.__mockApi` 的 e2e，接上真後端之後會自動跳過（見[怎麼接後端](#怎麼接後端)）。共有四條：
  - `e2e/interactions.spec.ts`：兩條注入 api 失敗的測試。
  - `e2e/overview.spec.ts`：「載入失敗」與「Dashboard 改了資料回總覽看得到」。
- Dashboard 的 e2e 一律開 `/projects/pmis`（`e2e/helpers/dashboardPage.ts`）；總覽開 `/`（`e2e/helpers/overviewPage.ts`）。
- 總覽網址帶 `#timeline` 會直接開時間軸檢視。這是**單向**的慣例：只在進頁時讀一次，切換檢視不會寫回網址，是給 e2e 與截圖用的。
- 時間軸每次重建（進頁、面板收合再展開、空狀態切回來）都會橫向捲回今天，不保留上一次的橫向捲動位置，這是刻意的。

## 目錄結構

```
frontend/
├── legacy/                改寫前的原型（唯讀基準，見下）
├── public/                原樣複製到 dist/ 的靜態檔
├── src/
│   ├── api/               資料存取層；接後端時只換這一層
│   │   ├── types.ts       ProjectApi / ProjectEvent / ApiError 契約，檔頭是給後端看的 wire 約定
│   │   ├── mock/          記憶體實作（store.ts + index.ts）；可注入延遲與失敗；portfolio.ts 是總覽摘要的彙整
│   │   └── index.ts       挑實作的唯一出口（VITE_API 未設或 'mock' 用 mock；dev build 掛 window.__mockApi）
│   ├── assets/            tokens.css（設計 token）、base.css（全域樣式、keyframes、Dashboard 浮層共用的 pop / dialog / fade 過渡）、overview-motion.css（總覽的過渡 class）
│   ├── components/        元件，依畫面區塊分子目錄（common / layout / summary / gantt / kanban / issues / detail / dialogs / overview）
│   ├── composables/       可重用的組合式函式
│   │   ├── useProjectBoot.ts    啟動層：注入 error sink、載入狀態（第一次載入中、之後背景重載）、訂閱事件；preloadProject 給 router 切頁先載
│   │   ├── usePortfolioBoot.ts  總覽的啟動層：第一次顯示載入中，之後背景重載不閃；preloadPortfolio 給 router 切頁先載
│   │   ├── useDomRegistry.ts    DOM 登錄表（執行期不再用選擇器找元素）
│   │   ├── useTaskActions.ts    新增任務 / Issue 的預設值（派生層讀取集中在這）
│   │   ├── useEditDraft.ts      逐鍵編輯：本地即時 + api debounce
│   │   ├── useConfirmProps.ts   確認對話框的文案與 onConfirm（ConfirmDialog 純展示）
│   │   └── …                    usePointerDrag / useGanttScroll / useAutoScroll / useClickOutside /
│   │                            useMenus / useFocusScroll / useNow / useStickyOffsets / useDelayedUnmount /
│   │                            useDismiss（總覽浮層的點外面與 Esc）/ freezeLeave（TransitionGroup 離場釘在原位）/
│   │                            useRelativeFlip（巢狀清單的重排動畫，以容器為基準量位移）/
│   │                            useRowMotion（甘特列上下位移補間：左欄列、橫紋、條、圓點同一個時鐘）/
│   │                            useMediaQuery（全站共用的 media query ref；TOUCH_UI_QUERY 觸控裝置、NARROW_QUERY 平板直向）/
│   │                            useGridColumns（量 grid 實際排幾欄，總覽泳道的列下展開用）/
│   │                            useDragPan（總覽時間軸按住拖曳平移）/
│   │                            useScrollLock（鎖頁面捲動：先停平滑捲動、補捲軸寬、參考計數）/
│   │                            useCloseOnScroll（fixed 浮層的觸發元素被捲走時關閉）/
│   │                            motionTokens（執行期讀動畫 token：JS 動畫與 CSS 同源）/
│   │                            heightTween（容器高度雙向補間：holdHeight 撐住、releaseHeight 每幀追自然高度）/
│   │                            useCollapseReenter（原地收合清單：同 key 離場中又回來時從當下高度 / 透明度接續）
│   ├── constants/         畫面用常數（dashboard.ts：狀態 / 優先度 / 等級的標籤與顏色；overview.ts：總覽的排序鍵、標籤、尺寸；api.ts：API_ERROR_TEXT）
│   ├── lib/               純函式（日期、月曆格、排程連動、篩選、排序、格式化、id、CSS 時長 / 曲線 token 轉 JS（easing.ts）…）
│   ├── mocks/             範例資料
│   ├── router/            路由（index.ts：切頁時先載目標頁資料；pageSwap.ts：切頁過渡結束後才還原捲動位置）
│   ├── stores/            Pinia store（三層，見下）
│   │   ├── clock.ts                           時鐘層
│   │   ├── task / issue / comment / member.ts   資料層（單一專案）
│   │   ├── portfolio.ts                       資料層（總覽的專案摘要與成員名錄）
│   │   ├── _optimistic.ts                     樂觀更新的共用機制（tracker / runOptimistic / error sink）
│   │   ├── _sync.ts                           api.subscribe 的唯一訂閱點，把事件路由到各資料 store
│   │   ├── rows / filter / selection / ui.ts  派生層（Dashboard）
│   │   └── overview.ts                        派生層（總覽）
│   ├── types/             資料模型型別（models.ts）與畫面層共用型別（ui.ts：LoadState）
│   ├── views/             頁面
│   └── __tests__/         跨目錄的結構守衛（readme / no-query-selector）
└── e2e/                   Playwright 測試與 helper
```

單元測試放在被測檔案旁的 `__tests__/`（例如 `src/lib/__tests__/date.spec.ts`）。不屬於任何單一檔案的結構守衛放 `src/__tests__/`：`no-query-selector.spec.ts`（執行期不得用 DOM 選擇器）、`readme.spec.ts`（本檔的端點表與 `ProjectApi` 一致、目錄結構列到每一支 composable），另有 `src/stores/__tests__/imports.spec.ts`（store 分層白名單）。

## `legacy/` 是唯讀基準

`legacy/` 收的是改寫前的原型：

| 檔 | 作用 |
|---|---|
| `legacy/Dashboard.html` | 行為基準。原型的模板與 `DCLogic` 邏輯類別 |
| `legacy/support.js` | 原型的 runtime（dc-runtime），標明不可手改 |
| `legacy/design-system.html` | 設計基準。`<style id="tokens">` 是 `src/assets/tokens.css` 的來源 |
| `legacy/vendor/*.js` | React 18.3.1 / ReactDOM 18.3.1 / @babel/standalone 7.29.0 的 UMD 檔，讓原型離線也能開 |

**除了讓 vendor 生效所需的那一段 `window.__resources` 之外，`legacy/` 不再修改。** 新舊行為有差異時改的是 `src/`，不是 `legacy/`。

開發伺服器把它掛在 <http://localhost:5174/legacy/Dashboard.html>，可以和 `/projects/pmis` 並排比對。

## 與 legacy 對照

`e2e/compare.spec.ts` 是驗收用的對照測試：**同一組操作分別在 `/legacy/Dashboard.html` 與 `/projects/pmis` 跑一遍**，再比對兩邊的結果。涵蓋 8 項行為（選取連動、篩選、排序與分組、甘特拖曳與相依、重排與收合與新增、就地編輯、詳細視窗、刪除確認與相依編輯器），視窗 1440×900 與 1920×1080 各跑一輪。

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
| 幾何 | 甘特列、甘特條、看板卡、看板欄、Issue 卡、浮層、表單控制項的 boundingBox，加上甘特左欄寬、畫布尺寸與整頁高度；看板欄的 y 與整頁高從頂欄底部量起（頂欄高度新舊刻意不同）；容許 ±1px |

選擇器只用 [DOM 鉤子](#dom-鉤子)表裡標「legacy 也有」的屬性與畫面上的文字。唯一例外是量頂欄高度：新頁用 `.top-bar`，legacy 用第一個 sticky、`top:0` 的列；找到的元素不含成員篩選的 `[data-dd]` 就直接失敗，不會默默當 0。浮層（選單、對話框、詳細視窗）新舊沒有共同的選擇器，測試改用「computed style 的 `position` 是 `fixed`」這個兩頁都成立的特徵，臨時打上 `data-e2e-float` 再操作——標記只加在 DOM 上、兩頁一視同仁，不影響行為。

### 刻意保留的差異

這幾項新舊**本來就不該一樣**，對照測試已排除或反向斷言：

- **從詳細視窗刪任務**：legacy 的 `detail` 還指向已刪 id，視窗不會消失且 `body` 捲動被鎖死（`Dashboard.html:1761`）。新頁 `removeTask` 會清掉 `ui.detail`，走正常關閉動畫。對照測試反向斷言「legacy 有這個 bug、新頁沒有」。
- **檔案多選跨任務殘留**：legacy 的 `fileSel` 不會在換任務時清掉（`:3901`），計數會沿用上一個任務。新頁在 `openDetail` 時清空。
- **附件同日的相對順序**：`filesForTarget` 對同一天的附件沒有定義先後，兩邊可能不同，對照不比這個。
- **重排節流的時間來源**：legacy 用 `Date.now()`，被 e2e 的 `page.clock.setFixedTime` 凍住之後，一次拖曳裡除了第一次以外的 `dragTick` 全部被節流擋掉；新頁用 `performance.now()`，不受固定時鐘影響。這是測試環境造成的差異，不是行為差異——對照測試的重排只送一次 `mousemove`，比第一次落點。
- **理論進度的判準**：legacy 把「今天到期」的任務算進理論進度（`end <= 今天`，`Dashboard.html:3604-3620`）。新頁要到期日**隔天**才算（`end < 今天`），和總覽的 `taskPlanned`、「已延遲」的 `isLate` 同一個定義（都呼叫 `lib/schedule.ts` 的 `isPlannedDone`，改規則只改那裡），兩頁同一個專案的理論 % 才會一致（user 決定）。對照測試只遮掉摘要卡的差距標籤、理論的 N / 總數與理論 %（`e2e/helpers/compare.ts` 的 `maskPlan`），其餘照比。
- **甘特列的快捷鈕**：legacy 滑鼠移到任務列上會撐開「▲ ▼ ⇄ ✕」並省掉日期的年份；新頁改成列尾一直顯示的「⋮」，動作收在它開的選單（user 決定：只想標記任務時快捷鈕很干擾，▲ ▼ 也看不出是工期 ±1 天）。對照測試比文字時兩邊都拿掉列尾動作字與年份（`e2e/helpers/compare.ts` 的 `maskActs`），情境 8 的相依 / 刪除各走各的路（`compare.spec.ts` 的 `rowAction`）；點任務列的位置改在名稱區 x=70（`ROW_NAME_POS`）。
- **頂欄放不下時改兩列**：篩選器在標題與右端之間一行放不下時（預設篩選約 1470px 以下；啟用日期範圍、專案名稱較長時門檻更高），新頁把篩選器整排移到滿寬的第二列、靠左排，標籤和它的下拉一定在同一行（`TopBar` 的 `measureFit` 量實際寬度切 `.stacked`）。legacy 是篩選器擠在中間自己換成兩行，標籤和下拉會被拆開（user 回報 15.6 吋筆電常見的 1200～1470px 排版怪異）。兩邊頂欄高度因此不同（1440 時差 2px），對照測試的看板欄 y 與整頁高改從頂欄底部量起（`e2e/helpers/compare.ts` 的 `geoSnapshot`），頂欄以下的幾何照樣 ±1px。兩列時日期日曆也不同：legacy 一律對齊篩選器右緣，篩選器滿寬時會離日期膠囊很遠；新頁改以日期那一組為基準、左緣對齊「日期」（user 決定），日曆在 DOM 裡也移進日期那一組（legacy 在「清除篩選」之後）。對照測試都在日曆關上之後才擷取，不受影響。
- **頂欄與面板的浮層**：legacy 的篩選下拉、成員面板、日期日曆、排序選單關閉時瞬間消失，新頁有離場淡出（批次 D 的 `pop`）；legacy 的日曆遮罩被 `.top-bar` 的 transform 限制成只蓋頂欄，會吃掉頂欄其他控制項的第一下點擊，新頁拿掉遮罩、點外面照常關（點擊照常送達），點另一顆日期膠囊只切換要填的端點、日曆不關；頂欄一行時下拉與成員面板右緣對齊往左展開（legacy 一律 `left: 0`，勾選讓觸發鈕變寬時選單跟著移）；排序選單開著時固定在打開時的位置（legacy 跟著觸發鈕跑）；一行時篩選項變寬整排平滑滑動、排序 chip 原地展開收起（legacy 一幀跳）。對照測試在 settle 之後才擷取，`[data-dd]` 序列不變。
- **錯誤條的出現與關閉**：legacy 出現時整頁一幀被推下約 40px、關閉一幀收回；新頁原地展開 / 收起並淡入淡出（`ErrorBar.vue`）。對照測試沒有讓錯誤條出現的情境，不受影響。
- **成員拖曳指派**：legacy 可以把成員篩選面板的列拖到甘特條或任務卡上指派，新頁移除了這個功能（user 決定；平板無法可靠支援原生拖放），指派一律在詳細視窗的「＋指派」。對照測試不比這個。
- **相依編輯器的位置**：legacy 一直垂直置中，增刪前置 / 後續任務時上下兩端一起跳；新頁打開時置中、之後上緣固定，只往下長（user 決定）。對照測試只比寬高，不受影響。
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
| 資料層 | `task.ts`、`issue.ts`、`comment.ts`、`member.ts`（＋共用的 `_optimistic.ts`、`_sync.ts`）；總覽的 `portfolio.ts` | 專案資料的唯一擁有者；所有寫入都經 `@/api` | `@/api/*`、`@/lib/*`、`@/types/*`、`@/stores/clock`、其他資料 store、`_optimistic` / `_sync` |
| 派生層 | `rows.ts`、`filter.ts`、`selection.ts`、`ui.ts`；總覽的 `overview.ts` | 從資料層算出畫面要的東西（可見列、篩選、選取、浮層 / 錯誤條 / 收合） | 所有層 |

成員名錄有兩份：`portfolio.members`（總覽，含各專案的 PM）與 `member.members`（Dashboard，單一專案的成員）。總覽元件查成員一律用 `portfolio.byId`。

離開頁面時，兩邊的狀態處理方式不同：
- `overview` store 會保留：從 Dashboard 回到總覽時，篩選、排序、展開與檢視都還在。
- Dashboard 卸載時，`ui.resetTransient()` 會清掉詳細視窗與浮層這類暫態，回來時不會自己打開。

**資料層不知道派生層存在**，所以三件原本會反向依賴的事改成這樣：

- 新增的預設值（分類、負責人、起訖日）由 `composables/useTaskActions.ts` 的 `addTaskWithDefaults()` 算好再傳進 `taskStore.addTask()`；建立後的選取也在那裡做。
- 刪除後的懸空 id 由 `selection.ts` / `ui.ts` 各自的 `watch(..., { flush: 'sync' })` 清（`selection.taskId` / `issueId` / `groupId`、`ui.detail`（含 `detail.from`）、`confirm`、`depEditFor`、`pickerFor`、`rowMenu`、`expandedIssues[id]`）。
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

**唯一例外**：`composables/useClickOutside.ts`。它做的是「這一下點在哪」的 hit-test，對象是任意祖先而不是某個登錄過的元素，所以仍用 `Element.closest`——`KEEP_SELECTION`（`[data-card],[data-taskid],[data-rowtask],[data-rowgroup],[data-issuerow],[data-dd],[data-errorbar],input,textarea,select,label` 逐字取自 legacy，另加新頁的 `[data-keep-selection]`）與 `KEEP_POPUP`（`[data-dd],[data-errorbar]` 取自 legacy，另加新頁的 `[data-keep-popup]`：日期膠囊——日曆拿掉遮罩後，點膠囊切換端點不該先關日曆再開；不用 `data-dd` 是因為 `compare.spec` 依 `[data-dd]` 的序列對照 legacy）。改動這些屬性名會弄壞「點外面清選取 / 關浮層」，不是只有測試變紅。它也是 `no-query-selector.spec.ts` 的白名單唯一一筆。

**不進登錄表的元素**：開啟浮層的觸發元素（選項選單、兩種日期選擇器、列動作選單）記在 `composables/useMenus.ts` 模組層的 `menuAnchors`，給 `useCloseOnScroll` 判斷捲動有沒有把它帶走。它記的是「誰開了目前這個浮層」，不是常駐的畫面元素；而且登錄表在沒有 provider 時每次回一張新表，登錄進去會靜默失效。離開 Dashboard 時由 `DashboardView` 呼叫 `clearMenuAnchors()` 放掉。

| 屬性 | 掛在 | 值 | legacy 也有 |
|---|---|---|---|
| `data-rowtask` | 甘特左欄任務列 | taskId | ✓ |
| `data-rowgroup` | 甘特左欄分類列 | groupId | ✓ |
| `data-taskid` | 甘特條（收合分類的摘要條為 `sum-<groupId>`） | taskId | ✓ |
| `data-linkfor` | 甘特條兩側的連線圓點 | taskId | ✓ |
| `data-rowmore` | 甘特任務列尾的「⋮」 | taskId | ✗ |
| `data-rowmenu` | 「⋮」開的動作選單（全域只會有一個） | taskId | ✗ |
| `data-card` | 看板任務卡 | taskId | ✓（legacy 值固定為 `1`，對照時只比存在性） |
| `data-issuerow` | Issue 卡 | issueId | ✓ |
| `data-col` | 看板欄內容區 | 狀態 key | ✓ |
| `data-dd` | 所有下拉的觸發器與面板 | `1` | ✓ |
| `data-zoom` | 甘特縮放滑桿 | `1` | ✓ |
| `data-errorbar` | 錯誤條容器（同一元素帶 `role="alert"`；外面還有一層 `.error-slot` 做高度補間，`v-if` 拿掉的是那層，關閉後整條不留） | 空值 | ✗ |
| `data-keep-selection` | 只改怎麼看、點了不清選取的控制項（平板甘特左欄的展開鈕） | 空值 | ✗ |
| `data-keep-popup` | 點了不關浮層的觸發元件（頂欄的日期膠囊：日曆開著時點它只切換要填的端點） | 空值 | ✗ |
| `data-loadstate` / `data-load-error` | 載入中 / 失敗畫面的容器與錯誤訊息（Dashboard 與總覽共用 `LoadingState`） | 空值 | ✗ |
| `data-selected` | 甘特任務列 / 任務卡 / Issue 卡 / 總覽時間軸的專案列 `.p-row` | `true` / `false` | ✗ |
| `data-rel` | 任務卡 | `up` / `down` / `group` / 空 | ✗ |
| `data-status` | 甘特條 / 任務卡 / Issue 卡 | 狀態 key，或 `delayed` | ✗ |
| `data-panel` | 面板外殼 | `gantt` / `kanban` / `issues` | ✗ |
| `data-testid` | 摘要卡 `summary-duration` / `summary-progress` / `summary-tasks` / `summary-issues`；頂部 `filter-clear` / `only-filtered`；面板標題 `task-count` / `issue-count`；甘特左欄的展開鈕 `gantt-left-toggle`（只在 < 900px 出現） | 固定字串 | ✗ |

總覽頁的屬性。legacy 沒有這一頁，所以下表全部都不能用在新舊對照測試：

| 屬性 | 掛在 | 值 |
|---|---|---|
| `data-view` | 總覽頁根元素 | `overview` |
| `data-view-panel` | 兩種檢視的面板外殼（`OvPanel`） | `cards` / `timeline` |
| `data-view-switch` | 頂欄的檢視切換鈕（帶 `aria-pressed`） | `cards` / `timeline` |
| `data-project` | 專案卡；時間軸的 `.p-block`（同時包住 `.p-row` 與 `.qv`） | projectId |
| `data-drawer` | 卡片檢視的速覽抽屜（每條泳道一個，是卡片的兄弟元素，插在展開那張卡所在列下方；`id` 是 `lane-qv-<成員 id>`，對應卡片的 `aria-controls`） | 正在顯示的 projectId（沒展開時沒有這個屬性） |
| `data-pm-col` | 卡片檢視的 PM 泳道 | 成員 id |
| `data-pm-group` | 時間軸的 PM 群組列 `.g-row` | 成員 id |
| `data-pm-option` | 成員篩選面板的一列（帶 `aria-pressed`） | 成員 id |
| `data-ov-dd` | 總覽頂欄的下拉根元素（見表下說明） | `pm` / `status` / `alert` |
| `data-testid` | 面板計數 `overview-count`、搜尋框 `overview-search`、清除篩選 `overview-clear`、空狀態 `overview-empty`、時間軸「今天」`overview-today` | 固定字串 |

`data-ov-dd` 刻意和 Dashboard 的 `data-dd` 分開：它不在 `useClickOutside` 的保留清單裡，總覽的浮層改由 `useDismiss` 關閉。

總覽 e2e 還依賴下表這些 class，**改名時要同步改測試**。用到的檔是 `e2e/overview.spec.ts`、`e2e/overview-motion.spec.ts`、`e2e/overview-tablet.spec.ts`、`e2e/page-motion.spec.ts`、`e2e/helpers/overviewPage.ts`：

| 用途 | class |
|---|---|
| 頁面根元素 | `.dash`（Dashboard；`page-motion.spec` 量它的透明度） |
| 頂欄與下拉 | `.dd-trigger` `.dd-menu` `.alert-dot` |
| 排序 | `.sort-trigger` `.sort-menu` `.sort-chip` `.chip-label` `.chip-x` `.chip-arrow` |
| 面板 | `.panel-head` `.panel-title` `.panel-toggle` `.panel-body` `.panel-caret` |
| 卡片 | `.lane-head` `.card-main` `.card-name` `.card-caret` `.hero` `.pa-bar` `.fill` `.enter-edge` `.qb-title` `.pm-count` |
| 時間軸 | `.tl-body` `.tl-left-head` `.today-tag` `.p-row` `.p-left` `.p-name` `.c-pct` `.c-gap` `.pct-plan` `.bar` `.bar-label` `.g-caret` `.g-sum` `.qv` `.qv-head` |
| 過渡（Vue 自動加上的 class） | `ov-pop-*` `ov-fade-*` `ov-view-*` `ov-card-*` `ov-col-*` `ov-row-*` `ov-chip-*` `ov-av-*`（定義在 `assets/overview-motion.css`）；切頁的 `page-view-*`（定義在 `assets/base.css`）；時間軸連接框 `.qv-cap`；Dashboard 浮層的 `pop-*`（選單、日期選擇器）`dialog-*`（相依編輯器、確認框）`fade-*`（Lightbox）定義在 `assets/base.css`，詳情視窗的 `detail-fade-*` `detail-pop-*` 在 `DetailModal.vue` |

## 怎麼接後端

前端已經整成「換掉 `src/api/` 的實作就能接」：**所有資料進出都經過 `src/api/types.ts` 的 `ProjectApi` 介面**，store 與元件都不認識 `src/mocks/`。現在的實作是記憶體 mock（`src/api/mock/`），示範資料由 `createMockApi()` 自己帶（`src/mocks/sampleProject.ts`），進入點 `src/api/index.ts` 不碰它。

`src/api/types.ts` 檔頭的 wire 約定註解跟這一節是同一份內容；改契約要兩邊一起改（端點表的一致性由 `src/__tests__/readme.spec.ts` 守著）。

### 步驟

1. **寫實作**：新增 `src/api/http/index.ts`，`export function createHttpApi(): ProjectApi`，照下面的端點表逐一實作每支方法。不要改介面去遷就後端——後端形狀不同就在這一層轉，介面本身是契約。
2. **切換**：`src/api/index.ts` 的 `createApi()` 依 `VITE_API` 挑實作（未設、空字串或 `'mock'` 用 mock，其他值丟錯）。加一支 `'http'` 分支即可，其餘檔案一行都不用改。`VITE_API` 的型別宣告在 `env.d.ts`。走非 mock 實作時 `export const mockApi` 是 `undefined`（型別就是 `MockApi | undefined`）。
3. **adapter 的職責**（後端形狀 → 前端模型，全部在這一層做完，`src/types/models.ts` 不因後端而變）：

   | 項目 | 前端 | 後端 / wire | 誰轉 |
   |---|---|---|---|
   | 空值 | `''`（`ISODate`、`done`、`Attachment.url`） | 多半是 `null` | adapter 雙向 `null ↔ ''`；`''` 是**有效值**（代表「沒有日期」），不是「這個欄位沒送」 |
   | `Task.start / end / done`、`Issue.due / done / created` | `'YYYY-MM-DD'` | 同上或 ISO 8601 日期 | adapter |
   | `Comment.at` | `'YYYY-MM-DDTHH:mm'`（**本地**時間、到分鐘） | ISO 8601 含 offset | adapter 兩邊轉，前端不做時區運算 |
   | `Attachment.at` | `'YYYY-MM-DD'`（本地日） | ISO 8601 | adapter |
   | `Group` | 只有 `id` / `name` | 後端若存了收合狀態要忽略 | 收合是畫面狀態，在 `ui.collapsedGroups`，不上 wire |
   | `ProjectData.currentUserId`、`PortfolioData.currentUserId` | 必填字串 | 登入還沒做 | adapter 從 session / token 填；沒有登入就先填一個固定成員 id |
   | `ProjectSummary.taskPlanned` | 「照排程今天之前就該完成」的任務數 | 後端依伺服器當日算 | 後端；前端只拿它算理論 %，跨日差一天可接受 |
   | `Member.color` | 合法的 CSS 顏色值（例 `#2563eb`），經 `:style` 寫進 CSS 變數 | 後端存的顏色字串 | adapter 驗格式；前端沒有用字串拼接組 CSS，但格式錯會讓頭像與 PM 泳道沒有顏色 |
   | `ProjectSummary.upcoming` | 最多 3 筆、依到期日升冪、含已逾期 | 後端篩選排序 | 後端；前端原樣顯示 |
   | `ProjectSummary` 的不變式 | `taskDone === taskCounts.done`、`taskTotal === taskCounts` 加總 | — | adapter 驗；實際 / 理論 %、落後百分點、需注意由前端 `lib/portfolio.ts` 算，**後端不給** |
   | `Attachment.id` | `'<commentId>:<index>'`（`downloadAttachment` 的鍵） | 後端自己的附件主鍵 | adapter；只要 `loadProject` 與 `createComment` 回的 id 能餵回 `downloadAttachment` 就行 |

4. **跑測試**：`npm run test:unit -- --run` 全綠、`PLAYWRIGHT_PORT=5174 npm run test:e2e` 全綠（靠 mock 的兩條會自動跳過，見下）。

### 端點對照表

路徑是建議值；後端不同就在 adapter 對應，**介面的參數 / 回傳 / 錯誤碼才是契約**。都不分頁：`loadProject()` 回單一專案整包，`listProjects()` 回所有專案的摘要。彙整規則寫在 `src/api/types.ts` 檔頭，參考實作是 `src/api/mock/portfolio.ts` 的 `summarizeProject()`。

| 方法 | HTTP | 路徑 | request | response |
|---|---|---|---|---|
| `loadProject()` | GET | `/api/project` | — | `ProjectData`（整包；`tasks` / `groups` 的陣列順序就是顯示順序） |
| `listProjects()` | GET | `/api/projects` | — | `PortfolioData`（所有專案的 `ProjectSummary` ＋ 成員名錄 ＋ `currentUserId`；`projects` 順序無意義，`members` 順序就是顯示順序） |
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
- **事件與 response 的到達順序後端不必保證**。client 兩種順序都正確（機制見〈樂觀更新怎麼運作〉的 in-flight 規則）：事件先到就只更新「最後已知的 server 狀態」，等該 id 的請求全部結束才對齊本地。不要為了排順序而延後廣播或延後回應。

### 錯誤碼對照表

api 層只往外拋 `ApiError`（`code` / `message` / `status` / `method`）。`code` 決定畫面文案，`message`（server 原文）只進 console，不上畫面。

| `ApiError.code` | HTTP status | 錯誤條文案 |
|---|---|---|
| `network` | fetch 直接拋錯 / 沒有回應 | 連線失敗 |
| `validation` | 400、422 | 資料不合法 |
| `not_found` | 404 | 資料已不存在 |
| `conflict` | 409 | 與伺服器狀態衝突 |
| `unknown` | 其他 | 發生錯誤 |

對照表在 `src/constants/api.ts`（`API_ERROR_TEXT` / `apiErrorCode()`，Dashboard 與總覽共用）。錯誤條 `ErrorBar` 顯示的是「操作名稱（`label`，例如『更新任務』）＋ 上表文案」，同 label 會合併成 `×N`，最多留 5 筆、畫面顯示 3 筆，不自動關閉。

「同 label 合併」的視窗是 **`clock` 的 60 秒 tick**，不是牆鐘 5 秒：`ui.pushError` 的時間戳取 `clock.now`（每 60 秒才走一次），所以實際行為是「同一個 tick 內的同 label 合併成一筆」。刻意如此——連續失敗不該把錯誤條洗版。

### 事件

`subscribe(handler)` 是後端推變更的唯一入口，前端只有 `src/stores/_sync.ts` 的 `useProjectSync()` 訂閱它（`DashboardView` 掛載時 `start()`、卸載時 `stop()`），再依 `type` 前綴路由到各資料 store 的 `applyEvent`。

總覽頁（`/`）**不訂閱事件**：進頁時 `listProjects()` 載入一次，之後每次回到總覽都在背景重載（畫面不切回載入中），所以在 Dashboard 做的改動回總覽就看得到。

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

### 樂觀更新怎麼運作

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

dev build 會把 mock 掛在 `window.__mockApi`（`src/api/index.ts` 的 `if (import.meta.env.DEV)`），e2e 用它注入延遲與失敗（`failNext` / `setLatency` / `reset` / `emit`）。總覽的載入失敗用 `failNext('listProjects')`。

接上真後端之後 `window.__mockApi` 會是 `undefined`，這幾條開頭就是 `test.skip(!__mockApi)`，會自動跳過，其餘照跑：`e2e/interactions.spec.ts` 的**那兩條**（api 失敗後還原並顯示錯誤條、載入失敗後重試）、`e2e/errorbar-motion.spec.ts` 的頁頂與捲到中段兩條（`failNext('updateTask')` 讓錯誤條出現；另四條直接呼叫 `ui.pushError`，不需要 mock）、`e2e/load-motion.spec.ts` 的重進 Dashboard（`setLatency`）與載入次數守門。要在真後端上也測失敗路徑，就換成在 `page.route()` 攔 HTTP 回錯誤碼。

**每次進頁只打一次 load**：`failNext` 只擋下一發，切頁先載（`router` 的 `beforeEach`）與頁面掛載的 `reload()` 共用同一發，失敗與重試的測試才有意義；`load-motion.spec` 的次數守門守這一點。

### 還沒做的（接後端時要補）

- **逾時與取消**：`ProjectApi` 目前沒有 `AbortSignal`，也沒有逾時。網路實作至少要給每個請求一個逾時（逾時 → `ApiError('network')`）；離開頁面或連續改動時要能取消前一發。
- **authn / authz**：`ProjectApi` 完全沒有身分概念，**每一支端點都要後端自己做認證與授權**。`ProjectData.currentUserId` 只是「留言掛誰、頭像顯示誰」的顯示用欄位，是 client 送什麼就是什麼，**絕對不能拿它當身分**。
  - 兩頁重進時的背景重載失敗**只記 console、畫面維持舊資料**（Dashboard 的 `useProjectBoot`、總覽的 `usePortfolioBoot`）。加上登入之後，session 過期 / 撤權 / 專案被刪（401 / 403 / 404）不能也這樣吞掉：`ApiErrorCode` 補 `unauthorized` / `forbidden`，背景失敗遇到這幾種就清掉資料、切成錯誤或導回登入頁，只有 `network` 才維持舊資料。
  - 登出 / 換使用者要有明確的重置：清資料層（task / issue / comment / member / portfolio）與 `selection` / `filter`，兩個 `loadState` 設回 `idle`；不然下一位進頁時是背景重載，會先看到上一位的資料。
  - 加登入守衛時，`router/index.ts` 的先載守衛要排在它**後面**（守衛依註冊順序執行），未登入或被擋下的導航才不會先打出需要認證的請求。
- **PATCH body 要用 schema 白名單驗欄位**：`updateTask` / `updateGroup` / `updateIssue` 送的是 JSON merge patch，後端必須逐欄位比對允許清單再寫入，**不可以整包 merge 進實體**（mass-assignment；也要擋 `__proto__` / `constructor` / `prototype` 這類鍵造成的原型污染）。同理 `createTask` 這些帶完整實體的端點也要過一次 schema。
- **多人衝突**：現在是「後到的覆蓋先到的」，沒有版本號或 `If-Match`。同時編輯同一筆的情境沒有處理（spec 已排除）。附帶一提：`dirty`（本地改了還沒送出）只保護**本地**不被 reconcile 蓋掉，**不保護 server 端**——那段值還沒上 wire，別的 client 這段時間寫進去的東西，等它送出時一樣會被覆蓋。
- **附件上傳驗證**：`comment.addDraftFiles` 直接 `URL.createObjectURL`，沒有任何檢查。要補檔案大小上限、MIME 型別與副檔名白名單（三者都要，只擋副檔名擋不住偽裝的檔案），**伺服器端再驗一次**。
- **依 id 載入專案**：路由已經是 `/projects/:id`，但資料層仍是單專案設計（`loadProject()` 沒有參數、`subscribe` 不分專案、Dashboard 的 store 是單例）。接上時：
  1. 契約改成 `loadProject(id)` → `GET /api/projects/:id`、`subscribe(id)`；`api/types.ts` 檔頭與〈端點對照表〉一起改。
  2. DashboardView 從 `route.params.id` 取 id 傳給 `useProjectBoot()`。`App.vue` 的頁面 key 已經是 `route.path`，換專案時 Dashboard 會重新掛載、重新載入。
  3. 換專案時要清空資料層（task / issue / comment / member）與 `selection` / `filter`，不能只靠 `ui.resetTransient()`（它只清暫態浮層）。
  4. 總覽的 PMIS 摘要目前由 mock 從範例專案彙整，接上後改由後端的 `listProjects()` 提供。
  5. 切頁先載已經收到路由的 id（`router/index.ts` 的 `preloadProject(String(to.params.id))`），把它往下傳給 `loadProject(id)`。
  6. 換了專案不走背景重載**已經做了**：`useProjectBoot.ts` 的 `loadedId` 記著 store 裡是哪個專案，不同就走「載入中」（單元測試守），畫面不會先秀上一個專案、也不會在 B 的頁面改到 A。剩下要處理的是換專案時先載把 `ui.loadState` 切成 loading，正在淡出的舊頁會閃一下「載入中」（例如等新頁掛上才切）。
- **切頁先載與背景重載的競賽**（mock 延遲為 0，現在不會發生）：
  - **事件空窗**：先載的快照在導航一開始就打，`subscribe` 要到 Dashboard 掛載（舊頁淡出之後）才開始，這段時間別人改的事件會漏接。接後端時把訂閱提前，或訂閱後比對版本再補一次 `project.reloaded`。
  - **整包覆蓋**：背景重載回來時使用者已經能操作，`applyProject` 會整包覆蓋本地，包括還沒送出（`dirty`）的改動，語意同 `project.reloaded`。延遲大的後端要考慮背景重載遇到 `dirty` / `inflight` 時延後套用。
  - **舊快照蓋回已完成的寫入**：Dashboard 背景重載的請求若在某次寫入之前被後端處理、卻在寫入的 response 之後才回來，`inflight` / `dirty` 都已清空，`applyProject` 會把那筆蓋回舊值（server 其實是新值）。整包資料帶版本或時間戳、比本地已確認的舊就丟掉，可以一併解決上一點。
  - **讀寫先後**：Dashboard 剛送出修改就切回總覽時，先載的 `listProjects()` 可能比那次修改先被後端處理，總覽短暫顯示舊值、下次載入才更新。
- **總覽的規模**：時間軸範圍涵蓋所有專案與今天，日刻度與底色格的 DOM 節點數跟天數成正比。專案變多、時間跨度拉長時，要考慮限縮範圍或做虛擬化。
- **總覽的篩選不寫進網址**：重新整理或分享連結時，篩選條件不會保留。
- **`prefers-reduced-motion`**：全專案都還沒支援。總覽的過渡集中在 `assets/overview-motion.css` 與各元件的 `transition`，要支援時從這裡下手。Dashboard 的浮層在 `assets/base.css` 的「浮層進出場」段（pop / dialog / fade）與 `DetailModal.vue` 的 detail-fade / detail-pop；切頁的 `page-view-*` 在 `assets/base.css`，錯誤條的進出場與換行補間在 `ErrorBar.vue` 的 `tween()`（Web Animations，讀 `--t-panel`；CSS 的 reduced-motion 規則管不到，要在這裡判斷）。
- **CSP**：目前沒有 Content-Security-Policy；上線前在伺服器或 CDN 層補上，至少限制 `script-src` / `style-src` / `img-src`（`blob:` 要放行，附件預覽用得到）。
