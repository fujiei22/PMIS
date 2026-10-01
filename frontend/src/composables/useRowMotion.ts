import {
  inject,
  onBeforeUnmount,
  provide,
  shallowRef,
  watch,
  type InjectionKey,
  type ShallowRef,
} from 'vue'
import { parseDuration, parseEasing } from '@/lib/easing'

/**
 * 甘特列的上下位移補間：左欄列、橫紋、條、連線圓點共用同一個時鐘（相依線照條實際的位置畫，見 DependencyLines）。
 *
 * 為什麼不用 TransitionGroup 的 move ＋ 條 / 橫紋自己的 `top` 過渡（動畫稽核 D1 / D2 / D5 / D9）：
 * 兩套機制各走各的——離場列被 Vue 當成要等列自身 0.16s 過渡才移除、佔位；CSS 過渡反向時會縮短時長；
 * keyed diff 搬動 DOM 會取消被搬元素的過渡；新出現的摘要條沒有起點——左右就對不齊。
 * 這裡改成只看「列 index 的變化」：某一列換了位置，它所有的元素先用 `translate` 移回舊位置
 * （加上畫面上還沒走完的位移），再在同一個 rAF 迴圈裡一起補間回 0。
 * 離場的列直接移除、新進場的列直接出現在新位置（同 legacy captureRows :1756-1789）。
 *
 * 位移寫在獨立的 `translate` 屬性上：列抬起來時的 `scale`、條自己的 `transform` 都不會互相蓋掉，
 * 而且 `translate` 不在任何元素的 transition 清單裡，每一幀寫上去就是當幀的位置。
 */

/**
 * 一幀最多推進多少時間（ms）。收合 / 篩選之後的第一幀要重排整頁，常常一幀就 100ms 以上；
 * 照實際經過的時間算的話，補間一開始就跳掉一大段。夾住之後遇到卡頓只是走慢一點，不會跳。
 * 34ms（兩幀）以內照實際時間走，30Hz 的螢幕不受影響。
 */
const MAX_STEP_MS = 34

/** 一列正在跑的補間。 */
interface Anim {
  /** 起點位移（px），走回 0。 */
  from: number
  /** 已經走了多久（ms，補間自己的時鐘，每幀最多推進 MAX_STEP_MS）。 */
  elapsed: number
  /** 上一幀的時間戳；第一幀到之前是 null（第一幀畫在起點）。 */
  last: number | null
  /** 最近一次寫上去的位移＝畫面上此刻的位置；補間中又換位置時從這裡接著走。 */
  cur: number
}

/** 補間的時長（ms）與曲線。 */
export interface RowMotionTiming {
  duration: number
  ease: (x: number) => number
}

export interface RowMotionOptions {
  /** 目前的列 key，由上到下。 */
  keys: () => readonly string[]
  /** 某一列在畫面上的元素（左欄列、橫紋、條、圓點…）；不在畫面上的回 undefined。 */
  elementsOf: (key: string) => Iterable<HTMLElement | undefined>
  /** 一列的高度（px）。 */
  rowHeight: number
  /** 時長與曲線；預設讀 tokens.css 的 `--t-bar` / `--ease`，單元測試可以直接給。 */
  timing?: () => RowMotionTiming
}

export interface RowMotion {
  /**
   * 列 key → 這一幀的位移（px），只放正在補間的列。
   * 每一幀在所有元素都寫好位移之後才換新值，相依線可以拿它當「這一幀的條已經就位」的訊號。
   */
  offsets: Readonly<ShallowRef<ReadonlyMap<string, number>>>
}

const MOTION_KEY: InjectionKey<RowMotion> = Symbol('row-motion')

/** 預設的時長與曲線：左右位移統一用 `--t-bar`（條原本的 top 過渡）與 `--ease`。 */
export function tokenTiming(): RowMotionTiming {
  const cs = getComputedStyle(document.documentElement)
  return {
    duration: parseDuration(cs.getPropertyValue('--t-bar')),
    ease: parseEasing(cs.getPropertyValue('--ease')),
  }
}

/**
 * 在擁有列清單的元件（GanttPanel）呼叫一次。
 * 列清單在 DOM 更新之後（flush: 'post'）才比對：這時新進場的元素已經登錄好，
 * 收合時才出現的摘要條也拿得到分類列同一個位移。
 */
export function useRowMotion(opts: RowMotionOptions): RowMotion {
  const offsets = shallowRef<ReadonlyMap<string, number>>(new Map())
  const anims = new Map<string, Anim>()
  let index = new Map(opts.keys().map((k, i) => [k, i]))
  let timing: RowMotionTiming | null = null
  let raf: number | undefined

  /** 把位移寫到這一列的每個元素上；0 就清掉，讓元素回到自己的版面位置。 */
  function paint(key: string, off: number): void {
    // 取到小數兩位：避免極小值寫成 1e-7px 這種 CSS 不收的寫法
    const v = +off.toFixed(2)
    for (const el of opts.elementsOf(key)) if (el) el.style.translate = v ? `0 ${v}px` : ''
  }

  /** 把每一列目前的位移寫上去，順便更新給相依線用的 offsets。 */
  function apply(): void {
    const out = new Map<string, number>()
    for (const [key, a] of anims) {
      paint(key, a.cur)
      if (a.cur) out.set(key, a.cur)
    }
    offsets.value = out
  }

  function frame(ts: number): void {
    raf = undefined
    const t = timing!
    for (const [key, a] of anims) {
      if (a.last !== null) a.elapsed += Math.min(MAX_STEP_MS, Math.max(0, ts - a.last))
      a.last = ts
      const p = Math.min(1, a.elapsed / t.duration)
      a.cur = p >= 1 ? 0 : a.from * (1 - t.ease(p))
      if (p >= 1) {
        anims.delete(key)
        paint(key, 0)
      }
    }
    apply()
    if (anims.size) raf = requestAnimationFrame(frame)
  }

  watch(
    () => opts.keys().join('\n'),
    (joined) => {
      const keys = joined ? joined.split('\n') : []
      const next = new Map(keys.map((k, i) => [k, i]))
      timing ??= (opts.timing ?? tokenTiming)()

      // 離場的列：元素已經移除，不必再寫
      for (const key of [...anims.keys()]) if (!next.has(key)) anims.delete(key)

      for (const [key, i] of next) {
        const was = index.get(key)
        if (was === undefined || was === i) continue
        // 起點 = 畫面上此刻的位置（還沒走完的位移）+ 舊 index 與新 index 的差
        const from = (anims.get(key)?.cur ?? 0) + (was - i) * opts.rowHeight
        if (timing.duration > 0 && Math.abs(from) >= 0.5) {
          anims.set(key, { from, elapsed: 0, last: null, cur: from })
        } else {
          anims.delete(key)
          paint(key, 0)
        }
      }
      index = next

      apply()
      if (anims.size && raf === undefined) raf = requestAnimationFrame(frame)
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    if (raf !== undefined) cancelAnimationFrame(raf)
    raf = undefined
    anims.clear()
  })

  const api: RowMotion = { offsets }
  provide(MOTION_KEY, api)
  return api
}

/** 甘特圖底下的元件（相依線）取用列位移補間；不在甘特圖裡時是一份永遠空的。 */
export function useRowMotionContext(): RowMotion {
  return inject(MOTION_KEY, () => ({ offsets: shallowRef(new Map()) }), true)
}
