import type { WorkCalendar } from '@/types/models'

/**
 * mock 的工作日曆（`GET /api/calendar` 的回應）：2026、2027 的官方辦公日曆，共 45 個放假日。
 *
 * 來源：後端匯入的官方資料（2026 新北市資料開放平臺、2027 行政院人事行政總處），屬公開資料；
 * 取自 `GET /api/calendar?from=2026-01-01&to=2027-12-31`。
 * - 這兩年沒有補班日（`isWorkday: true` 的日子）；補班的行為由單元測試自備日曆來測。
 * - mock 只放兩年：任務期間跨到 2028 年，畫面會出現「假日未公布」的提示。
 * 規則見 docs/reference/scheduling.md〈工作天〉。
 */
export const sampleCalendar: WorkCalendar = {
  weekendDays: [6, 7],
  coveredYears: [2026, 2027],
  days: [
    { date: '2026-01-01', isWorkday: false, name: '中華民國開國紀念日', source: 'official' },
    { date: '2026-02-16', isWorkday: false, name: '除夕', source: 'official' },
    { date: '2026-02-17', isWorkday: false, name: '春節', source: 'official' },
    { date: '2026-02-18', isWorkday: false, name: '春節', source: 'official' },
    { date: '2026-02-19', isWorkday: false, name: '春節', source: 'official' },
    { date: '2026-02-20', isWorkday: false, name: '春節', source: 'official' },
    { date: '2026-02-27', isWorkday: false, name: '補假', source: 'official' },
    { date: '2026-02-28', isWorkday: false, name: '和平紀念日', source: 'official' },
    { date: '2026-04-03', isWorkday: false, name: '補假', source: 'official' },
    { date: '2026-04-04', isWorkday: false, name: '兒童節', source: 'official' },
    { date: '2026-04-05', isWorkday: false, name: '民族掃墓節', source: 'official' },
    { date: '2026-04-06', isWorkday: false, name: '補假', source: 'official' },
    { date: '2026-05-01', isWorkday: false, name: '勞動節', source: 'official' },
    { date: '2026-06-19', isWorkday: false, name: '端午節', source: 'official' },
    { date: '2026-09-25', isWorkday: false, name: '中秋節', source: 'official' },
    { date: '2026-09-28', isWorkday: false, name: '教師節', source: 'official' },
    { date: '2026-10-09', isWorkday: false, name: '補假', source: 'official' },
    { date: '2026-10-10', isWorkday: false, name: '國慶日', source: 'official' },
    { date: '2026-10-25', isWorkday: false, name: '光復節', source: 'official' },
    { date: '2026-10-26', isWorkday: false, name: '補假', source: 'official' },
    { date: '2026-12-25', isWorkday: false, name: '行憲紀念日', source: 'official' },
    { date: '2027-01-01', isWorkday: false, name: '開國紀念日', source: 'official' },
    { date: '2027-02-04', isWorkday: false, name: '小年夜', source: 'official' },
    { date: '2027-02-05', isWorkday: false, name: '農曆除夕', source: 'official' },
    { date: '2027-02-06', isWorkday: false, name: '春節', source: 'official' },
    { date: '2027-02-07', isWorkday: false, name: '春節', source: 'official' },
    { date: '2027-02-08', isWorkday: false, name: '春節', source: 'official' },
    { date: '2027-02-09', isWorkday: false, name: '補假', source: 'official' },
    { date: '2027-02-10', isWorkday: false, name: '補假', source: 'official' },
    { date: '2027-02-28', isWorkday: false, name: '和平紀念日', source: 'official' },
    { date: '2027-03-01', isWorkday: false, name: '補假', source: 'official' },
    { date: '2027-04-04', isWorkday: false, name: '兒童節', source: 'official' },
    { date: '2027-04-05', isWorkday: false, name: '清明節', source: 'official' },
    { date: '2027-04-06', isWorkday: false, name: '補假', source: 'official' },
    { date: '2027-04-30', isWorkday: false, name: '補假', source: 'official' },
    { date: '2027-05-01', isWorkday: false, name: '勞動節', source: 'official' },
    { date: '2027-06-09', isWorkday: false, name: '端午節', source: 'official' },
    { date: '2027-09-15', isWorkday: false, name: '中秋節', source: 'official' },
    { date: '2027-09-28', isWorkday: false, name: '孔子誕辰紀念日/教師節', source: 'official' },
    { date: '2027-10-10', isWorkday: false, name: '國慶日', source: 'official' },
    { date: '2027-10-11', isWorkday: false, name: '補假', source: 'official' },
    {
      date: '2027-10-25',
      isWorkday: false,
      name: '臺灣光復暨金門古寧頭大捷紀念日',
      source: 'official',
    },
    { date: '2027-12-24', isWorkday: false, name: '補假', source: 'official' },
    { date: '2027-12-25', isWorkday: false, name: '行憲紀念日', source: 'official' },
    { date: '2027-12-31', isWorkday: false, name: '補假', source: 'official' },
  ],
}
