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

  /**
   * 頂部列第 n 個篩選 pill（0 起算）。
   * 順序同 TopBar：狀態、優先度、分類、Issue 有無、Issue 等級、Issue 狀態、日期模式。
   */
  topFilter(index: number): Locator {
    return this.page.locator('.top-bar .dd').nth(index)
  }

  /** 頂部列的「只顯示篩選結果」開關。 */
  get onlyFiltered(): Locator {
    return this.page.getByTestId('only-filtered')
  }

  /** 頂部列的「清除篩選」。 */
  get filterClear(): Locator {
    return this.page.getByTestId('filter-clear')
  }

  /** 面板頭上的排序 chip（看板 / Issue 看板各一排）。 */
  sortChips(key: 'kanban' | 'issues'): Locator {
    return this.panelHead(key).locator('.sort-chip')
  }

  /** 排序選單的觸發鈕。 */
  sortTrigger(key: 'kanban' | 'issues'): Locator {
    return this.panelHead(key).locator('.sort-trigger')
  }

  /** 展開後的排序選單面板。 */
  sortMenu(key: 'kanban' | 'issues'): Locator {
    return this.panelHead(key).locator('.sort-menu')
  }

  /** 狀態 / 優先度 / 分類 / Issue 欄位的浮動選項選單（全域只會有一個）。 */
  get optionMenu(): Locator {
    return this.page.locator('.opt-menu')
  }

  /** 甘特列與看板卡片上「時程」開的日期選擇器。 */
  get taskDatePicker(): Locator {
    return this.page.locator('.task-date-picker')
  }

  /** Issue 期限 / 解決日期與任務完成日期開的日期選擇器。 */
  get issueDatePicker(): Locator {
    return this.page.locator('.issue-date-picker')
  }

  /** 兩步刪除確認對話框。 */
  get confirmDialog(): Locator {
    return this.page.locator('.confirm-dialog')
  }

  get todayButton(): Locator {
    return this.page.getByRole('button', { name: '今天' })
  }

  /** 元素目前的捲動位置（水平）。 */
  scrollLeftOf(locator: Locator): Promise<number> {
    return locator.evaluate((el) => el.scrollLeft)
  }

  /**
   * 尺規與 chart 的捲動位置差。
   * 兩個值要在同一次 evaluate 裡讀，不然捲動動畫跑到一半會量出假的落差。
   */
  scrollSyncDelta(): Promise<number> {
    return this.ganttScroller.evaluate((sc) => {
      const ruler = sc.ownerDocument.querySelector('.gantt-ruler')
      return Math.abs(sc.scrollLeft - (ruler?.scrollLeft ?? 0))
    })
  }

  /** 元素外框高度，四捨五入到整數 px（拿來跟 sticky top 比對）。 */
  heightOf(locator: Locator): Promise<number> {
    return locator.evaluate((el) => Math.round(el.getBoundingClientRect().height))
  }

  // ── S5 拖曳用 ──────────────────────────────────────────────────────────────

  /** 相依連線（可見的那一層，不含透明的點擊熱區）。 */
  get depLines(): Locator {
    return this.page.locator('.dep-layer polyline.dep')
  }

  /** 拖曳建立相依時的虛線預覽。 */
  get linkPreview(): Locator {
    return this.page.locator('.link-layer')
  }

  /** 甘特條左 / 右側的連線圓點熱區（0 = 左、1 = 右）。 */
  linkDot(taskId: string, side: 'L' | 'R'): Locator {
    return this.page.locator(`[data-linkfor="${taskId}"]`).nth(side === 'L' ? 0 : 1)
  }

  /** 看板某一欄的內容區。 */
  column(key: 'todo' | 'doing' | 'paused' | 'done'): Locator {
    return this.page.locator(`[data-col="${key}"]`)
  }

  /** 頂部列成員選擇器的觸發鈕。 */
  get memberPickerTrigger(): Locator {
    return this.page.locator('.mp-trigger')
  }

  /** 成員選擇器展開後的清單列（0 起算）。 */
  memberRow(index: number): Locator {
    return this.page.locator('.mp-panel .mp-row').nth(index)
  }

  /** 甘特左欄目前的列順序，分類列前綴 `G:`。用來驗重排結果。 */
  rowOrder(): Promise<string[]> {
    return this.page
      .locator('[data-rowtask],[data-rowgroup]')
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-rowtask') ?? `G:${el.getAttribute('data-rowgroup')}`),
      )
  }

  /**
   * 把甘特水平捲動固定在 `x`，並確認它真的停在那裡。
   *
   * 初次載入的 jumpToday 與選取任務後的 focus 捲動都是 rAF 補間；
   * 只是「等值不再變」並不可靠——機器忙的時候兩次取樣之間可能一幀都沒跑。
   * 所以改成主動寫入再回頭確認：動畫還在跑就會把值改掉，於是再寫一次。
   * 條的螢幕座標因此完全可預期，拖曳的位移才等於天數 × dayWidth。
   */
  async freezeGanttScroll(x: number): Promise<void> {
    for (let i = 0; i < 40; i++) {
      await this.ganttScroller.evaluate((el, v) => {
        el.scrollLeft = v
      }, x)
      await this.page.waitForTimeout(150)
      if (Math.abs((await this.scrollLeftOf(this.ganttScroller)) - x) < 1) return
    }
    throw new Error('甘特水平捲動一直停不下來')
  }
}

/**
 * 指標拖曳：按住起點後依序移到每個座標。
 *
 * `gapMs` 是每步之間的等待——重排的節流看的是真實經過時間
 * （列 140ms、分類 220ms），一口氣把座標送完只會觸發一次。
 * 最後多等一次，讓 TransitionGroup 的 FLIP 位移跑完再放開，
 * 否則下一次 dragTick 量到的是動畫中途的 rect。
 */
export async function stepDrag(
  page: Page,
  from: { x: number; y: number },
  steps: { x: number; y: number }[],
  gapMs = 0,
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (const s of steps) {
    await page.mouse.move(s.x, s.y)
    if (gapMs) await page.waitForTimeout(gapMs)
  }
  if (gapMs) await page.waitForTimeout(gapMs)
  await page.mouse.up()
}

/**
 * 觸發一次 HTML5 拖放（卡片、成員清單用的那種）。
 *
 * 用手動派發的 DragEvent 而不是 `locator.dragTo()`：
 * 原生拖放在 headless Chromium 會連帶送出 click，落在卡片 / 成員列上會誤觸選取或勾選，
 * 蓋掉真正要驗的 drop 結果。共用同一個 DataTransfer 才能讓 `setData` / `getData` 串起來。
 */
export async function html5Drag(page: Page, source: string, target: string): Promise<void> {
  await page.evaluate(
    ([src, tgt]) => {
      const from = document.querySelector(src)
      const to = document.querySelector(tgt)
      if (!from || !to) throw new Error(`html5Drag 找不到元素：${src} / ${tgt}`)
      const dataTransfer = new DataTransfer()
      const fire = (el: Element, type: string): void => {
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
      }
      fire(from, 'dragstart')
      fire(to, 'dragover')
      fire(to, 'drop')
      fire(from, 'dragend')
    },
    [source, target] as const,
  )
}
