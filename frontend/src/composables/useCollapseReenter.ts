import { toValue, type MaybeRefOrGetter, type VNode } from 'vue'
import { parseEasing } from '@/lib/easing'

/** 更新前量到的離場中項目：看得到的高度與透明度，以及量的是哪個元素（用之前確認它還在離場中）。 */
interface Leaving {
  h: number
  o: number
  el: Element
}

/** 更新前量到的進場中項目：看得到的高度與透明度，以及它進行中的高度過渡（已跑多久、時長、曲線）。 */
interface Entering {
  h: number
  o: number
  anim: Animation
  t: number
  dur: number
  ease: (p: number) => number
}

const hasClass = (el: Element, suffix: string): boolean => Array.from(el.classList).some((k) => k.endsWith(suffix))

/** 元素還在離場中：Vue 收完離場才拿掉 *-leave-active（同 key 回來時提早移除的不拿，見 onEnter）。 */
const isLeaving = (el: Element): boolean => hasClass(el, '-leave-active')

/** 拿掉 *-enter-from，進場的過渡當下起步；先以 enter-from 算一次樣式當起點（已拿掉的不動）。 */
function startEnterNow(node: HTMLElement): void {
  const from = Array.from(node.classList).filter((k) => k.endsWith('-enter-from'))
  if (!from.length) return
  void getComputedStyle(node).opacity
  node.classList.remove(...from)
}

/** 項目展開後的完整高度：內容（外層 > 裁切層 > 內容）的高度加上它的 margin-bottom（間距在裁切層裡跟著收）。 */
function fullHeight(node: Element): number {
  const inner = node.firstElementChild?.firstElementChild as HTMLElement | null | undefined
  if (!inner) return 0
  return inner.offsetHeight + (parseFloat(getComputedStyle(inner).marginBottom) || 0)
}

/** 元素上進行中的高度過渡（grid-template-rows 的 CSSTransition）；jsdom 沒有 getAnimations。 */
function heightTransition(el: Element): Animation | undefined {
  return el.getAnimations?.().find((a) => (a as CSSTransition).transitionProperty === 'grid-template-rows')
}

/**
 * 原地收合的離場立刻開始收（綁 TransitionGroup 的 `@leave`；只收一個參數，Vue 仍自己偵測過渡結束）。
 *
 * Vue 加上 *-leave-from、*-leave-active 並強制算一次樣式後同步呼叫 @leave，要等 nextFrame（實測約 3 幀）才把 leave-from 換成 leave-to。
 * 同一次更新裡換順序的項目由內建 move（泳道、群組）或 useRelativeFlip（列）當幀起跑，move 的終點是「離場的還沒收」時的位置，
 * 收合晚幾幀才開始、又把版面往回拉：換順序的項目先往反方向鼓出再回來（N2：打 p 時泳道 27px、群組 16px）。
 * 這裡當下就換成 leave-to，收合與 move 同一幀開始、同時長同曲線（--t-panel / --ease），版面位移與 move 的 transform 一路互相抵消，
 * 路徑單調。之後 Vue 再換 class 是空操作（同 onEnter 立刻拿掉 enter-from）。不讀樣式，不會打斷進行中的過渡。
 */
export function startLeaveNow(el: Element): void {
  for (const k of Array.from(el.classList)) {
    if (!k.endsWith('-leave-from')) continue
    el.classList.remove(k)
    el.classList.add(`${k.slice(0, -'from'.length)}to`)
  }
}

