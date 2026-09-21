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

## 目錄結構

```
legacy/            改寫前的原型（唯讀基準，見下）
public/            原樣複製到 dist/ 的靜態檔
src/
  api/             資料存取層；接後端時只換這一層
  assets/          tokens.css（設計 token）、base.css（全域樣式與 keyframes）
  components/      元件，依畫面區塊分子目錄
  composables/     可重用的組合式函式（拖曳、自動捲動、延遲卸載…）
  constants/       畫面用常數（狀態 / 優先度 / 等級的標籤與顏色）
  lib/             純函式（日期、排程連動、篩選、排序、格式化…）
  mocks/           範例資料
  router/          路由
  stores/          Pinia store
  types/           資料模型型別
  views/           頁面
e2e/               Playwright 測試與 helper
docs/reference/    長期參考文件
```

單元測試放在被測檔案旁的 `__tests__/`（例如 `src/lib/__tests__/date.spec.ts`）。

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
| 例子 | `dayIndex()`、`cascade()`、`matchTask()`、`applySort()`、`fmtDate()` | `useTaskStore()`、`useFilterStore()`、`useUiStore()` |
| 測試 | Vitest，直接呼叫、不需要 Pinia | Vitest + `setActivePinia(createPinia())` |

規則：**演算法寫在 `lib/`，store 只負責存狀態並把 `lib/` 的結果接起來。** 只有單一元件用得到的狀態（下拉的 hover 列、卡片 hover）留在元件內。

store 的欄位分兩類，寫法不同：

| | 誰可以寫 | 例子 |
|---|---|---|
| **UI 狀態欄位**：`ui` / `filter` / `comment` 裡描述畫面狀態的 `ref` | 元件可以直接寫 | `ui.editing = { kind: 't', id }`、`filter.issueMode = 'has'`、`comment.tab = 'files'` |
| **資料欄位**：`tasks` / `issues` / `deps` / `groups` / `comments` | 只經 action | `taskStore.updateTask()`、`issueStore.update()`、`commentStore.send()` |

分界在「有沒有連動」：資料欄位背後有 cascade 排程、刪除時的懸空 id 清理、選取連動，繞過 action 直接改陣列就會漏做這些；UI 狀態欄位沒有這層規則，走 action 只是多包一層。

## DOM 鉤子

畫面上這些屬性是給測試與 CSS 用的契約，改元件時要一起維護。標「legacy 也有」的可以用在新舊對照測試裡。

**「執行期使用」欄不是空話**：標了的屬性是程式碼本身的依賴——`usePointerDrag`、`useClickOutside`、`KanbanPanel`、`IssuePanel`、`TopBar` 會用 `document.querySelector` / `Element.closest` 去找它們。拔掉或改名會直接弄壞拖曳、自動捲動與點外面關浮層，不是只有測試變紅（review M9）。

| 屬性 | 掛在 | 值 | legacy 也有 | 執行期使用 |
|---|---|---|---|---|
| `data-rowtask` | 甘特左欄任務列 | taskId | ✓ | `usePointerDrag`（列重排量測、分類整塊範圍）、`useClickOutside` |
| `data-rowgroup` | 甘特左欄分類列 | groupId | ✓ | `usePointerDrag`（分類重排的 `blockRect`）、`useClickOutside` |
| `data-taskid` | 甘特條（收合分類的摘要條為 `sum-<groupId>`） | taskId | ✓ | `usePointerDrag`（放開時判斷相依落在哪條）、`useClickOutside` |
| `data-linkfor` | 甘特條兩側的連線圓點 | taskId | ✓ | `usePointerDrag`（放開時的第二順位命中目標） |
| `data-card` | 看板任務卡 | taskId | ✓（legacy 值固定為 `1`，對照時只比存在性） | `KanbanPanel`（選取後捲到卡片）、`useClickOutside` |
| `data-issuerow` | Issue 卡 | issueId | ✓ | `IssuePanel`（選取後捲到 Issue 列）、`useClickOutside` |
| `data-col` | 看板欄內容區 | 狀態 key | ✓ | `KanbanPanel`（`closest` 找卡片所在欄當捲動容器） |
| `data-dd` | 所有下拉的觸發器與面板 | `1` | ✓ | `useClickOutside`（點在它之外才關浮層） |
| `data-zoom` | 甘特縮放滑桿 | `1` | ✓ | — |
| `data-selected` | 甘特任務列 / 任務卡 / Issue 卡 | `true` / `false` | ✗ | — |
| `data-rel` | 任務卡 | `up` / `down` / `group` / 空 | ✗ | — |
| `data-status` | 甘特條 / 任務卡 / Issue 卡 | 狀態 key，或 `delayed` | ✗ | — |
| `data-panel` | 面板外殼 | `gantt` / `kanban` / `issues` | ✗ | `TopBar`（頂部導覽捲到該面板） |
| `data-testid` | 摘要卡 `summary-duration` / `summary-progress` / `summary-tasks` / `summary-issues`；頂部 `filter-clear` / `only-filtered`；面板標題 `task-count` / `issue-count` | 固定字串 | ✗ | — |

契約 E 原本只把這些當測試鉤子，實作後它們同時是執行期依賴；要改成 template ref 是「接後端前重構」的項目，在那之前這張表就是唯一的依據。

## 接後端注意

現在整份資料來自 `src/mocks/sampleProject.ts`，改接真實後端前，這幾點要一起處理：

- **api 層目前只抽了 read**。`src/api/project.ts` 只有載入整包專案；27 個寫入 action 直接改 store 的陣列，沒有經過 api 層。要接後端就得先讓寫入路徑統一走 api，否則得在每個 action 裡各接一次。
- **載入沒有錯誤處理**。`DashboardView` 的載入失敗時畫面只會停在空狀態，沒有重試也沒有提示；接後端要補 loading / error 狀態。
- **留言附件目前只做前端預覽**。`addDraftFiles` 直接 `URL.createObjectURL`，沒有任何檢查。接真實上傳時要補檔案大小上限、MIME 型別與副檔名白名單（三者都要，只擋副檔名擋不住偽裝的檔案），伺服器端再驗一次。
- **部署時要加 CSP**。目前沒有 Content-Security-Policy；上線前在伺服器或 CDN 層補上，至少限制 `script-src` / `style-src` / `img-src`（`blob:` 要放行，附件預覽用得到）。
