/**
 * mock dev server 的「今天」。
 *
 * 為什麼 dev 要固定今天：mock 的範例專案是以 2026-09-18 為今天推算出來的
 * （起訖、延遲、計畫進度都跟今天有關），真實日期一往後走，範例就會整片變成延遲、
 * 跟 e2e 與文件上看到的畫面對不起來。所以只要是 mock 的 dev server，
 * 「今天」預設就是 {@link DEV_TODAY}，網址加 `?today=YYYY-MM-DD` 可以換別天看。
 *
 * 做法是時間位移而不是凍結：只把日期平移到目標日，一天裡的時刻照真實時間走，
 * 今日線與 `useNow` 的 tick 都照常運作。
 *
 * e2e 用 `page.clock` 把瀏覽器時間固定在 2026-09-18（`e2e/helpers/clock.ts`），
 * 真實今天已經是目標日，位移剛好是 0，兩者一致；但這也代表 e2e 若把時鐘固定在
 * 別天，日期仍會被拉回 09-18，要換天得一併帶 `?today=`。
 */

/** mock dev server 預設的今天；與範例資料推算時用的今天一致。 */
export const DEV_TODAY = '2026-09-18'

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 'YYYY-MM-DD' → 該日本地 00:00 的毫秒；格式錯或日期不存在（例如 02-30）回 null。
 * `new Date(y, m, d)` 遇到不存在的日期會默默進位到下個月，所以要回頭比對年月日。
 */
function localMidnight(iso: string): number | null {
  const m = ISO_RE.exec(iso)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const date = new Date(y, mo, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null
  return date.getTime()
}

/**
 * 算出把「真實今天」平移到目標日要加的毫秒數。
 *
 * 目標日取自 `search` 的 `today` 參數，缺少、格式錯或日期不存在都改用 {@link DEV_TODAY}。
 * 回「目標日本地 00:00 − 真實今天本地 00:00」，`realNow` 加上它之後時刻不變、只換日期。
 *
 * @param search `location.search`，例如 `'?today=2026-10-05'`；空字串視為沒指定
 * @param realNow 真實的現在（毫秒）
 */
export function devOffset(search: string, realNow: number): number {
  const wanted = new URLSearchParams(search).get('today') ?? ''
  const target = localMidnight(wanted) ?? localMidnight(DEV_TODAY)!
  const real = new Date(realNow)
  // 用兩邊的本地 00:00 相減而不是整天數 × 86400000：有夏令時間的時區，兩天的時差不同，
  // 直接相減才會落在目標日的同一個時刻
  const realMidnight = new Date(real.getFullYear(), real.getMonth(), real.getDate()).getTime()
  return target - realMidnight
}

/**
 * 只有 mock 的 dev server 才位移：
 * - `DEV`：production build 一律用真實時間。
 * - `MODE !== 'test'`：vitest 也是 DEV，單元測試要自己用 fake timers 控時間。
 * - `VITE_API` 未設、空字串或 `'mock'`：與 `src/api/index.ts` 的 `createApi()` 判斷一致，
 *   接了真後端時今天就是真的今天。
 *
 * 模組載入時算一次：網址的 `?today=` 只在開頁時讀，之後換路由不會改變今天。
 */
const OFFSET =
  import.meta.env.DEV &&
  import.meta.env.MODE !== 'test' &&
  (import.meta.env.VITE_API || 'mock') === 'mock'
    ? devOffset(location.search, Date.now())
    : 0

/**
 * 系統的「現在」（毫秒）：時鐘 store 與 mock api 取今天都走這裡，不直接讀 `Date.now()`。
 * mock 的 dev server 會平移到 {@link DEV_TODAY}（或 `?today=`），其他情況就是 `Date.now()`。
 */
export function systemNow(): number {
  return Date.now() + OFFSET
}
