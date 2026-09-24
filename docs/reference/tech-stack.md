# 技術棧

PMIS 前端使用的技術與使用慣例。新加入的開發者先讀這份。

## 技術一覽

| 項目 | 使用 |
|---|---|
| 框架 | Vue 3（Composition API、`<script setup>`） |
| 語言 | TypeScript |
| 建置 | Vite |
| 樣式 | SFC `<style scoped>` + CSS 變數 |
| 狀態管理 | Pinia |
| 路由 | Vue Router |
| UI 元件庫 | 不使用，元件全部自行實作 |
| 單元測試 | Vitest |
| E2E 測試 | Playwright |
| 程式碼檢查 | ESLint + Prettier |

專案以 Vue 官方範本 `npm create vue@latest` 建立，勾選 TypeScript、Vue Router、Pinia、Vitest、End-to-End Testing（Playwright）、ESLint、Prettier。

## 常用指令

以下指令在 `frontend/` 下執行（從 repo 根目錄先 `cd frontend`）。下表對應 `frontend/package.json` 的 `scripts`。

| 指令 | 實際執行 | 用途 |
|---|---|---|
| `npm run dev` | `vite` | 啟動本機開發伺服器（預設 <http://localhost:5174>，可用 `PLAYWRIGHT_PORT` 改），存檔即時更新 |
| `npm run build` | `run-p type-check "build-only {@}" --` | 型別檢查 + 打包並行跑，輸出到 `dist/`；任一失敗即中斷（多出來的參數轉給 `build-only`） |
| `npm run build-only` | `vite build` | 只打包，不做型別檢查 |
| `npm run type-check` | `vue-tsc --build` | 只做型別檢查（含 `e2e/` 這個 project） |
| `npm run preview` | `vite preview` | 在本機預覽打包結果 |
| `npm run lint` | `eslint . --fix --cache` | ESLint 檢查並自動修正 |
| `npm run format` | `prettier --write src/` | 用 Prettier 格式化 `src/` |
| `npm run test:unit` | `vitest` | Vitest 單元測試（watch 模式；一次跑完用 `npm run test:unit -- --run`） |
| `npm run test:e2e` | `playwright test` | Playwright E2E 測試（自己起一份 dev server） |

注意：`npm run dev` 只轉換、不做型別檢查（Vite 只刪掉型別），型別錯誤靠編輯器提示；提交前至少跑一次 `npm run build`。

## 使用慣例

### TypeScript
- 資料模型（Task、Issue、Member、Comment 等）集中定義型別，元件與 store 一律引用，不各自重寫。
- 避免 `any`；可能為空的值（例如用 id 查不到資料）要先判斷再使用。

### 樣式
- 顏色、字級、間距、圓角、陰影一律使用全域 CSS 變數（`var(--accent)`、`var(--fs-control)` …），不直接寫色碼或像素值。
- 元件樣式寫在該 `.vue` 檔的 `<style scoped>`。
- 只有執行時計算出來的值（例如甘特條的位置與寬度、進度條寬度）用 `:style` 綁定。
- 需要新的設計值時，先加進全域變數，再引用。

### 狀態管理
- 多個元件共用的資料放 Pinia store；只有單一元件用到的狀態（下拉的 hover 列、卡片 hover）留在元件內部。
- store 裡的欄位分兩類，寫法不同（review M8）：
  - **UI 狀態欄位**（`ui` / `filter` / `comment` 的浮層開關、選取中的分頁、篩選條件、草稿文字…）：元件可以直接寫，例如 `ui.editing = { kind: 't', id }`、`filter.issueMode = 'has'`。這類欄位只描述畫面狀態，沒有連動規則。
  - **資料欄位**（`tasks` / `issues` / `deps` / `groups` / `comments`）：一律透過 action 改，例如 `taskStore.updateTask()`、`commentStore.send()`。它們背後有 cascade、api 呼叫與失敗還原、懸空 id 清理等連動，繞過 action 就會漏做。

#### store 分三層
依賴只能由上往下：**時鐘層** `clock`（`now` / `todayIdx` / `todayIso`，誰都能讀）→ **資料層** `task` / `issue` / `comment` / `member` / `budget`（專案資料的唯一擁有者）→ **派生層** `rows` / `filter` / `selection` / `ui`（算畫面要的東西，可讀所有層）。

資料層不知道派生層存在：新增的預設值由 `composables/useTaskActions.ts` 算好傳進去，懸空 id 由 `selection` / `ui` 各自的 `watch(flush: 'sync')` 清，錯誤條靠 `_optimistic.setErrorSink()` 注入。白名單由 `src/stores/__tests__/imports.spec.ts` 讀原始碼守著。

#### api 層
資料進出只走 `src/api/`：`types.ts` 的 `ProjectApi` 是介面（含 `subscribe` 事件），`mock/` 是記憶體實作，`index.ts` 依 `VITE_API` 挑一個。**store 與元件一律 `import { api } from '@/api'`**，不直接碰 `@/api/mock`，更不碰 `@/mocks/*`。

#### 樂觀更新
寫入一律「先改本地、再打 api、失敗還原」，共用機制在 `src/stores/_optimistic.ts`（`createTracker` / `runOptimistic`，以 id 為單位記最後已知的 server 狀態與 in-flight 計數）。拖曳每個 tick 只改本地、放開才送一次；逐鍵編輯用 `composables/useEditDraft.ts` 做 300ms debounce。事件訂閱只有 `stores/_sync.ts` 一處，啟動與錯誤 sink 注入在 `composables/useProjectBoot.ts`。

細節與後端契約（端點表、錯誤碼表、事件規則、adapter 職責）見 [`frontend/README.md` 的「怎麼接後端」](../../frontend/README.md#怎麼接後端)。

### 路由
- 每個頁面一個路由；Dashboard 掛在 `/`。

### 元件
- 不引入 UI 元件庫；共用的基礎元件（下拉選單、日曆、對話框等）自行實作並重複使用。

### 測試
- 純邏輯（日期計算、相依連動、篩選、排序）寫 Vitest 單元測試。
- 使用者操作流程（點選、拖曳、對話框）寫 Playwright E2E 測試。
