# PMIS

專案管理資訊系統（Project Management Information System）：單一專案的甘特圖、任務看板與 Issue 看板。

## 目錄結構

```
frontend/          Vue 3 + TypeScript 前端（Vite / Pinia / Vitest / Playwright）
backend/           後端（待建，技術未定）
docs/reference/    前後端共同的長期參考文件（tech-stack / design-map）
```

根目錄不放 npm workspace：`frontend/` 自己帶 `package.json` 與全部 config，後端定案前各子專案各自獨立。

## 啟動前端

需要 Node.js 22 以上（版本記在 `frontend/.nvmrc`）。

```sh
cd frontend
npm install
npm run dev        # http://localhost:5174
```

指令、測試怎麼跑、`legacy/` 對照基準、DOM 鉤子表與「怎麼接後端」全在 [`frontend/README.md`](frontend/README.md)。

## 文件

- [`docs/reference/tech-stack.md`](docs/reference/tech-stack.md) — 技術棧與使用慣例
- [`docs/reference/design-map.md`](docs/reference/design-map.md) — 設計語言區塊地圖
