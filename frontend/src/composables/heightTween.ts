/**
 * 容器高度撐住再補間（heightTween）：內容要換之前 holdHeight 把高度寫死，換完 releaseHeight 從舊高度補間到新內容的自然高度，
 * 元件卸載時 cancelHeight 停掉進行中的補間。
 *
 * 前提：被撐住的容器不能把多出來的空間分給子元素。撐住期間容器比內容高（或矮），grid 的 align-content 預設 normal、
 * flex 子元素的 stretch / flex-grow 會把差額分給子元素，留下的內容跟著被拉高（例：泳道卡片網格 142 → 294px），
 * 而且量自然高度、FLIP 量位置時量到的都是被拉開的樣子。grid 容器要設 `align-content: start`（見 PmLane 的 .lane-body），
 * block 容器（例：flow-root 的 .ov-stage）沒有這個問題。
 *
 * 所有進行中的補間共用模組層的一個 rAF，每幀先讀完再寫（效能，同批次 A 的 useRowMotion 共用一個時鐘）：
 * 改前每個元素各開自己的 rAF，每幀各自「讀 scrollHeight → 撐頁高 → 拿掉 inline height → 量 → 寫回」，
 * 前一個寫完下一個再讀，每次讀都逼一次版面計算；篩選時十條泳道同時補間，一幀約 20 次強制版面計算。
 * 改成每幀撐一次頁高（讀一次 scrollHeight）、一次拿掉所有撐住的高度、一次版面計算量完全部的自然高度，再依各自的進度寫入，
 * 每幀降到 1–2 次（這一幀開始時版面已經髒了，讀 scrollHeight 才多算一次；補間的元素互相包含時每多一層再多一次，見 tick）。
 * 補間的數值、時長曲線、提早結束、撐頁高、取消都和改前一樣（單元測試以改前跑出來的每幀高度鎖住）。
 */
import { tokenMs, tokenValue } from '@/composables/motionTokens'
import { parseEasing } from '@/lib/easing'

export interface Timing {
  duration: number
  ease: (p: number) => number
}

/** 一個進行中的補間。 */
interface Tween {
  /** 起點：放開當下撐住的高度（px）。 */
  from: number
  /** 放開的時間（performance.now）。 */
  t0: number
  duration: number
  ease: (p: number) => number
}

/**
 * 補間中的元素 → 補間（再 hold、再 release、cancel 時拿掉）。
 * Map 保留加入的先後、再放開的排到最後：同改前每個元素各自排 rAF 時，同一幀裡各自執行的先後（巢狀時要照這個先後量，見 tick）。
 * 不用 WeakMap：補間最長一個 --t-panel 就結束、拿掉，不會一直留著元素。
 */
const tweens = new Map<HTMLElement, Tween>()
/** 共用的 rAF；沒有補間在跑時是 undefined，不排。 */
let frame: number | undefined

/** 預設時長與曲線：--t-panel / --ease（執行期讀，reduced motion 把 token 設 0 就直接放開）。 */
function panelTiming(): Timing {
  return { duration: tokenMs('--t-panel'), ease: parseEasing(tokenValue('--ease')) }
}

/** 停掉這個元素的補間；最後一個也停了就取消共用的 rAF（之後不再排）。 */
function stop(el: HTMLElement): void {
  if (!tweens.delete(el) || tweens.size || frame === undefined) return
  cancelAnimationFrame(frame)
  frame = undefined
}

/**
 * 撐住頁高，回傳還原的函式。拿掉 inline height 量自然高度的那次強制版面計算裡頁面會變矮：頁面捲在底部時瀏覽器當下就把捲動夾到新的底，
 * 之後每幀量都再夾一次，補間對被夾的捲動完全無效（平板捲到底切檢視時 scrollY 一幀 110 → 0）。
 * 所以量之前用 html 的 min-height 撐住現在的頁高，量完還原成原值（不是清空：別處可能也設了）。
 */
function pinPage(): () => void {
  const html = document.documentElement
  const prev = html.style.minHeight
  html.style.minHeight = `${html.scrollHeight}px`
  return () => {
    html.style.minHeight = prev
  }
}

/**
 * 一次量多個元素的自然高度：全部拿掉 inline height、一起量（只逼一次版面計算），再寫回原本撐住的高度。
 * 呼叫端要先撐住頁高（pinPage）；這些元素不能互相包含（外框量到的會是內層的自然高度，不是內層畫面上的高度）。
 */
function naturalHeights(els: readonly HTMLElement[]): number[] {
  const held = els.map((el) => el.style.height)
  try {
    for (const el of els) el.style.height = ''
    return els.map((el) => el.getBoundingClientRect().height)
  } finally {
    els.forEach((el, i) => (el.style.height = held[i]!))
  }
}

