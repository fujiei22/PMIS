import type { OverviewSortKey, ProjectBadgeKind } from '@/lib/portfolio'
import type { ProjectAlert, ProjectStatus } from '@/types/models'

/**
 * 多專案總覽頁的常數：排序鍵、中文標籤、狀態 class、門檻、尺寸與毫秒數。
 * 時長與曲線以 tokens.css 的 --t-* 為準，這裡只放 JS 端需要的毫秒數。
 */

/** 排序選單的四個鍵；dirLabel 顯示在選項右側（B2 .sort-dir）。 */
export const OVERVIEW_SORT_KEYS: readonly { k: OverviewSortKey; label: string; dirLabel: { asc: string; desc: string } }[] = [
  { k: 'gap', label: '落後進度百分比', dirLabel: { desc: '大到小', asc: '小到大' } },
  { k: 'start', label: '專案開始日', dirLabel: { asc: '早到晚', desc: '晚到早' } },
  { k: 'due', label: '專案到期日', dirLabel: { asc: '早到晚', desc: '晚到早' } },
  { k: 'issues', label: 'Issue 數量', dirLabel: { desc: '多到少', asc: '少到多' } },
]
/** 專案狀態的中文標籤。 */
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { doing: '進行中', todo: '未開始', done: '已完成' }
/** 需注意程度的中文標籤。 */
export const PROJECT_ALERT_LABEL: Record<ProjectAlert, string> = { late: '落後', watch: '需注意', none: '無' }
/** 狀態徽章的中文標籤。 */
export const PROJECT_BADGE_LABEL: Record<ProjectBadgeKind, string> = {
  late: '落後', watch: '需注意', doing: '進行中', todo: '未開始', done: '已完成',
}
/** 狀態 → CSS class 字尾。B2 的「需注意」沿用 --st-paused-* 色系，所以 class 叫 paused（.pill-paused / .card-paused / .p-block.paused）。 */
export const BADGE_CLASS: Record<ProjectBadgeKind, string> = {
  late: 'late', watch: 'paused', doing: 'doing', todo: 'todo', done: 'done',
}
/** 需注意門檻：落後百分點。alertOf 與 gapTone 共用。 */
export const LATE_GAP = 15
export const WATCH_GAP = 5
/** 延遲任務數達到這個值就算落後。 */
export const LATE_DELAYED_TASKS = 3
/** 近期任務距今幾天內標成快到期。 */
export const DUE_SOON_DAYS = 2
/** 時間軸一天寬（px）：Dashboard 甘特刻度上限 32px 的 22%（spec 目標 6）。 */
export const TIMELINE_DAY_W = 32 * 0.22
/** 時間軸左欄寬（px），CSS 端以 --gantt-left 同值。 */
export const TIMELINE_LEFT_W = 320
/** 延遲卸載的毫秒數：對應 tokens.css --t-panel（.26s）再多留一點，比照 PanelShell 的 320。 */
export const PANEL_UNMOUNT_MS = 320
/** 狀態下拉的選項順序（照 B2）。 */
export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = ['todo', 'doing', 'done']
