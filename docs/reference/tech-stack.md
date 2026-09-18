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

> 專案程式碼尚未建立（目前仍是 `Dashboard.html` 原型），下表依 Vue 官方範本的預設指令；建立專案後依實際 `package.json` 更新。

| 指令 | 用途 |
|---|---|
| `npm run dev` | 啟動本機開發伺服器，存檔即時更新 |
| `npm run build` | 型別檢查（`vue-tsc`）+ 打包（`vite build`），輸出到 `dist/`；任一失敗即中斷 |
| `npm run preview` | 在本機預覽打包結果 |
| `npm run lint` | ESLint 檢查並自動修正 |
| `npm run test:unit` | Vitest 單元測試 |
| `npm run test:e2e` | Playwright E2E 測試 |

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
- 多個元件共用的資料放 Pinia store；只有單一元件用到的狀態（下拉選單開關、日曆顯示月份）留在元件內部。
- 修改 store 資料一律透過 store 的 action，不在元件裡直接改。
- 呼叫後端 API 寫在 store 的 action（或 store 使用的 API 模組）裡。

### 路由
- 每個頁面一個路由；Dashboard 掛在 `/`。

### 元件
- 不引入 UI 元件庫；共用的基礎元件（下拉選單、日曆、對話框等）自行實作並重複使用。

### 測試
- 純邏輯（日期計算、相依連動、篩選、排序）寫 Vitest 單元測試。
- 使用者操作流程（點選、拖曳、對話框）寫 Playwright E2E 測試。