/**
 * 共用 rAF 的一幀：每個補間照 rAF 的時間戳算進度，到時長的清掉 inline height、拿掉；其餘先量完自然高度再一起寫入新高度。
 *
 * 巢狀（例：.ov-stage 正在補間，裡面的泳道卡片網格也在補間）不能一起量：外框的自然高度包含內層「畫面上」的高度，
 * 改前是照各自 rAF 的先後一個一個量寫——內層排在前面，外框量到的是內層這一幀的新高度；排在後面，量到的是上一幀的。
 * 所以照 Map 的先後分批：和前面某個補間互相包含的，排到那個的下一批，等它寫好（或到時長清掉）再量。
 * 互不包含的元素自然高度互不影響（前提同檔頭），同一批一起量。一般只有一批；有巢狀才多一批、多一次版面計算。
 * 頁高整幀只撐一次（讀一次 scrollHeight），全部批次量完才還原；這一幀沒有要量的（全部到時長）就不撐、不讀。
 */
function tick(now: number): void {
  frame = undefined
  const items = [...tweens].map(([el, tw]) => ({
    el,
    tw,
    p: Math.min(1, (now - tw.t0) / tw.duration),
    batch: 0,
  }))
  for (let i = 1; i < items.length; i++) {
    const it = items[i]!
    for (let j = 0; j < i; j++) {
      const prev = items[j]!
      if (prev.batch >= it.batch && (prev.el.contains(it.el) || it.el.contains(prev.el)))
        it.batch = prev.batch + 1
    }
  }
  let unpin: (() => void) | undefined
  try {
    for (let b = 0; ; b++) {
      const batch = items.filter((it) => it.batch === b)
      if (!batch.length) break
      // 先讀：這一批還在補間的一次量完
      const live = batch.filter((it) => it.p < 1)
      let natural: number[] = []
      if (live.length) {
        unpin ??= pinPage()
        natural = naturalHeights(live.map((it) => it.el))
      }
      // 再寫：到時長的清掉 inline height、拿掉；其餘照進度寫入
      for (const it of batch) {
        if (it.p >= 1) {
          it.el.style.height = ''
          tweens.delete(it.el)
        }
      }
      live.forEach(({ el, tw, p }, i) => {
        el.style.height = `${tw.from + (natural[i]! - tw.from) * tw.ease(p)}px`
      })
    }
  } finally {
    unpin?.()
    // 放在 finally：這一幀中途拋錯也照樣排下一幀，補間不會卡在中間的高度（security M1）
    if (tweens.size) frame = requestAnimationFrame(tick)
  }
}

/** 把高度寫死成現在看得到的值（內容要換之前呼叫）；補間中就停在當下。 */
export function holdHeight(el: HTMLElement | null | undefined): void {
  if (!el) return
  stop(el)
  el.style.height = `${el.getBoundingClientRect().height}px`
}

/**
 * 停掉進行中的補間，高度停在當下（元件卸載時呼叫，onBeforeUnmount）。
 * 不停的話共用的 rAF 在元件拿掉後照樣每幀量它、寫它，跑到時長結束；沒有別的補間時還每幀撐一次 html 的 min-height、
 * 逼一次版面計算（例：進 Dashboard 後約 0.26 秒）。
 * 不清掉 inline height：卸載當下元素常常還看得到（整條泳道原地收起、切檢視淡出都在 onBeforeUnmount 之後才跑完），
 * 清掉的話內容一幀跳回自然高度（實測一欄寬時收起中的泳道 290 → 221px）；元素之後跟著元件拿掉，留著的高度不影響別人。
 */
export function cancelHeight(el: HTMLElement | null | undefined): void {
  if (!el) return
  stop(el)
}

/**
 * 從寫死的高度補間到內容的自然高度，結束清掉 inline height。
 *
 * 撐高度的四個地方（泳道內卡片網格、卡片 / 時間軸 ↔ 空狀態、切檢視、速覽同列換卡）共用這一套（plan review Design M7）：
 * 每幀重量自然高度——容器裡還有別的過渡（展開中的卡被篩掉、抽屜在收）時目標會變，量一次就釘住會在結束那幀縮掉一截；
 * 靠時間收尾、不靠 transitionend，不會卡住。逐幀的量與寫交給共用的 rAF（tick）：同時補間的元素每幀一起量、再一起寫。
 * 放開當下沒有撐住、或內容高度沒變（重新渲染但卡片沒進出）就直接清掉、不補間：補間中的元素每幀都要拿掉高度量一次，
 * 篩選時每條泳道都會重新渲染；之後內容自己的過渡（抽屜開合）不撐住就是逐幀跟著走。
 * 這個判斷在放開當下同步量一次（撐住頁高），不等下一幀。
 * @param timing 時長與曲線；不給就在確定要補間時才讀 token（--t-panel、--ease，要讀 computed style），token 是 0 就直接放開。
 *   可直接給（單元測試用，同批次 A 的 useRowMotion）。
 */
export function releaseHeight(el: HTMLElement | null | undefined, timing?: Timing): void {
  if (!el) return
  stop(el)
  if (!el.style.height) return
  const from = parseFloat(el.style.height)
  const unpin = pinPage()
  let natural: number
  try {
    natural = naturalHeights([el])[0]!
  } finally {
    unpin()
  }
  if (Math.abs(natural - from) < 0.5) {
    el.style.height = ''
    return
  }
  const { duration, ease } = timing ?? panelTiming()
  if (!duration) {
    el.style.height = ''
    return
  }
  tweens.set(el, { from, t0: performance.now(), duration, ease })
  frame ??= requestAnimationFrame(tick)
}
