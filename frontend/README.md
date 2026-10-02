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
- 有登入頁（`/login`）：沒登入時任何頁面都會導到登入頁，登入後回原頁。mock 預設已登入（登入者是總覽的 m11「成員11」）；登出後任何格式正確的帳號（英數與 `.` `_` `-`）、不空的密碼都登得進去，`wrong_password` / `outsider` / `locked_out` / `ad_down` 四個帳號固定登入失敗，用來看各種失敗文案。總覽頂欄右端的登入者點了有選單（目前只有「登出」）。Dashboard 的 `currentUserId` 仍是範例資料裡固定的成員（m1），只決定留言掛誰。
- Dashboard 依路由的 `/projects/:id` 載入（`api.loadProject(id)`），換專案時先清空資料層與選取、篩選（`useProjectBoot`）。mock 只有一份完整專案資料（`mocks/sampleProject.ts`），任何 id 都回這一份；頂欄的專案名來自它的 `project.name`（`My Project`）。
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
登入  router.beforeEach（登入守衛，排在先載守衛之前）──▶ 第一次導航問 api.getSession()；沒登入導到 /login?redirect=原路徑
      api 遇到 401 ──▶ api/authEvents.ts 的 onUnauthorized ──▶ main.ts 導到登入頁；登入頁掛上時 resetSession() 整個重置
啟動  router.beforeEach ──▶ preloadProject(id) / preloadPortfolio()：切頁一開始就先載目標頁（不阻塞導航）
      DashboardView ──▶ useProjectBoot(id)：注入 sink、沿用先載的那一發（loadProject(id)）、訂閱這個專案的事件
      ProjectsOverviewView ──▶ usePortfolioBoot()：沿用先載的那一發 ──▶ api.listProjects()
      兩頁都是第一次顯示載入中、之後背景重載（畫面維持 ready；背景失敗只有連不上才維持舊資料，其他清掉切成錯誤）
