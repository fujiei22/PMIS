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
  return { top: el.offsetTop + t.y, left: el.offsetLeft + t.x, width: el.offsetWidth, height: el.offsetHeight }
}

/**
 * TransitionGroup 的 `@before-leave`：把離場元素釘在它更新前看得到的位置與尺寸，原地淡出。
 *
 * 只設 absolute 的話，元素會落到容器內容區的起點（grid 第一格、flex 開頭），所以連 top / left / width / height 一起寫死。
 * 同一輪更新 Vue 逐一呼叫：第一次呼叫時先量完同父層全部子元素，後面的才不會量到「前一個已經 absolute、退出版面」之後的位置（R1）。
 * 位移進行中（FLIP 或內建 move）離場：位置含目前的 translate，只取消位移的動畫——transform 的 CSS 過渡與
 * useRelativeFlip 的 FLIP 動畫（id = FLIP_ID）；opacity 的淡出照常。再清掉 inline transform / transition：
 * 舊版 FLIP 留下的 inline transition 會蓋掉離場 class 的淡出（C2 e）。
 * rectOf：呼叫端在 DOM 更新前量好的位置（同一次 patch 裡版面已先被改掉時用，例：速覽抽屜的 order，C5）。
 * 父層必須是 `position: relative`。
 */
export function freezeLeave(el: Element, rectOf?: (el: Element) => LeaveRect | undefined): void {
  const node = el as HTMLElement
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
  for (const a of node.getAnimations?.() ?? []) {
    if (a.id === FLIP_ID || (a as { transitionProperty?: string }).transitionProperty === 'transform') a.cancel()
  }
  node.style.transition = ''
  node.style.transform = ''
  node.style.position = 'absolute'
  node.style.top = `${rect.top}px`
  node.style.left = `${rect.left}px`
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
}
