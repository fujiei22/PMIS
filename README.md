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

## lib 與 store 的分工

| | `src/lib/*.ts` | `src/stores/*.ts` |
|---|---|---|
| 內容 | 純函式：輸入 → 輸出，不碰 Vue、不碰全域狀態 | 響應式狀態與改動它的 action |
| 例子 | `dayIndex()`、`cascade()`、`matchTask()`、`applySort()`、`fmtDate()` | `useTaskStore()`、`useFilterStore()`、`useUiStore()` |
| 測試 | Vitest，直接呼叫、不需要 Pinia | Vitest + `setActivePinia(createPinia())` |

規則：**演算法寫在 `lib/`，store 只負責存狀態並把 `lib/` 的結果接起來。** 元件不直接改 store 的 `ref`，一律透過 action。只有單一元件用得到的狀態（下拉的 hover 列、卡片 hover）留在元件內。

## DOM 鉤子

畫面上這些屬性是給測試與 CSS 用的契約，改元件時要一起維護。標「legacy 也有」的可以用在新舊對照測試裡。

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
| `data-selected` | 甘特任務列 / 任務卡 / Issue 卡 | `true` / `false` | ✗ |
| `data-rel` | 任務卡 | `up` / `down` / `group` / 空 | ✗ |
| `data-status` | 甘特條 / 任務卡 / Issue 卡 | 狀態 key，或 `delayed` | ✗ |
| `data-panel` | 面板外殼 | `gantt` / `kanban` / `issues` | ✗ |
| `data-testid` | 摘要卡 `summary-duration` / `summary-progress` / `summary-tasks` / `summary-issues`；頂部 `filter-clear` / `only-filtered`；面板標題 `task-count` / `issue-count` | 固定字串 | ✗ |