/**
 * 原地收合的清單（泳道、時間軸群組與列）：同一個 key 在離場途中又回來時，從舊元素當下的高度與透明度接續長回去。
 *
 * 為什麼要：Vue 會先把離場中的舊元素移除（並呼叫它的 after-leave），才讓新元素進場；新元素照 class 從 0fr、透明開始，
 * 下方的清單與面板底邊會一幀上跳再推回（打錯字馬上刪最常見，plan review Design C2）。那時舊元素已量不到，
 * 所以在清單更新前先量好。
 *
 * 結構約定：項目外層是 grid（過渡寫在 ov-col / ov-group / ov-row 的 class，0fr ↔ 1fr），第一個子元素是裁切層，
 * 裁切層的第一個子元素是內容（間距用它的 margin-bottom，放在裁切層裡跟著收）。
 *
 * 另外兩件同屬進出場銜接的事也在這裡：一般進場當下就開始長（onEnter，不等 Vue 的 nextFrame；離場同理見 startLeaveNow）；
 * 進場中的項目被換順序時從當下接續（resume）：keyed diff 搬動 DOM 會取消它進行中的過渡、一幀跳到全高全亮。
 *
 * 綁在 TransitionGroup 上：`@vue:before-update="reenter.snapshot"`、`@enter="reenter.onEnter"`（離場另綁 `@leave="startLeaveNow"`），
 * 每個項目外層綁 `@vue:updated="reenter.resume"`。
 * - snapshot 綁 TransitionGroup 自己的 before-update，不用擁有者的 onBeforeUpdate：清單寫在插槽裡（例如 OvPanel 的內容）時，
 *   篩選只會讓 TransitionGroup 重新渲染，擁有者不會更新。
 * - onEnter 只收一個參數，Vue 仍自己偵測過渡結束。
 * - resume 綁在項目外層（不是 TransitionGroup）的 updated：它排在 TransitionGroup 量內建 move 的位置之前，
 *   起點先寫好，move 量到的才是接續後的版面（同 TimelineGroup 的列在 useRelativeFlip 量之前寫起點）。
 */
