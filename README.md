# PMIS

專案管理資訊系統（Project Management Information System）：單一專案的甘特圖、任務看板與 Issue 看板。

目前只有前端（`frontend/`，Vue 3 + TypeScript），資料走記憶體 mock；後端待建。

```
PMIS/
├── frontend/          前端專案，所有 npm 指令都在這裡面跑
│   ├── src/           程式碼
│   ├── e2e/           Playwright 測試
│   ├── legacy/        改寫前的原型（唯讀基準）
│   └── README.md      目錄結構、store 分層、怎麼接後端
├── backend/           後端（待建，技術未定）
└── docs/
    └── reference/     長期參考文件
        ├── tech-stack.md    技術棧與程式慣例
        └── design-map.md    設計語言區塊地圖
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

VS Code 開 `frontend/` 資料夾時會提示安裝建議的擴充套件（`frontend/.vscode/extensions.json`）。這些套件都不是必要的：lint、測試、build 全靠 `npm run ...` 在終端機跑，擴充套件只是把同樣的事搬進編輯器。

| 擴充套件 | 建議 | 沒裝會怎樣 |
|---|---|---|
| Vue - Official（Volar） | 必裝 | `.vue` 檔沒有語法顏色、自動補全與型別提示，錯誤要等 `npm run build` 才看得到 |
| ESLint、Prettier | 選裝 | 不會邊打字邊標問題；改用 `npm run lint` / `npm run format` 效果相同 |
| Vitest、Playwright | 選裝 | 不能在側欄按鈕跑單一測試；改用 `npm run test:unit` / `npm run test:e2e` |
| EditorConfig | 選裝 | 不套用根目錄 `.editorconfig` 的縮排與換行；Prettier 排版時會修回大部分差異 |

### 3. 第一次安裝

```sh
cd frontend
npm install
npx playwright install chromium   # 只有要跑 e2e 才需要
```

## 常用指令

以下都在 `frontend/` 裡執行。

| 指令 | 做什麼 |
|---|---|
| `npm run dev` | 啟動開發伺服器 <http://localhost:5174>，存檔即時更新，不做型別檢查 |
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

## 進一步的文件

- [`frontend/README.md`](frontend/README.md)：目錄結構、store 分層、DOM 鉤子表、`legacy/` 對照、怎麼接後端
- [`docs/reference/tech-stack.md`](docs/reference/tech-stack.md)：技術棧與程式慣例
- [`docs/reference/design-map.md`](docs/reference/design-map.md)：設計語言區塊地圖
