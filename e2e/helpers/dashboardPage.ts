import type { Locator, Page } from '@playwright/test'
import { setFixedTime } from './clock'

/** 面板 key，與 `data-panel` 的值一致。 */
export type PanelKey = 'gantt' | 'kanban' | 'issues'

/**
 * Dashboard 的 page object。
 * 只收斂「怎麼找到元素」，斷言留在各 spec 裡；選擇器優先用契約 E 的 data-* 鉤子。
 */
export class DashboardPage {
  constructor(readonly page: Page) {}

  /** 固定時鐘後開首頁，等到甘特左欄畫出來才回。 */
  async goto(): Promise<void> {
    await setFixedTime(this.page)
    await this.page.goto('/')
    await this.page.locator('[data-rowtask]').first().waitFor()
  }

  /** 四張摘要卡之一：duration / progress / tasks / issues。 */
  summary(key: 'duration' | 'progress' | 'tasks' | 'issues'): Locator {
    return this.page.getByTestId(`summary-${key}`)
  }

  /** 任務計數；甘特與看板兩個面板頭都有一份，取第一個。 */
  get taskCount(): Locator {
    return this.page.getByTestId('task-count').first()
  }

  get issueCount(): Locator {
    return this.page.getByTestId('issue-count')
  }

  get topBar(): Locator {
    return this.page.locator('.top-bar')
  }

  panel(key: PanelKey): Locator {
    return this.page.locator(`[data-panel="${key}"]`)
  }

  panelHead(key: PanelKey): Locator {
    return this.panel(key).locator('.panel-head')
  }

  /** 面板右上角的收合 / 展開鈕。 */
  panelToggle(key: PanelKey): Locator {
    return this.panel(key).locator('.panel-toggle')
  }

  /** 甘特左欄的任務列。 */
  row(taskId: string): Locator {
    return this.page.locator(`[data-rowtask="${taskId}"]`)
  }

  /** 甘特左欄的分類列。 */
  groupRow(groupId: string): Locator {
    return this.page.locator(`[data-rowgroup="${groupId}"]`)
  }

  /** 甘特條；收合分類的摘要條 id 是 `sum-<groupId>`。 */
  bar(taskId: string): Locator {
    return this.page.locator(`[data-taskid="${taskId}"]`)
  }

  card(taskId: string): Locator {
    return this.page.locator(`[data-card="${taskId}"]`)
  }

  issueCard(issueId: string): Locator {
    return this.page.locator(`[data-issuerow="${issueId}"]`)
  }

  /** 甘特圖右側可水平捲動的容器。 */
  get ganttScroller(): Locator {
    return this.page.locator('.gantt-scroller')
  }

  /** 甘特圖上方的日期尺規（跟著 scroller 同步捲動）。 */
  get ganttRuler(): Locator {
    return this.page.locator('.gantt-ruler')
  }

  /** 尺規那一整列（sticky 偏移量測用）。 */
  get ganttRulerRow(): Locator {
    return this.page.locator('.gantt-ruler-row')
  }

  /** 甘特圖畫布本體，寬度 = 天數 × dayWidth。 */
  get ganttChart(): Locator {
    return this.page.locator('.gantt-chart')
  }

  get zoomSlider(): Locator {
    return this.page.locator('[data-zoom]')
  }

  get todayButton(): Locator {
    return this.page.getByRole('button', { name: '今天' })
  }

  /** 元素目前的捲動位置（水平）。 */
  scrollLeftOf(locator: Locator): Promise<number> {
    return locator.evaluate((el) => el.scrollLeft)
  }

  /** 元素外框高度，四捨五入到整數 px（拿來跟 sticky top 比對）。 */
  heightOf(locator: Locator): Promise<number> {
    return locator.evaluate((el) => Math.round(el.getBoundingClientRect().height))
  }
}
