import type { Locator, Page } from '@playwright/test'
import { setFixedTime } from './clock'

/** 總覽頁的操作與定位。選擇器以 README〈DOM 鉤子〉表的屬性為主；用到的 class 列在 README「總覽 e2e 依賴的 class」表。 */
export class OverviewPage {
  constructor(readonly page: Page) {}

  /** hash 傳 '#timeline' 直接開時間軸；at 用來改時鐘（截圖對照 B2 時用 2026-09-22）。 */
  async goto(hash = '', at?: Date): Promise<void> {
    if (at) await this.page.clock.setFixedTime(at)
    else await setFixedTime(this.page)
    await this.page.goto('/' + hash)
    await this.page.locator('[data-view="overview"] [data-view-panel]').first().waitFor()
    // 等進場動畫（ov-view 等）跑完：動畫中點擊，Playwright 會因元素不穩定而重試並捲動頁面，之後的位置量測就不準
    await this.page.waitForFunction(() => document.getAnimations().length === 0)
  }
  count(): Locator { return this.page.getByTestId('overview-count') }
  dropdown(key: 'pm' | 'status' | 'alert'): Locator { return this.page.locator(`[data-ov-dd="${key}"]`) }
  async openDropdown(key: 'pm' | 'status' | 'alert'): Promise<void> { await this.dropdown(key).locator('button.dd-trigger').click() }
  /** 在狀態 / 需注意下拉勾一個選項後關掉。 */
  async pick(key: 'status' | 'alert', label: string): Promise<void> {
    await this.openDropdown(key)
    await this.dropdown(key).getByRole('button', { name: label, exact: true }).click()
    await this.page.keyboard.press('Escape')
  }
  async pickPm(...ids: string[]): Promise<void> {
    await this.openDropdown('pm')
    for (const id of ids) await this.dropdown('pm').locator(`[data-pm-option="${id}"]`).click()
    await this.page.keyboard.press('Escape')
  }
  card(id: string): Locator { return this.page.locator(`[data-view-panel="cards"] [data-project="${id}"]`) }
  /** 卡片檢視的速覽抽屜（每條泳道一個）正在顯示 id 這張卡時；不在卡片裡，是插在卡片所在列下方的兄弟元素。 */
  drawer(id: string): Locator { return this.page.locator(`[data-view-panel="cards"] [data-drawer="${id}"]`) }
  cardIds(): Promise<string[]> {
    return this.page.locator('[data-view-panel="cards"] [data-project]').evaluateAll((els) => els.map((e) => e.getAttribute('data-project')!))
  }
  columnIds(): Promise<string[]> {
    return this.page.locator('[data-pm-col]').evaluateAll((els) => els.map((e) => e.getAttribute('data-pm-col')!))
  }
  row(id: string): Locator { return this.page.locator(`[data-view-panel="timeline"] [data-project="${id}"]`) }
}
