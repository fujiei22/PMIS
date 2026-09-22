# 設計語言區塊地圖

> 由 design-language skill 產生。修改後請保留欄位結構。

| 區塊 | 檔案範圍 | 選擇器範圍 | token 來源 | dark 機制 | 框架 | CSS 方案 |
|---|---|---|---|---|---|---|
| Dashboard | `frontend/src/**` | — | `frontend/src/assets/tokens.css` | 無 | Vue | scoped CSS + CSS 變數 |

備註：`frontend/src/assets/tokens.css` 由 `frontend/legacy/design-system.html` 的 `<style id="tokens">` 抽出；token 與原程式值的差異處理見改寫任務 spec。
