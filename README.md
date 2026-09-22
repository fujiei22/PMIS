# PMIS

專案管理資訊系統（Project Management Information System）：單一專案的甘特圖、任務看板與 Issue 看板。

目前只有前端（`frontend/`，Vue 3 + TypeScript），資料走記憶體 mock；後端待建。

```
frontend/          前端專案，所有 npm 指令都在這裡面跑
backend/           後端（待建，技術未定）
docs/reference/    長期參考文件：tech-stack.md（技術棧與慣例）、design-map.md（設計語言地圖）
```

## 開發環境

### 1. Node.js 22

版本記在 `frontend/.nvmrc`。建議用 nvm-windows 管理版本（可同時裝多版、隨時切換）：

```powershell
winget install CoreyButler.NVMforWindows   # 沒裝過 nvm 才需要；裝完重開終端機
nvm install 22
nvm use 22                                 # 需要系統管理員權限的終端機
node -v                                    # 應顯示 v22.x
```

不用 nvm 的話，直接到 <https://nodejs.org> 裝 22 LTS 也可以。

### 2. 編輯器

VS Code 開 `frontend/` 資料夾時會提示安裝建議的擴充套件（`frontend/.vscode/extensions.json`），全部裝：

| 擴充套件 | 用途 |
|---|---|
| Vue - Official（Volar） | `.vue` 檔的語法提示與型別檢查 |
| ESLint、Prettier | 存檔時自動檢查與排版 |
| Vitest、Playwright | 在編輯器裡跑測試 |
| EditorConfig | 套用 `.editorconfig` 的縮排與換行設定 |

### 3. 第一次安裝

```sh
cd frontend
npm install
npx playwright install chromium   # 只有要跑 e2e 才需要
```

裝完就能啟動：

```sh
npm run dev        # http://localhost:5174
```

## 常用指令

以下都在 `frontend/` 裡執行。

| 指令 | 做什麼 |
|---|---|
| `npm run dev` | 啟動開發伺服器，存檔即時更新，不做型別檢查 |
| `npm run build` | 型別檢查 + 打包到 `dist/`，任一失敗就中斷 |
| `npm run preview` | 用瀏覽器看 `dist/` 打包結果 |
| `npm run lint` | ESLint 檢查並自動修正 |
| `npm run format` | Prettier 排版 `src/` |
| `npm run type-check` | 只做型別檢查（`vue-tsc`） |
| `npm run test:unit` | Vitest 單元測試，watch 模式（改檔自動重跑） |
| `npm run test:unit -- --run` | 單元測試跑一次就結束（提交前用這個） |
| `npm run test:e2e` | Playwright e2e，會自己起 dev server，不必先 `npm run dev` |

### 提交前

依序跑，全綠再 commit：

```sh
npm run lint
npm run test:unit -- --run
npm run build
npm run test:e2e        # 改到畫面或互動時
```

`npm run dev` 不會擋型別錯誤，所以 `npm run build` 一定要跑。

### e2e 只跑一部分

```sh
npm run test:e2e -- e2e/smoke.spec.ts                 # 單一檔案
npm run test:e2e -- e2e/smoke.spec.ts -g '首頁可開'    # 單一測試，用標題關鍵字
npm run test:e2e -- --headed --debug                  # 開瀏覽器逐步看
PLAYWRIGHT_PORT=5175 npm run test:e2e                 # 換 port（5174 被佔用時）
```

e2e 的時鐘固定在 2026-09-18 10:00，「今天」「已延遲」這類斷言才不會隨日期變。

### 開發時常用的頁面

| 網址 | 內容 |
|---|---|
| <http://localhost:5174/> | Dashboard |
| <http://localhost:5174/legacy/Dashboard.html> | 改寫前的原型，可並排比對行為 |

## 環境變數

| 變數 | 值 | 說明 |
|---|---|---|
| `VITE_API` | 未設或 `mock` | 資料來源。目前只有記憶體 mock；接後端後加 `http` |
| `PLAYWRIGHT_PORT` | 預設 `5174` | dev server 與 e2e 用的 port |

## 進一步的文件

- [`frontend/README.md`](frontend/README.md)：目錄結構、store 分層、DOM 鉤子表、`legacy/` 對照、怎麼接後端
- [`docs/reference/tech-stack.md`](docs/reference/tech-stack.md)：技術棧與程式慣例
- [`docs/reference/design-map.md`](docs/reference/design-map.md)：設計語言區塊地圖
