import { currentTranslate, FLIP_ID } from '@/lib/transform'

export interface LeaveRect {
  top: number
  left: number
  width: number
  height: number
}

/** 同一輪更新裡、同一個父層的量測快取（第一次呼叫時一次量完，microtask 清掉）。 */
const batches = new WeakMap<Element, Map<Element, LeaveRect>>()

/** 看得到的位置：版面位置加上目前的 translate（FLIP / move 過渡進行中也對）。 */
function measure(el: HTMLElement): LeaveRect {
  const t = currentTranslate(el)
  return {
    top: el.offsetTop + t.y,
    left: el.offsetLeft + t.x,
    width: el.offsetWidth,
    height: el.offsetHeight,
  }
}

/**
 * 讀之前先寫上的 inline transition：每個屬性都在清單裡，進行中、終值沒變的過渡照原本的時長曲線跑；
 * 時長 0：這次重算若有屬性變了就直接到位，不會多開始一段過渡。
 */
const HOLD_RUNNING = 'all 0s'

/** 只有縮放的 transform（進場的 scale(0.96) / scale(0.9) → none）。 */
const SCALE_ONLY = /^(none|scale\([^)]*\))$/

/**
 * 要取消的位移動畫：useRelativeFlip 的 FLIP（id = FLIP_ID），與帶位移的 transform CSS 過渡（內建 move、舊版 FLIP）。
 * 只有縮放的 transform 過渡（淡入中被移除時進場的放大）留著，接續到離場的縮小；讀不到 keyframes 的當成位移取消。
 */
function isShift(a: Animation): boolean {
  if (a.id === FLIP_ID) return true
  if ((a as { transitionProperty?: string }).transitionProperty !== 'transform') return false
  const frames = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? []
  return !frames.length || frames.some((k) => !SCALE_ONLY.test(String(k.transform)))
}

/**
 * TransitionGroup 的 `@before-leave`：把離場元素釘在它更新前看得到的位置與尺寸，原地淡出。
 *
 * 只設 absolute 的話，元素會落到容器內容區的起點（grid 第一格、flex 開頭），所以連 top / left / width / height 一起寫死。
 * 同一輪更新 Vue 逐一呼叫：第一次呼叫時先量完同父層全部子元素，後面的才不會量到「前一個已經 absolute、退出版面」之後的位置（R1）。
 * 位移進行中（FLIP 或內建 move）離場：位置含目前的 translate，只取消位移的動畫——帶位移的 transform CSS 過渡與
 * useRelativeFlip 的 FLIP 動畫（id = FLIP_ID）；opacity 的淡出照常。再清掉 inline transform / transition：
 * 舊版 FLIP 留下的 inline transition 會蓋掉離場 class 的淡出（C2 e）。
 * 淡入中被移除：Vue 取消進場（拿掉 *-enter-active）之後、加上 *-leave-active 之前呼叫這裡；這時元素自己的 transition
 * 清單沒有 opacity / transform（卡片只列框色、陰影、hover 的 translate，chip / 頭像是 none），任何一次讀版面或
 * getAnimations() 逼瀏覽器重算樣式，進行中的淡入與放大就被取消、當幀跳回實心原尺寸，再從實心淡出。Vue 自己是先加
 * leave-active 再 reflow 來保住它們，所以這裡在任何讀取之前先寫 HOLD_RUNNING（全部屬性、時長 0）撐住，讀完照樣清掉；
 * 同一輪後面的離場元素用快取的位置，但讀自己的 getAnimations() 前也要先寫。
 * rectOf：呼叫端在 DOM 更新前量好的位置（同一次 patch 裡版面已先被改掉時用，例：速覽抽屜的 order，C5）。
 * 父層必須是 `position: relative`。
 */
export function freezeLeave(el: Element, rectOf?: (el: Element) => LeaveRect | undefined): void {
  const node = el as HTMLElement
  // 先寫再讀（見上方說明）：之後的 offset、computed transform、getAnimations() 都會逼一次樣式重算
  node.style.transition = HOLD_RUNNING
  let rect = rectOf?.(el)
  const parent = node.parentElement
  if (!rect && parent) {
    let m = batches.get(parent)
    if (!m) {
      // 先全部讀完（讀 computed transform 會逼一次版面計算），之後才開始寫
      m = new Map([...parent.children].map((c) => [c, measure(c as HTMLElement)] as const))
      batches.set(parent, m)
      queueMicrotask(() => batches.delete(parent))
    }
    rect = m.get(el)
  }
  rect ??= measure(node)
  // jsdom 沒有 getAnimations
  for (const a of node.getAnimations?.() ?? []) if (isShift(a)) a.cancel()
  node.style.transition = ''
  node.style.transform = ''
  node.style.position = 'absolute'
  node.style.top = `${rect.top}px`
  node.style.left = `${rect.left}px`
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
}