export function useCollapseReenter(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  keyAttr: string,
): { onEnter: (el: Element) => void; resume: (item: Element | VNode) => void; snapshot: () => void } {
  let leaving = new Map<string, Leaving>()
  let entering = new Map<Element, Entering>()

  /**
   * 清單更新前：記下離場中項目看得到的高度與透明度，以及進場中項目的高度、透明度與高度過渡的進度
   * （這時還沒有任何 class 在換，讀樣式不會打斷進行中的過渡）。
   */
  function snapshot(): void {
    const next = new Map<string, Leaving>()
    const nextEntering = new Map<Element, Entering>()
    for (const c of Array.from(toValue(container)?.children ?? [])) {
      const key = c.getAttribute(keyAttr)
      if (!key) continue
      if (isLeaving(c)) {
        next.set(key, { h: c.getBoundingClientRect().height, o: parseFloat(getComputedStyle(c).opacity), el: c })
        continue
      }
      if (!hasClass(c, '-enter-active')) continue
      const anim = heightTransition(c)
      const t = anim?.currentTime
      if (!anim || anim.playState !== 'running' || typeof t !== 'number') continue
      const timing = anim.effect?.getTiming()
      nextEntering.set(c, {
        h: c.getBoundingClientRect().height,
        o: parseFloat(getComputedStyle(c).opacity),
        anim,
        t,
        dur: Number(timing?.duration) || 0,
        ease: parseEasing(timing?.easing ?? ''),
      })
    }
    leaving = next
    entering = nextEntering
  }

  /**
   * 進場的新元素（綁 `@enter`）。
   *
   * 一般進場：當下就開始長，不等 Vue 的 nextFrame（約 3 幀後）才拿掉 enter-from。理由同 startLeaveNow：同一次更新裡換順序的項目
   * 由 move 當幀起跑，終點是「進場的還沒長」時的位置，長出晚幾幀才開始、又把版面往回推，換順序的項目先鼓出再回來
   * （N2：清空搜尋時泳道 27px、群組 10px）。先以 enter-from 算一次樣式當起點（讀 opacity 只算樣式、不排版），再拿掉它。
   *
   * 同 key 回來的新元素：以 snapshot 量到的高度比例（fr）與透明度當起點，立刻往 1fr / 1 過渡。
   * 1. 先關掉過渡再寫起點、強制算一次樣式：上面量完整高度時，瀏覽器已經用 enter-from（0fr、透明）算過一次樣式，
   *    直接改 inline 會從 0 過渡到起點，等於從 0 重長。
   * 2. 交還 class 的過渡，同時拿掉 enter-from、清掉 inline：目標直接是 1fr / 1，下一次算樣式就從起點往回長。
   *    不等 Vue 兩幀後才把 enter-from 換成 enter-to：等的話反悔後多停在起點，實測第 3–4 幀才往回；立刻放開是第 2–3 幀，
   *    和一次全新的篩選一樣快（剩下的一兩幀是瀏覽器新建過渡的起步）。之後 Vue 再拿 enter-from 是空操作。
   * 快照要是新的：量到的舊元素必須還在離場中，否則當作沒有快照（從 0 長）。快照留到下一次 snapshot 才換，
   * 舊元素之後若自己收完（Vue 拿掉 *-leave-active 再移除），同 key 再進場時用它就是從早已不在的高度長回來（review code-review #6）。
   * 不看它還在不在 DOM 上：Vue 在新元素的 beforeEnter 裡就把離場中的同 key 舊元素提早移除，呼叫這裡時它一定已經不在了，
   * 只是 *-leave-active 還留著（實測泳道、群組、列都是）。
   */
  function onEnter(el: Element): void {
    const node = el as HTMLElement
    const key = node.getAttribute(keyAttr)
    const snap = key ? leaving.get(key) : undefined
    if (key) leaving.delete(key)
    const full = snap && isLeaving(snap.el) ? fullHeight(node) : 0
    if (!snap || !full) {
      startEnterNow(node)
      return
    }
    node.style.transition = 'none'
    node.style.gridTemplateRows = `${Math.min(1, snap.h / full)}fr`
    node.style.opacity = String(snap.o)
    void node.offsetHeight
    node.style.transition = ''
    for (const k of Array.from(node.classList)) if (k.endsWith('-enter-from')) node.classList.remove(k)
    node.style.gridTemplateRows = ''
    node.style.opacity = ''
  }

  /**
   * 進場中被換順序的項目（C2 I2 / T5 e）：keyed diff 搬動 DOM 時瀏覽器取消它進行中的過渡，當幀跳到全高、全亮。
   * 更新前記下的高度過渡被取消了（playState 不再是 running；沒被搬動的照跑，不碰）就從當下接續：
   * 用負的 transition-delay 讓重建的過渡直接從原本的進度開始、在原本的時間結束（Vue 的進場在原本的時間收尾、拿掉過渡 class，
   * 重新跑滿一段會在那時被切掉、一幀跳到終點）。起點反推成「照同一條曲線、在這個進度時正好是當下的值」：
   * 當下的值 v、曲線走到 e 時，起點是 (v − e) / (1 − e)（從 0 長的就是 0；同 key 回來從一半接續的也對得上）。
   * 寫起點的方法同 onEnter（先關過渡、寫起點、強制算樣式、交還過渡）；過渡建立後才拿掉 inline 的 delay（不影響已在跑的過渡）。
   * @param item 項目外層，或它的 vnode（綁 `@vue:updated` 時 Vue 傳 vnode）
   */
  function resume(item: Element | VNode): void {
    const el = item instanceof Element ? item : (item.el as Element | null)
    const snap = el ? entering.get(el) : undefined
    if (!el || !snap) return
    entering.delete(el)
    if (snap.anim.playState === 'running' || !el.isConnected || !hasClass(el, '-enter-active') || !snap.dur) return
    const node = el as HTMLElement
    const full = fullHeight(node)
    const e = snap.ease(Math.min(1, snap.t / snap.dur))
    if (!full || 1 - e < 0.01) return
    const from = (v: number): number => Math.max(0, (v - e) / (1 - e))
    node.style.transition = 'none'
    node.style.gridTemplateRows = `${from(Math.min(1, snap.h / full))}fr`
    node.style.opacity = String(from(snap.o))
    void node.offsetHeight
    node.style.transition = ''
    node.style.transitionDelay = `${-snap.t}ms`
    node.style.gridTemplateRows = ''
    node.style.opacity = ''
    void node.offsetHeight
    node.style.transitionDelay = ''
  }

  return { onEnter, resume, snapshot }
}