```

演算法（日期、cascade、篩選、排序）是 `src/lib/` 的純函式，store 只存狀態並把它們接起來。

### 畫面對元件

`views/DashboardView.vue` 掛的東西，都在 `src/components/`：

| 畫面區塊 | 元件 |
|---|---|
| 頂部篩選列與錯誤條 | `layout/TopBar`（FilterDropdown、FilterCalendar、MemberPicker、common/ErrorBar） |
| 四張摘要卡（總時長與進度合一張、任務狀態、Issue 統計、預算 vs. 支出） | `summary/SummaryCards` |
| 甘特圖 | `gantt/GanttPanel`（GanttTimeline、GanttGroupRow、GanttTaskRow、GanttBars → GanttBar、DependencyLines）；任務列「⋮」的動作選單 `gantt/RowActionMenu` |
| 任務看板 | `kanban/KanbanPanel`（KanbanHeader、TaskCard） |
| Issue 看板 | `issues/IssuePanel`（IssuePanelHeader、IssueCard） |
| 詳細視窗 | `detail/DetailModal`（DetailHeader、TaskProperties、IssueProperties、CommentsTab、FilesTab、ActivityToolbar）、`detail/ImageLightbox` |
| 浮層 | `common/OptionMenu`、`common/DatePicker`、`common/ConfirmDialog`、`dialogs/DependencyEditor`、`gantt/RowActionMenu` |
| 三個面板共用 | `common/PanelShell`、`common/SortChips`、`common/SortMenu` |

`views/ProjectsOverviewView.vue`（總覽）掛的東西，都在 `src/components/overview/`：

| 畫面區塊 | 元件 |
|---|---|
| 頂欄：檢視切換、篩選、登入者 | `OverviewTopBar`（PmFilter、OvDropdown、UserMenu：登入者與它的選單，入口都放這裡） |
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

`views/LoginView.vue`（登入頁）是單一元件，外觀沿用總覽的控制項與面板（輸入框照搜尋框、卡片照 `OvPanel`）。
### 改動時要碰的檔

| 要做的事 | 依序碰 |
|---|---|
| 加或改資料欄位 | `types/models.ts` → `api/types.ts`（檔頭 wire 約定）→ `api/mock/store.ts` → 對應資料層 store 的 action → 元件 → 各自旁邊的 `__tests__/` → 本檔〈端點對照表〉 |
| 加一支 api 方法 | `api/types.ts` 的 `ProjectApi` → `api/mock/index.ts` → store action → 本檔〈端點對照表〉（`readme.spec.ts` 會比對兩邊） |
| 加畫面狀態（開關、選取、篩選） | 派生層 store 加欄位，元件直接寫：Dashboard 是 `ui` / `filter` / `selection`，總覽是 `overview` |
| 加 store，或在 store 加欄位 | 該 store 的 `reset()`（或既有的清空函式）要清得到它，`composables/useSession.ts` 的 `resetSession()` 要呼叫到；登出後下一位使用者不能看到上一位的東西。`composables/__tests__/useSession.spec.ts` 檢查重置後每個 store 都等於全新的初始狀態，漏了就紅 |
| 加登入者選單的項目（回收桶、匯入專案…） | `components/overview/UserMenu.vue`（加在「登出」上面） |
| 改純邏輯 | `lib/` 加純函式 + 單元測試，再由 store 或元件呼叫 |
| 加設計值（顏色、間距） | 先加 `assets/tokens.css` 的變數，再在 `<style scoped>` 引用；不直接寫色碼 |
| 改使用者操作流程 | 對應的 `e2e/*.spec.ts`；選擇器只用〈DOM 鉤子〉表裡的屬性 |
| 改總覽的畫面狀態（篩選、排序、展開、檢視） | `stores/overview.ts`；純邏輯（派生值、篩選、排序、分組）在 `lib/portfolio.ts` |
| 改總覽的範例專案 | `mocks/samplePortfolio.ts` ＋ `mocks/__tests__/portfolio.spec.ts`（數字要對得上設計稿）；PMIS 摘要改 `api/mock/portfolio.ts` |
| 加總覽的互動或 UI 變化 | 元件 ＋ `assets/overview-motion.css`（過渡 class 唯一定義處）＋ `e2e/overview-motion.spec.ts`（在 spec〈動畫清單〉加一項，就在這裡補一條守衛）；要量逐幀連續（位置、高度、透明度不跳、不反向）的守衛放 `e2e/ov-*.spec.ts`，helper 在 `e2e/helpers/ovMotion.ts`。逐幀測試的寫法（平行跑全套也穩）：trace 的幀時間是 `document.timeline.currentTime`（這一幀的開始時間，CSS 過渡照它推進，不用回呼當下的時間算速度）；「做了又反悔、淡入中移除、位移中篩掉」這類第二個動作在頁內逐幀看進度（透明度、位置、高度走到某處）才觸發，不用固定毫秒數；會受機器負載影響的條件寫成前提（`withPremise`：不成立就重開頁面重來，程式退化讓前提永遠不成立時照樣紅），在測試的註解寫清楚前提是什麼。清單進出場：泳道 / 時間軸群組 / 列是原地收合，結構是外層（grid，帶 `data-lane-wrap` / `data-g-wrap` / `data-row-wrap`）→ 裁切層 → 本體；外層平常的 `grid-template-rows: 1fr` 要寫在 `:where()` 裡（scoped 加的屬性選擇器特異度會壓過 enter-from / leave-to 的 0fr，只剩淡入淡出），間距與分隔線放在裁切層裡跟著收（群組分隔線在 `OverviewTimeline` 的 `.g-wrap + .g-wrap .g`）。同 key 離場中又回來的接續：泳道 / 群組 / 列用 `useCollapseReenter`（泳道與群組綁 TransitionGroup 的 `@vue:before-update` / `@enter`，離場另綁 `@leave="startLeaveNow"` 讓收合與重排同一幀開始（否則換順序的項目先鼓出再回來），每個項目外層綁 `@vue:updated="reenter.resume"`（進場中被換順序時從當下接續）；列綁 `TimelineGroup` 自己的 `onBeforeUpdate` / `onUpdated`，`onUpdated` 要註冊在 `useRelativeFlip` 之前，先寫好回來那列的起點，重排才量得對），卡片用 `useFreezeReenter`。容器高度跟著內容變用 `heightTween`（`holdHeight` 撐住、`releaseHeight` 逐幀追自然高度，元件卸載時呼叫 `cancelHeight`；被撐住的容器不能把多出來的空間分給子元素，grid 要設 `align-content: start`）：看板 / 時間軸 ↔ 空狀態撐 `CardBoard` / `OverviewTimeline` 的 `.ov-stage`（`flow-root` ＋ `overflow: clip`），切檢視撐 `ProjectsOverviewView` 的 `.column`（`onViewEnter` 一插入就放開欄高，並立刻拿掉 `ov-view-enter-from`）；空狀態只延後「有 → 空」（`showEmpty` 等 `--t-panel` 讓清單先收完），「空 → 有」立即 |
| 加 Dashboard 的浮層（選單、日期選擇器、對話框） | 元件包 `<Transition name="pop \| dialog \| fade">`（根元素與對話框本體不寫 transition / animation / opacity / transform）；fixed 浮層接 `useCloseOnScroll`、開啟函式放 `useMenus`（記觸發元素）；鎖頁面捲動用 `useScrollLock`；`e2e/popover-motion.spec.ts` / `dialog-motion.spec.ts` 加一條離場守衛。頂欄的篩選下拉 / 成員面板 / 日期日曆、看板與 Issue 的排序選單、Issue 分欄下拉也是 `pop`（absolute 掛在觸發鈕或容器下，不是 fixed）：頂欄一行時傳 `align="end"`（右緣對齊，觸發鈕往左變寬時選單不動）、兩列時 `start`；排序選單以 `.sorts` / `.tools` 為定位基準、打開當下量好位置（`--menu-x` / `--menu-y`），開著期間不跟著觸發鈕；點了不該關掉浮層的觸發元件（例：日期膠囊）標 `data-keep-popup`。守衛在 `e2e/dash-menu-motion.spec.ts` |
| 改 Dashboard 頂欄篩選項或排序 chip 的版面 | 頂欄一行時篩選條件變動會把篩選項 FLIP 到新位置（`TopBar` 的 pre / post watcher，比右緣；一行 / 兩列切換與縮放不做；`measureFit` 扣掉補間中的位移再量）；日期膠囊與「～」用 `fade` 淡入淡出，離場中的由 `freezeLeave` 釘成 absolute（不佔版面、不算進 `measureFit` 與位移補間，一行 / 兩列切換時直接藏起來）；排序 chip 是 `TransitionGroup` ＋ `.sort-chip-slot > .sort-chip-clip` 原地橫向展開 / 收起，父層要提供 `--sorts-gap`；離場中的 chip 還在 DOM，測試讀 chip 要用會重試的寫法（`expect.poll`） |
| 改總覽頂欄的篩選項、下拉或排序 chip | 下拉（`OvDropdown`）與排序選單用 `base.css` 的 `pop`；下拉一律右緣對齊（總覽頂欄在所有寬度都靠右排，觸發鈕變寬 / 變窄是左緣在動）；排序選單以 `.sort-bar` 為定位基準、打開當下量好位置（`--menu-x` / `--menu-r` / `--menu-y`），開著期間不跟著排序鈕；篩選條件變動時 `OverviewTopBar` 把篩選項 FLIP 到新位置（pre / post watcher，比右緣）；排序 chip 與成員觸發鈕的頭像、「…」、人數是 `.ov-slot > .ov-slot-clip` 原地橫向展開 / 收起（`ov-chip` / `ov-av`，離場的留在版面流裡、不釘位），右邊界用 `--ov-slot-mr`（平常，例：頭像重疊 -7px）/ `--ov-slot-mr0`（寬度 0 時，抵掉父層 flex gap）設，不要直接寫 `margin-right`（會蓋掉進出場的值）；成員面板「清除勾選」那列是 `ov-fold` 原地長出 / 收起；平板直向新 chip 進場時 `.sorts` 逐幀捲到看得到它。守衛在 `e2e/ov-chrome-motion.spec.ts` |
| 改切頁過渡或頁面的載入流程 | 切頁淡入淡出是 `assets/base.css` 的 `page-view-*`（transition，淡入途中切走會從當下的透明度往回淡出；頁面根元素 `.dash` / `.ov` 不寫 opacity / transition / animation，會蓋掉它）；`router/pageSwap.ts` 等新頁插入（`@enter`）才還原捲動，新頁插入當下要已經是最終高度。掛載成本（K1）：從別頁切進 Dashboard、又不還原到非 0 的捲動位置時（`isPageSwapping()` 且非 `swapRestoresScroll()`），首屏外的看板與 Issue 面板延後掛（`composables/useDeferredPanels.ts`）：等切頁淡入真的全亮（`onPageSettled` 之後再看根元素透明度，after-enter 可能靠 Vue 的保險計時器提早到）、瀏覽器空閒才一個一個掛；使用者先動手（滾輪、按下、按鍵、觸控，不含 scroll）立刻掛；首屏看得到的（甘特下緣在視窗內）掛載當下同步掛；直接開頁 / 重新整理不延後。要捲到看板 / Issue 的程式（例：頂欄捷徑）先 `await useDeferredPanels().ensure()` 再量。甘特第一次捲到今天在掛載當下（資料已到）或任務到齊時，不再等 60ms——淡入期間不能有 App 的長任務。載入：`router/index.ts` 的 `beforeEach` 在 path 變或初始導航時呼叫 `preloadProject` / `preloadPortfolio`，頁面掛載時 boot 的 `reload()` 取走沿用——**同一次進頁只打一次 load**（`failNext` 類測試只擋一發，靠這個維持語意）；已經 ready 時背景重載、連不上（`network`）不蓋掉內容（其他失敗清掉資料切成錯誤，見〈還沒做的〉authn 那段）；`router/index.ts` 的登入守衛排在先載守衛前面，只在第一次導航多等一發 `getSession`。守衛 `e2e/page-motion.spec.ts`（K1 淡入中間值 ≥ 3 幀，前提檢查只對外部慢幀重來）、`e2e/deferred-panels.spec.ts`、`e2e/load-motion.spec.ts` |
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
- 總覽的排序選單往右開會超出視窗時（直向時排序鈕在標題列右半），改成對齊按鈕右緣往左開（`OvSortControls` 的 `alignEnd`）。直向時 chips 放不下會在 `.sorts` 裡左右滑：新加的一層排序進場期間，`.sorts` 逐幀捲到看得到它（`revealChip`）。
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
| `src/api/__tests__/openapi-schema.spec.ts` | `src/api/http/schema.ts` 是由 `openapi.json` 產生的最新版（見〈型別從後端產生（OpenAPI）〉） |
| `src/composables/__tests__/useSession.spec.ts` | 登出重置（`resetSession()`）之後，`src/stores/` 底下每個 store（時鐘層除外）都等於全新 pinia 的初始狀態：新增的 store 或欄位沒跟著重置就紅 |
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
- 全部 e2e 的時鐘固定在 `2026-09-18T10:00:00`（`e2e/helpers/clock.ts` 的 `setFixedTime(page)`），否則「已延遲」「今天」這類跟當下時間有關的斷言會隨日期改變。副作用：Vue 用 `Date.now()` 判斷事件是不是在 listener 掛上之前發生的，時鐘凍住時，同一個事件傳遞路徑上的第二個 Vue listener 會被略過（例：同一元素另掛 `@pointerdown.capture`）。同一個事件要做兩件事就合成一個 handler（`OverviewTimeline` 的 `onBodyPointerDown`）。
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
│   │   ├── authEvents.ts  登入失效（401）的通知：api 實作 notifyUnauthorized()，main.ts 用 onUnauthorized 接了導到登入頁
│   │   ├── mock/          記憶體實作（store.ts + index.ts）；可注入延遲與失敗、換登入狀態；portfolio.ts 是總覽摘要的彙整
│   │   ├── http/          由後端產生的 openapi.json 與 schema.ts（產生檔，見〈型別從後端產生（OpenAPI）〉）
│   │   └── index.ts       挑實作的唯一出口（VITE_API 未設或 'mock' 用 mock；dev build 掛 window.__mockApi）
│   ├── assets/            tokens.css（設計 token）、base.css（全域樣式、keyframes、Dashboard 浮層共用的 pop / dialog / fade 過渡）、overview-motion.css（總覽的過渡 class；泳道 / 群組 / 列原地收合）
│   ├── components/        元件，依畫面區塊分子目錄（common / layout / summary / gantt / kanban / issues / detail / dialogs / overview）
│   ├── composables/       可重用的組合式函式
│   │   ├── useProjectBoot.ts    啟動層：注入 error sink、載入狀態（第一次載入中、之後背景重載；換專案先清空）、訂閱事件；preloadProject 給 router 切頁先載
│   │   ├── usePortfolioBoot.ts  總覽的啟動層：第一次顯示載入中，之後背景重載不閃；preloadPortfolio 給 router 切頁先載
│   │   ├── useSession.ts        登入：resetSession（登出 / 401 後整個前端回到剛開網頁的樣子，登入頁掛上時呼叫）、expireSession（401 導到登入頁）、登出動作
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
│   │                            heightTween（容器高度雙向補間：holdHeight 撐住、releaseHeight 每幀追自然高度，量的時候以 html 的 min-height 撐住頁高）/
│   │                            useCollapseReenter（原地收合清單：同 key 離場中又回來、進場中被換順序時從當下高度 / 透明度接續；startLeaveNow 讓離場當幀開始收）/
│   │                            useFreezeReenter（釘位離場清單：同 key 離場中又回來時從舊元素當下的位置 / 透明度 / 縮放接續）/
│   │                            useDeferredPanels（Dashboard 首屏外的看板 / Issue 延後掛：淡入跑完＋空閒才掛，先動手或捷徑 ensure() 立刻掛）
│   ├── constants/         畫面用常數（dashboard.ts：狀態 / 優先度 / 等級的標籤與顏色；overview.ts：總覽的排序鍵、標籤、尺寸；api.ts：API_ERROR_TEXT）
│   ├── lib/               純函式（日期、月曆格、排程連動、篩選、排序、格式化、id、CSS 時長 / 曲線 token 轉 JS（easing.ts）、元素目前的 translate（transform.ts）、程式平滑捲動的時長與曲線（scrollTween.ts，甘特與總覽時間軸共用）、啟動時預載晚出現符號的字型子集（fontPreload.ts：甘特收合鈕的 ▶，免得第一次收合才下載、整頁重排）、登入後回原頁的網址檢查（redirect.ts：只接受站內路徑）…）
│   ├── mocks/             範例資料
│   ├── router/            路由（index.ts：登入守衛、切頁時先載目標頁資料；pageSwap.ts：切頁過渡結束後才還原捲動位置）
│   ├── stores/            Pinia store（三層，見下）
│   │   ├── clock.ts                           時鐘層
│   │   ├── task / issue / comment / member / budget / project.ts   資料層（單一專案；project 是專案本身與 canEdit）
│   │   ├── portfolio.ts                       資料層（總覽的專案摘要與成員名錄）
│   │   ├── session.ts                         資料層（登入者；給登入守衛與畫面顯示用，不做授權）
│   │   ├── _optimistic.ts                     樂觀更新的共用機制（tracker / runOptimistic / error sink）
│   │   ├── _sync.ts                           api.subscribe 的唯一訂閱點，把事件路由到各資料 store
│   │   ├── rows / filter / selection / ui.ts  派生層（Dashboard）
│   │   └── overview.ts                        派生層（總覽）
│   ├── types/             資料模型型別（models.ts）與畫面層共用型別（ui.ts：LoadState）
│   ├── views/             頁面（總覽、Dashboard、登入）
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
| 幾何 | 甘特列、甘特條、看板卡、看板欄、Issue 卡、浮層、表單控制項的 boundingBox，加上甘特左欄寬、畫布尺寸與整頁高度；看板欄的 y 與整頁高從摘要列底部量起（頂欄與摘要列的高度新舊刻意不同）；容許 ±1px |

選擇器只用 [DOM 鉤子](#dom-鉤子)表裡標「legacy 也有」的屬性與畫面上的文字。唯一例外是量頂欄高度：新頁用 `.top-bar`，legacy 用第一個 sticky、`top:0` 的列；找到的元素不含成員篩選的 `[data-dd]` 就直接失敗，不會默默當 0。浮層（選單、對話框、詳細視窗）新舊沒有共同的選擇器，測試改用「computed style 的 `position` 是 `fixed`」這個兩頁都成立的特徵，臨時打上 `data-e2e-float` 再操作——標記只加在 DOM 上、兩頁一視同仁，不影響行為。

### 刻意保留的差異

這幾項新舊**本來就不該一樣**，對照測試已排除或反向斷言：

- **從詳細視窗刪任務**：legacy 的 `detail` 還指向已刪 id，視窗不會消失且 `body` 捲動被鎖死（`Dashboard.html:1761`）。新頁 `removeTask` 會清掉 `ui.detail`，走正常關閉動畫。對照測試反向斷言「legacy 有這個 bug、新頁沒有」。
- **檔案多選跨任務殘留**：legacy 的 `fileSel` 不會在換任務時清掉（`:3901`），計數會沿用上一個任務。新頁在 `openDetail` 時清空。
- **附件同日的相對順序**：`filesForTarget` 對同一天的附件沒有定義先後，兩邊可能不同，對照不比這個。
- **重排節流的時間來源**：legacy 用 `Date.now()`，被 e2e 的 `page.clock.setFixedTime` 凍住之後，一次拖曳裡除了第一次以外的 `dragTick` 全部被節流擋掉；新頁用 `performance.now()`，不受固定時鐘影響。這是測試環境造成的差異，不是行為差異——對照測試的重排只送一次 `mousemove`，比第一次落點。
- **理論進度的判準**：legacy 把「今天到期」的任務算進理論進度（`end <= 今天`，`Dashboard.html:3604-3620`）。新頁要到期日**隔天**才算（`end < 今天`），和總覽的 `taskPlanned`、「已延遲」的 `isLate` 同一個定義（都呼叫 `lib/schedule.ts` 的 `isPlannedDone`，改規則只改那裡），兩頁同一個專案的理論 % 才會一致（user 決定）。對照測試只遮掉摘要卡的差距標籤、理論的 N / 總數與理論 %（`e2e/helpers/compare.ts` 的 `maskPlan`），其餘照比。
- **甘特列的快捷鈕**：legacy 滑鼠移到任務列上會撐開「▲ ▼ ⇄ ✕」並省掉日期的年份；新頁改成列尾一直顯示的「⋮」，動作收在它開的選單（user 決定：只想標記任務時快捷鈕很干擾，▲ ▼ 也看不出是工期 ±1 天）。對照測試比文字時兩邊都拿掉列尾動作字與年份（`e2e/helpers/compare.ts` 的 `maskActs`），情境 8 的相依 / 刪除各走各的路（`compare.spec.ts` 的 `rowAction`）；點任務列的位置改在名稱區 x=70（`ROW_NAME_POS`）。
- **頂欄放不下時改兩列**：篩選器在標題與右端之間一行放不下時（預設篩選約 1470px 以下；啟用日期範圍、專案名稱較長時門檻更高），新頁把篩選器整排移到滿寬的第二列、靠左排，標籤和它的下拉一定在同一行（`TopBar` 的 `measureFit` 量實際寬度切 `.stacked`）。legacy 是篩選器擠在中間自己換成兩行，標籤和下拉會被拆開（user 回報 15.6 吋筆電常見的 1200～1470px 排版怪異）。兩邊頂欄高度因此不同（1440 時差 2px），對照測試的看板欄 y 與整頁高改從摘要列底部量起（`e2e/helpers/compare.ts` 的 `geoSnapshot`；摘要列的高度也不同，見下方〈摘要卡的版面〉），摘要列以下的幾何照樣 ±1px。兩列時日期日曆也不同：legacy 一律對齊篩選器右緣，篩選器滿寬時會離日期膠囊很遠；新頁改以日期那一組為基準、左緣對齊「日期」（user 決定），日曆在 DOM 裡也移進日期那一組（legacy 在「清除篩選」之後）。對照測試都在日曆關上之後才擷取，不受影響。
- **頂欄與面板的浮層**：legacy 的篩選下拉、成員面板、日期日曆、排序選單關閉時瞬間消失，新頁有離場淡出（批次 D 的 `pop`）；legacy 的日曆遮罩被 `.top-bar` 的 transform 限制成只蓋頂欄，會吃掉頂欄其他控制項的第一下點擊，新頁拿掉遮罩、點外面照常關（點擊照常送達），點另一顆日期膠囊只切換要填的端點、日曆不關；頂欄一行時下拉與成員面板右緣對齊往左展開（legacy 一律 `left: 0`，勾選讓觸發鈕變寬時選單跟著移）；排序選單開著時固定在打開時的位置（legacy 跟著觸發鈕跑）；一行時篩選項變寬整排平滑滑動、排序 chip 原地展開收起（legacy 一幀跳）。對照測試在 settle 之後才擷取，`[data-dd]` 序列不變。
- **錯誤條的出現與關閉**：legacy 出現時整頁一幀被推下約 40px、關閉一幀收回；新頁原地展開 / 收起並淡入淡出（`ErrorBar.vue`）。對照測試沒有讓錯誤條出現的情境，不受影響。
- **成員拖曳指派**：legacy 可以把成員篩選面板的列拖到甘特條或任務卡上指派，新頁移除了這個功能（user 決定；平板無法可靠支援原生拖放），指派一律在詳細視窗的「＋指派」。對照測試不比這個。
- **相依編輯器的位置**：legacy 一直垂直置中，增刪前置 / 後續任務時上下兩端一起跳；新頁打開時置中、之後上緣固定，只往下長（user 決定）。對照測試只比寬高，不受影響。
- **摘要卡的版面**：legacy 是四張卡（專案總時長、整體進度、任務狀態、Issue 統計）；新頁把「專案總時長」併進「整體進度」同一張卡的上段（user 決定），另外多一張 legacy 沒有的「預算 vs. 支出」。卡內文字順序和 legacy 相同，所以 `e2e/helpers/compare.ts` 取摘要卡文字時只排除 `summary-budget`，其餘照比。預算卡讓摘要列比 legacy 高，幾何的頁面座標（看板欄 y、整頁高）從摘要列底部量起（新頁是 `summary-progress` 卡的父層、legacy 是「專案總時長」那張卡的父層）。
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
| 資料層 | `task.ts`、`issue.ts`、`comment.ts`、`member.ts`、`budget.ts`、`project.ts`（＋共用的 `_optimistic.ts`、`_sync.ts`）；總覽的 `portfolio.ts`；登入者 `session.ts` | 專案資料的唯一擁有者；所有寫入都經 `@/api` | `@/api/*`、`@/lib/*`、`@/types/*`、`@/stores/clock`、其他資料 store、`_optimistic` / `_sync` |
| 派生層 | `rows.ts`、`filter.ts`、`selection.ts`、`ui.ts`；總覽的 `overview.ts` | 從資料層算出畫面要的東西（可見列、篩選、選取、浮層 / 錯誤條 / 收合） | 所有層 |

成員名錄有兩份：`portfolio.members`（總覽，含各專案的 PM）與 `member.members`（Dashboard，單一專案的成員）。總覽元件查成員一律用 `portfolio.byId`。指派類的下拉（＋指派、Issue 提出人與負責人）只列沒停用的人，用 `member.assignable(原本選的 id)`；頂欄成員篩選只列這個專案有被指派任務的人（`lib/filter.ts` 的 `filterableMembers`）。

`project.ts` 存專案本身（`meta`：id / 名稱 / 擁有者）與 `canEdit`（後端算的「登入者能不能改」，前端不自己比對 `pmId`）。`taskStore.load(id)` 一次灌進所有資料 store，`taskStore.reset()` 一次清掉（換專案時由 `useProjectBoot` 呼叫，再清選取、篩選與暫態）。

`session.ts` 存登入者（`info`：成員 id / 姓名 / 角色）與「問過後端了沒」（`checked`），只給登入守衛導頁與畫面顯示用；權限一律由後端判斷。

離開頁面時，兩邊的狀態處理方式不同：
- `overview` store 會保留：從 Dashboard 回到總覽時，篩選、排序、展開與檢視都還在。
- Dashboard 卸載時，`ui.resetTransient()` 會清掉詳細視窗與浮層這類暫態，回來時不會自己打開。
- 進的是另一個專案時，資料層、選取、篩選條件也一起清掉；排序、面板收合、縮放這些版面偏好留著。
- 登出或登入失效（到了登入頁）時，`composables/useSession.ts` 的 `resetSession()` 把**所有** store（時鐘層除外）連同版面偏好都清回初始值，兩個 boot 模組的模組層狀態也歸零：下一位使用者進頁時是「載入中」，不是背景重載，看不到上一位的資料。

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
| `data-testid` | 摘要卡 `summary-progress`（含專案總時長） / `summary-tasks` / `summary-issues` / `summary-budget`；頂部 `filter-clear` / `only-filtered`；面板標題 `task-count` / `issue-count`；甘特左欄的展開鈕 `gantt-left-toggle`（只在 < 900px 出現） | 固定字串 | ✗ |

總覽頁的屬性。legacy 沒有這一頁，所以下表全部都不能用在新舊對照測試：

| 屬性 | 掛在 | 值 |
|---|---|---|
| `data-view` | 總覽頁根元素 | `overview` |
| `data-view-panel` | 兩種檢視的面板外殼（`OvPanel`） | `cards` / `timeline` |
| `data-view-switch` | 頂欄的檢視切換鈕（帶 `aria-pressed`） | `cards` / `timeline` |
| `data-project` | 專案卡；時間軸的 `.p-block`（同時包住 `.p-row` 與 `.qv`） | projectId |
| `data-drawer` | 卡片檢視的速覽抽屜（每條泳道一個，是卡片的兄弟元素，插在展開那張卡所在列下方；`id` 是 `lane-qv-<成員 id>`，對應卡片的 `aria-controls`） | 正在顯示的 projectId（沒展開時沒有這個屬性） |
| `data-pm-col` | 卡片檢視的 PM 泳道 | 成員 id |
| `data-lane-wrap` | 卡片檢視 PM 泳道的外層 `.lane-wrap`：原地收合與重排的單位，`useCollapseReenter` 以它對應新舊元素；`data-pm-col` 仍在裡面的泳道本體 | 成員 id |
| `data-pm-group` | 時間軸的 PM 群組列 `.g-row` | 成員 id |
| `data-g-wrap` | 時間軸 PM 群組的外層 `.g-wrap`：原地收合與重排的單位（同 `data-lane-wrap`）；`data-pm-group` 仍在裡面的 `.g-row` | 成員 id |
| `data-row-wrap` | 時間軸專案列的外層 `.r-wrap`：原地收合與重排的單位（`useRelativeFlip` 也以它對應）；`data-project` 仍在裡面的 `.p-block` | projectId |
| `data-pm-option` | 成員篩選面板的一列（帶 `aria-pressed`） | 成員 id |
| `data-ov-dd` | 總覽頂欄的下拉根元素（見表下說明） | `pm` / `status` / `alert` |
| `data-testid` | 面板計數 `overview-count`、搜尋框 `overview-search`、清除篩選 `overview-clear`、空狀態 `overview-empty`、時間軸「今天」`overview-today`、登入者選單的觸發鈕 `user-menu` | 固定字串 |

`data-ov-dd` 刻意和 Dashboard 的 `data-dd` 分開：它不在 `useClickOutside` 的保留清單裡，總覽的浮層改由 `useDismiss` 關閉。

登入頁的屬性（legacy 沒有這一頁）：

| 屬性 | 掛在 | 值 |
|---|---|---|
| `data-view` | 登入頁根元素 | `login` |
| `data-testid` | 登入失敗的訊息 `login-error`（同一元素帶 `role="alert"`） | 固定字串 |

帳號、密碼輸入框與「登入」鈕用 label 與按鈕文字找（`getByLabel('帳號')`、`getByRole('button', { name: '登入' })`），不另外加屬性。

總覽 e2e 還依賴下表這些 class，**改名時要同步改測試**。用到的檔是 `e2e/overview.spec.ts`、`e2e/overview-motion.spec.ts`、`e2e/overview-tablet.spec.ts`、`e2e/page-motion.spec.ts`、`e2e/ov-*.spec.ts`（逐幀量測）、`e2e/helpers/overviewPage.ts`、`e2e/helpers/ovMotion.ts`：

| 用途 | class |
|---|---|
| 頁面根元素 | `.dash`（Dashboard；`page-motion.spec` 量它的透明度） |
| 頂欄與下拉 | `.dd-trigger` `.dd-menu` `.dd-item` `.alert-dot` `.search`；成員篩選 `.mp-stack` `.avatar` `.mp-more` `.mp-count` `.mp-sub` `.mp-btn` |
| 排序 | `.sort-trigger` `.sort-menu` `.sort-chip` `.chip-label` `.chip-x` `.chip-arrow` `.sorts` `.sort-option` `.sort-clear` |
| 面板 | `.panel-head` `.panel-title` `.panel-toggle` `.panel-body` `.panel-caret` |
| 卡片 | `.lane-head` `.card-main` `.card-name` `.card-caret` `.hero` `.pa-bar` `.fill` `.enter-edge` `.qb-title` `.pm-count` `.board` `.lane-body`；速覽抽屜 `.drawer` `.drawer-box` `.drawer-content` `.enter-head` |
| 時間軸 | `.tl-body` `.tl-left-head` `.today-tag` `.p-row` `.p-left` `.p-name` `.c-pct` `.c-gap` `.pct-plan` `.bar` `.bar-label` `.g-caret` `.g-sum` `.qv` `.qv-head` `.tl` `.tl-ruler` `.tl-hbar` `.tl-groups` `.g-list` `.quick-wrap` `.qv-box` `.quick-view` |
| 原地收合的外層 / 裁切層 | `.lane-wrap` `.lane-clip`（卡片）、`.g-wrap` `.g-wrap-clip` `.r-wrap` `.r-clip`（時間軸）、`.ov-slot` `.ov-slot-clip`（排序 chip、成員頭像疊）。e2e 不寫這幾個 class 名，改用屬性與層級找：`.board > *`、`.tl-groups > *`、`.g-list > *`、`.sorts > *`、`.mp-stack > *` 是外層，`.g-list > * > *` 是列的裁切層（平常不裁、收合中才 `overflow: clip`）；chip / 頭像的淡入淡出寫在外層，量透明度要量外層（或用含祖先的透明度）；多包或少包一層都要同步改測試 |
| 過渡（Vue 自動加上的 class） | `ov-fade-*` `ov-view-*` `ov-card-*` `ov-col-*` `ov-group-*` `ov-row-*` `ov-fold-*` `ov-chip-*` `ov-av-*`（定義在 `assets/overview-motion.css`）。`ov-col-*` / `ov-group-*` / `ov-row-*` / `ov-fold-*` 是原地收合：外層 `grid-template-rows` 0fr ↔ 1fr ＋ 透明度；`ov-chip-*` / `ov-av-*` 是橫向的原地收合：外層 `grid-template-columns` 0fr ↔ 1fr ＋ 右邊界 ＋ 透明度；外層 / 裁切層結構見 `overview-motion.css` 的註解；`ov-view-*` 是 transition（不是 keyframes，淡入中切回會從當下反向）；同檔另以 `:where()` 給 `.sorts > *` `.board > *` `.tl-groups > *` 寫 `transition: none` 當基礎（內建 move 被中斷時才停得住，理由見該檔註解）；總覽的下拉與排序選單用 `base.css` 的 `pop-*`；切頁的 `page-view-*`（定義在 `assets/base.css`）；時間軸連接框 `.qv-cap`；Dashboard 浮層的 `pop-*`（選單、日期選擇器）`dialog-*`（相依編輯器、確認框）`fade-*`（Lightbox）定義在 `assets/base.css`，詳情視窗的 `detail-fade-*` `detail-pop-*` 在 `DetailModal.vue` |

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
   | `ProjectData.currentUserId`、`PortfolioData.currentUserId` | 必填字串 | 登入者的成員 id（同 `getSession()` 的 `memberId`） | 後端填；只是顯示用（留言掛誰、頭像），不是身分 |
   | `ProjectData.project`、`ProjectData.canEdit` | `{ id, name, pmId }`、`boolean` | `canEdit` = 登入者是不是這個專案的 PM | 後端算；前端不自己拿 `pmId` 比對登入者（權限規則只留在後端一處） |
   | `Member.active` | `boolean`（沒停用） | 後端的停用旗標 | 後端；指派類下拉只列 `active`，原本就指派給停用者的照樣顯示 |
   | `ProjectData.budget` | `{ total, actual }`（數字，只讀；剩餘與使用率由 `lib/budget.ts` 算） | 後端的預算欄位 | adapter 填進 `loadProject(id)` 與 `project.reloaded` 的 payload；目前沒有寫入端點 |
   | `ProjectSummary.taskPlanned` | 「照排程今天之前就該完成」的任務數 | 後端依伺服器當日算 | 後端；前端只拿它算理論 %，跨日差一天可接受 |
   | `Member.color` | 合法的 CSS 顏色值（例 `#2563eb`），經 `:style` 寫進 CSS 變數 | 後端存的顏色字串 | adapter 驗格式；前端沒有用字串拼接組 CSS，但格式錯會讓頭像與 PM 泳道沒有顏色 |
   | `ProjectSummary.upcoming` | 最多 3 筆、依到期日升冪、含已逾期 | 後端篩選排序 | 後端；前端原樣顯示 |
   | `ProjectSummary` 的不變式 | `taskDone === taskCounts.done`、`taskTotal === taskCounts` 加總 | — | adapter 驗；實際 / 理論 %、落後百分點、需注意由前端 `lib/portfolio.ts` 算，**後端不給** |
   | `Attachment.id` | `'<commentId>:<index>'`（`downloadAttachment` 的鍵） | 後端自己的附件主鍵 | adapter；只要 `loadProject` 與 `createComment` 回的 id 能餵回 `downloadAttachment` 就行 |

4. **跑測試**：`npm run test:unit -- --run` 全綠、`PLAYWRIGHT_PORT=5174 npm run test:e2e` 全綠（靠 mock 的兩條會自動跳過，見下）。

### 端點對照表

路徑是建議值；後端不同就在 adapter 對應，**介面的參數 / 回傳 / 錯誤碼才是契約**。都不分頁：`loadProject(id)` 回單一專案整包，`listProjects()` 回所有專案的摘要。彙整規則（含專案狀態依任務算的 `status`）寫在 `src/api/types.ts` 檔頭，參考實作是 `src/api/mock/portfolio.ts` 的 `summarizeProject()` / `projectStatusOf()`。

帶專案 id 的只有四支：`createGroup`（分類沒有上層實體可以反查專案）、`reorderTasks` / `reorderGroups`（整份順序是專案層級的）與 `subscribe`（事件分專案）。其他建立 / 修改 / 刪除由後端從實體反查專案（任務看 `groupId`、Issue 看 `taskId`、留言看 `targetId`）。

| 方法 | HTTP | 路徑 | request | response |
|---|---|---|---|---|
| `getSession()` | GET | `/api/auth/me` | — | `SessionInfo`（`{ memberId, name, role }`，`role` 是部門）；401 = 沒登入，adapter 回 `null` |
| `login(account, password)` | POST | `/api/auth/login` | `{ account, password }`（網域帳號，例 `chen_daming`） | 200 `SessionInfo` ＋ Set-Cookie；失敗由 adapter 轉成 `{ ok: false, reason }`（見表下〈登入〉） |
| `logout()` | POST | `/api/auth/logout` | — | 204、清 cookie（沒登入也是 204） |
| `loadProject(id)` | GET | `/api/projects/:id` | — | `ProjectData`（整包，含 `project` 與 `canEdit`；`tasks` / `groups` 的陣列順序就是顯示順序） |
| `listProjects()` | GET | `/api/projects` | — | `PortfolioData`（所有專案的 `ProjectSummary` ＋ 成員名錄 ＋ `currentUserId`；`projects` 順序無意義，`members` 順序就是顯示順序） |
| `createTask()` | POST | `/api/tasks` | `Task`（含 client 產的 `id`） | `Task` |
| `updateTask()` | PATCH | `/api/tasks/:id` | `Partial<Task>`（JSON merge patch） | `Task` |
| `updateTasks()` | PATCH | `/api/tasks` | `Task[]`（**語意是整批 PUT**：body 是整筆 `Task[]`，不是 patch；已含 cascade 後的下游） | `Task[]`（server 最終狀態，client 直接套回） |
| `deleteTask()` | DELETE | `/api/tasks/:id` | — | — |
| `reorderTasks(projectId, order)` | PUT | `/api/projects/:pid/tasks/order` | `{ id, groupId }[]`（這個專案整份的順序） | — |
| `createGroup(projectId, g)` | POST | `/api/projects/:pid/groups` | `Group` | `Group` |
| `updateGroup()` | PATCH | `/api/groups/:id` | `Partial<Group>` | `Group` |
| `deleteGroup()` | DELETE | `/api/groups/:id` | — | — |
| `reorderGroups(projectId, ids)` | PUT | `/api/projects/:pid/groups/order` | `string[]`（這個專案分類 id 的完整順序） | — |
| `createDep()` | POST | `/api/deps` | `Dependency` | `Dependency` |
| `deleteDep()` | DELETE | `/api/deps/:id` | — | — |
| `createIssue()` | POST | `/api/issues` | `Issue` | `Issue` |
| `updateIssue()` | PATCH | `/api/issues/:id` | `Partial<Issue>` | `Issue` |
| `deleteIssue()` | DELETE | `/api/issues/:id` | — | — |
| `createComment()` | POST | `/api/comments` | multipart：comment 的 JSON part + `files[]` | `Comment`（`files[].url` 換成 server url） |
| `deleteComment()` | DELETE | `/api/comments/:id` | — | — |
| `downloadAttachment()` | GET | `/api/attachments/:id` | — | `Blob`（檔案本身） |
| `subscribe(projectId, handler)` | — | `/api/projects/:pid/events`（SSE）或 WS 或 polling | — | 這個專案的 `ProjectEvent` 串流；回傳解訂函式 |

後端要注意的四件事：

- **id 由 client 產**（UUID v4，`src/lib/id.ts` 的 `newId()`：`crypto.randomUUID?.()`，非 https / 非 localhost 沒有這支時退回 `crypto.getRandomValues` 自己組）。主鍵接受 client 給的 id，重複回 **409**。
- **後端不跑 cascade**。相依連動（`start` / `end` 改動推下游、`status=done` 填 `done` 日）前端已經算完，`updateTasks` 送的是整段結果。後端只存，response 回最終狀態（要糾正就在 response 糾正，client 會套回）。
- **連動刪除由後端做**：`deleteTask` 連帶刪它的 issue / dep / comment，`deleteGroup` 連帶刪底下的任務（以及那些任務的 issue / dep / comment），`deleteIssue` 連帶刪它的留言。事件順序見下。
- **事件與 response 的到達順序後端不必保證**。client 兩種順序都正確（機制見〈樂觀更新怎麼運作〉的 in-flight 規則）：事件先到就只更新「最後已知的 server 狀態」，等該 id 的請求全部結束才對齊本地。不要為了排順序而延後廣播或延後回應。

登入（表上前三支）：

- session 放在 HttpOnly cookie，前端碰不到 token；每一支資料端點由後端自己驗 session 與權限。
- `login()` 的失敗是預期結果，**不拋錯**，adapter 依狀態碼轉成 `{ ok: false, reason }`：401 → `invalid`（帳號或密碼錯，不分哪個錯）、403 → `forbidden`（不在 PMIS 的可登入名單）、429 → `locked`（失敗太多次，暫時擋下）、503 → `unavailable`（AD 驗證服務連不上）；其他照一般錯誤拋 `ApiError`。登入頁的文案在 `constants/api.ts` 的 `LOGIN_FAIL_TEXT`。
- **其他每一支遇到 401**：adapter 先呼叫 `notifyUnauthorized()`（`src/api/authEvents.ts`）再拋 `ApiError('unauthorized')`。`main.ts` 收到通知就導到登入頁、登入後回原頁；`getSession` / `login` / `logout` 自己的 401 不通知。mock 照同一套規矩做（`setSession(null)` 之後的下一發）。

### 錯誤碼對照表

api 層只往外拋 `ApiError`（`code` / `message` / `status` / `method`）。`code` 決定畫面文案，`message`（server 原文）只進 console，不上畫面。

| `ApiError.code` | HTTP status | 錯誤條文案 |
|---|---|---|
| `network` | fetch 直接拋錯 / 沒有回應 | 連線失敗 |
| `validation` | 400、413、415、422 | 資料不合法 |
| `unauthorized` | 401 | 登入已失效 |
| `forbidden` | 403 | 沒有權限 |
| `not_found` | 404 | 資料已不存在 |
| `conflict` | 409 | 與伺服器狀態衝突 |
| `unknown` | 其他 | 發生錯誤 |

`unauthorized` 另外會導到登入頁（見〈端點對照表〉表下的〈登入〉），畫面多半來不及顯示這句。

對照表在 `src/constants/api.ts`（`API_ERROR_TEXT` / `apiErrorCode()`，Dashboard 與總覽共用）。錯誤條 `ErrorBar` 顯示的是「操作名稱（`label`，例如『更新任務』）＋ 上表文案」，同 label 會合併成 `×N`，最多留 5 筆、畫面顯示 3 筆，不自動關閉。

「同 label 合併」的視窗是 **`clock` 的 60 秒 tick**，不是牆鐘 5 秒：`ui.pushError` 的時間戳取 `clock.now`（每 60 秒才走一次），所以實際行為是「同一個 tick 內的同 label 合併成一筆」。刻意如此——連續失敗不該把錯誤條洗版。

### 事件

`subscribe(projectId, handler)` 是後端推變更的唯一入口，依專案訂閱（`Task` 這些實體裡沒有專案 id，分專案靠訂閱）。前端只有 `src/stores/_sync.ts` 的 `useProjectSync()` 訂閱它（`DashboardView` 掛載時經 `useProjectBoot` 呼叫 `start(專案 id)`、卸載時 `stop()`），再依 `type` 前綴路由到各資料 store 的 `applyEvent`。

總覽頁（`/`）**不訂閱事件**：進頁時 `listProjects()` 載入一次，之後每次回到總覽都在背景重載（畫面不切回載入中），所以在 Dashboard 做的改動回總覽就看得到。

三種實作都可以，介面不變：

| 做法 | 怎麼接 | 取捨 |
|---|---|---|
| polling | `setInterval` 打 `loadProject(id)`，跟上一份 diff 出事件；或後端給 `/api/projects/:pid/events?since=<cursor>` | 最好做、後端零長連線；延遲等於輪詢間隔，流量大 |
| SSE | `new EventSource('/api/projects/:pid/events')`，每則 `data` 是一個 `ProjectEvent`；`onerror` 時瀏覽器自動重連 | 單向推送、走一般 HTTP，最貼合這個介面 |
| WebSocket | `new WebSocket(...)`，訊息就是 `ProjectEvent` 的 JSON | 雙向、延遲最低；要自己做心跳與重連 |

不論哪一種，client 端的規則是固定的：

- **廣播含發起者**：自己改的東西也會收到自己的事件。不要為了省流量排除發起者——前端靠這則事件確認 server 的最終值。
- **同值 no-op**：同一個 id 收到跟本地一樣的值，不重繪也不算變更。
- **in-flight 期間只寫 `serverState`**：某個 id 還有請求在飛時，事件只更新「最後已知的 server 狀態」，不動本地；等該 id 的請求全部結束才對齊（硬規則見端點表下方第四點）。
- **順序不保證**，但連動刪除例外：被連帶刪掉的實體要**先**各發一則 `deleted`，主體自己的 `deleted` **最後**發（前端依這個順序清懸空 id）。
- **事件的 payload 也要走 adapter 轉換**：`ProjectEvent.payload` 就是 `Task` / `Issue` / `Comment` / `ProjectData` 本身，所以上表那份對照（`null ↔ ''`、日期格式、`Attachment.id`）在事件這條路徑上要**再做一次**。只轉 response 不轉事件，本地會被推來的 `null` 汙染成非法值。
- **`project.reloaded` 由 adapter 自己造，後端不用做**：重連偵測在前端這一層（`EventSource` 的 `onopen` 從**第二次**起、或 WebSocket 的 reconnect callback），adapter 自己 `await loadProject(id)` 之後 `emit({ type: 'project.reloaded', payload })`。後端只要能重新建立連線就好，不必記得補推什麼。
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

**每次進頁只打一次 load**：`failNext` 只擋下一發，切頁先載（`router` 的 `beforeEach`）與頁面掛載的 `reload()` 共用同一發，失敗與重試的測試才有意義；`load-motion.spec` 的次數守門守這一點（計的是 `loadProject` / `listProjects`，登入守衛第一次導航打的 `getSession` 不算）。

**登入狀態**：mock 預設已登入，`reset()` 也回到已登入。`setSession(null)` 等同 session 過期：之後除了登入相關三支，每一發都回 401 並觸發導回登入頁。要整頁從「沒登入」開始，得在 `__mockApi` 掛上的當下就 `setSession(null)`（登入守衛在第一次導航就會問 `getSession`，`page.evaluate` 來不及），寫法照 `e2e/login.spec.ts` 的 `addInitScript`。`login.spec` 一樣靠 `__mockApi`，接上真後端時跳過。

### 型別從後端產生（OpenAPI）

後端 wire 的型別不手寫，由後端程式產生，放在 `src/api/http/`（之後 http adapter `index.ts` 也放這裡，用這些型別對後端；`src/types/models.ts` 照舊是前端的模型，兩者的差異在 adapter 轉）：

| 檔案 | 怎麼產生 |
|---|---|
| `src/api/http/openapi.json` | 後端 `uv run python -m app.scripts.export_openapi` 匯出 |
| `src/api/http/schema.ts` | `npm run gen:api`（openapi-typescript）由上面那份產生 |

兩個都是產生檔、都進版控、**不手改**；不經 Prettier（`.prettierignore`），`schema.ts` 也不經 ESLint（`eslint.config.ts` 的忽略清單）。`openapi-typescript` 的版本釘死（跟 `prettier` 一樣，產出要跟 CI 一字不差）；它宣告只支援 TypeScript 5，專案是 6，所以 `package.json` 的 `overrides` 讓它改用專案的 TypeScript。升級它或 TypeScript 時重跑 `npm run gen:api`，`schema.ts` 有變就一起 commit。

**改了 API（後端的端點或 request / response model）要依序跑這兩個指令**，產物連同程式一起 commit：

```sh
# 在 backend/
uv run python -m app.scripts.export_openapi
# 在 frontend/
npm run gen:api
```

忘了跑會紅：後端的 `tests/test_openapi_snapshot.py` 比對程式與 `openapi.json`，前端的 `src/api/__tests__/openapi-schema.spec.ts` 由 `openapi.json` 重新產生一次、比對 `schema.ts`。遇到合併衝突不要手動合併，取任一邊後重跑兩個指令。細節見 [`backend/README.md` 的〈API 契約與前端型別〉](../backend/README.md#api-契約與前端型別)。

### 還沒做的（接後端時要補）

- **逾時與取消**：`ProjectApi` 目前沒有 `AbortSignal`，也沒有逾時。網路實作至少要給每個請求一個逾時（逾時 → `ApiError('network')`）；離開頁面或連續改動時要能取消前一發。
- **authn / authz**：前端的登入只管導頁與顯示，**每一支端點都要後端自己做認證與授權**（驗 session cookie、驗是不是該專案的 PM）。`ProjectData.currentUserId` 與 `session` store 的登入者都只是「留言掛誰、頭像顯示誰、要不要導到登入頁」的顯示用資料，client 改得動，**絕對不能拿它當身分**。已經做好的：
  - 登入頁（`/login`）與登入守衛：`router/index.ts` 的登入守衛排在先載守衛**前面**（守衛依註冊順序執行），沒登入的導航不會先打出需要認證的請求；只有第一次導航（或重置之後）問 `getSession()`，之後切頁不多等一發。
  - 401：api 層 `notifyUnauthorized()` → `main.ts` 導到登入頁（`?redirect=` 帶原路徑，登入後回去；`lib/redirect.ts` 只接受站內路徑）。
  - 登出 / 換使用者的重置：登入頁掛上時 `resetSession()`（`composables/useSession.ts`）把資料層、派生層、兩個 `loadState`、兩個 boot 模組的狀態全部清回初始值，還在飛的載入作廢，錯誤條的出口拿掉；下一位進頁是「載入中」，不會先看到上一位的資料。
  - 背景重載失敗分類（Dashboard 的 `useProjectBoot`、總覽的 `usePortfolioBoot`）：只有 `network` 維持舊資料；`unauthorized` 交給上面的 401 導頁；`forbidden`（撤權）、`not_found`（專案被刪）與其他錯誤清掉資料、切成錯誤畫面（可重試）。

  還沒做的：http adapter（F10）要照〈端點對照表〉表下〈登入〉的規矩做（401 先通知再拋、`login()` 的 401 / 403 / 429 / 503 轉成結果），mock 已經照做；登入頁「嘗試太多次」文案寫死「15 分鐘」，跟後端 `LOGIN_LOCK_MINUTES` 的預設值一致，改設定時要一起改 `constants/api.ts`。
- **PATCH body 要用 schema 白名單驗欄位**：`updateTask` / `updateGroup` / `updateIssue` 送的是 JSON merge patch，後端必須逐欄位比對允許清單再寫入，**不可以整包 merge 進實體**（mass-assignment；也要擋 `__proto__` / `constructor` / `prototype` 這類鍵造成的原型污染）。同理 `createTask` 這些帶完整實體的端點也要過一次 schema。
- **多人衝突**：現在是「後到的覆蓋先到的」，沒有版本號或 `If-Match`。同時編輯同一筆的情境沒有處理（spec 已排除）。附帶一提：`dirty`（本地改了還沒送出）只保護**本地**不被 reconcile 蓋掉，**不保護 server 端**——那段值還沒上 wire，別的 client 這段時間寫進去的東西，等它送出時一樣會被覆蓋。
- **附件上傳驗證**：`comment.addDraftFiles` 直接 `URL.createObjectURL`，沒有任何檢查。要補檔案大小上限、MIME 型別與副檔名白名單（三者都要，只擋副檔名擋不住偽裝的檔案），**伺服器端再驗一次**。
- **依 id 載入專案**：契約與資料流已經多專案化——`loadProject(id)`、`subscribe(projectId)`，`createGroup` / `reorderTasks` / `reorderGroups` 帶專案 id；路由的 id 經 `preloadProject` 與 `useProjectBoot(id)` 一路傳到 api；換專案時先清空資料層（`taskStore.reset()`）與選取、篩選、暫態，上一個專案晚回來的載入與寫入一律丟掉（單元測試守）。還沒做的：
  1. 總覽的 PMIS 摘要目前由 mock 從範例專案彙整，接上後改由後端的 `listProjects()` 提供。
  2. Dashboard 直接切到另一個 Dashboard（目前畫面上沒有這條路，一定經過總覽）時，先載會在舊頁淡出期間就清空資料、切成 loading，正在淡出的舊頁會閃一下「載入中」（例如等新頁掛上才切）。
- **切頁先載與背景重載的競賽**（mock 延遲為 0，現在不會發生）：
  - **事件空窗**：先載的快照在導航一開始就打，`subscribe` 要到 Dashboard 掛載（舊頁淡出之後）才開始，這段時間別人改的事件會漏接。接後端時把訂閱提前，或訂閱後比對版本再補一次 `project.reloaded`。
  - **整包覆蓋**：背景重載回來時使用者已經能操作，`applyProject` 會整包覆蓋本地，包括還沒送出（`dirty`）的改動，語意同 `project.reloaded`。延遲大的後端要考慮背景重載遇到 `dirty` / `inflight` 時延後套用。
  - **舊快照蓋回已完成的寫入**：Dashboard 背景重載的請求若在某次寫入之前被後端處理、卻在寫入的 response 之後才回來，`inflight` / `dirty` 都已清空，`applyProject` 會把那筆蓋回舊值（server 其實是新值）。整包資料帶版本或時間戳、比本地已確認的舊就丟掉，可以一併解決上一點。
  - **讀寫先後**：Dashboard 剛送出修改就切回總覽時，先載的 `listProjects()` 可能比那次修改先被後端處理，總覽短暫顯示舊值、下次載入才更新。
- **總覽的規模**：時間軸範圍涵蓋所有專案與今天，日刻度與底色格的 DOM 節點數跟天數成正比。專案變多、時間跨度拉長時，要考慮限縮範圍或做虛擬化。
- **重負載下換順序的泳道會鼓出一點**：同一次更新裡，合成器動畫（move 的 transform、opacity）的起跑時間要等合成器回報，主執行緒動畫（收合 / 長出的 grid-template-rows）在下一幀就定；機器很忙時兩者差一兩幀，換順序的泳道先鼓出約 30px 再回來。`ov-collapse.spec` 的 N2 以「同一幀起跑」為前提量測；要在重負載下也完全對齊，得把收合 / 長出改成指定 startTime 的 Web Animations。
- **總覽的篩選不寫進網址**：重新整理或分享連結時，篩選條件不會保留。
- **`prefers-reduced-motion`**：全專案都還沒支援。總覽的過渡集中在 `assets/overview-motion.css` 與各元件的 `transition`，要支援時從這裡下手。總覽另有 JS 驅動的過渡：`composables/motionTokens.ts` 在執行期讀 `--t-*` / `--ease`，`heightTween`（容器高度補間）、`useRelativeFlip` / `useFreezeReenter`（Web Animations 的重排位移與同 key 接續）與空狀態的延後（`showEmpty`）都經它取時長，token 設成 0 就直接放開、不播；程式平滑捲動（總覽時間軸的「今天」、甘特的 `useGanttScroll`）的時長來自 `lib/scrollTween.ts` 的固定公式（460–1150ms），不讀 token，要另外處理。Dashboard 的浮層在 `assets/base.css` 的「浮層進出場」段（pop / dialog / fade）與 `DetailModal.vue` 的 detail-fade / detail-pop；切頁的 `page-view-*` 在 `assets/base.css`，錯誤條的進出場與換行補間在 `ErrorBar.vue` 的 `tween()`（Web Animations，讀 `--t-panel`；CSS 的 reduced-motion 規則管不到，要在這裡判斷）。
- **CSP**：目前沒有 Content-Security-Policy；上線前在伺服器或 CDN 層補上，至少限制 `script-src` / `style-src` / `img-src`（`blob:` 要放行，附件預覽用得到）。
