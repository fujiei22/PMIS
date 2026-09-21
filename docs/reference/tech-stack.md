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

下表對應 `package.json` 的 `scripts`。

| 指令 | 實際執行 | 用途 |
|---|---|---|
| `npm run dev` | `vite` | 啟動本機開發伺服器（預設 <http://localhost:5174>，可用 `PLAYWRIGHT_PORT` 改），存檔即時更新 |
| `npm run build` | `run-p type-check build-only` | 型別檢查 + 打包並行跑，輸出到 `dist/`；任一失敗即中斷 |
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
  - **資料欄位**（`tasks` / `issues` / `deps` / `groups` / `comments`）：一律透過 action 改，例如 `taskStore.updateTask()`、`commentStore.send()`。它們背後有 cascade、懸空 id 清理、排序等連動，繞過 action 就會漏做。
- 呼叫後端 API 寫在 store 的 action（或 store 使用的 API 模組）裡。

### 路由
- 每個頁面一個路由；Dashboard 掛在 `/`。

### 元件
- 不引入 UI 元件庫；共用的基礎元件（下拉選單、日曆、對話框等）自行實作並重複使用。

### 測試
- 純邏輯（日期計算、相依連動、篩選、排序）寫 Vitest 單元測試。
- 使用者操作流程（點選、拖曳、對話框）寫 Playwright E2E 測試。
