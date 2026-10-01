import { onBeforeUpdate, onUpdated, toValue, type MaybeRefOrGetter } from 'vue'
import type { LeaveRect } from '@/composables/freezeLeave'
import { tokenMs, tokenValue } from '@/composables/motionTokens'
import { currentTranslate, FLIP_ID } from '@/lib/transform'

/**
 * 以「相對於容器」的位移做 FLIP 重排動畫，給巢狀在另一個會移動的容器裡的清單用
 * （卡片檢視的泳道內卡片、時間軸的群組內專案列）。
 *
 * 為什麼不用 TransitionGroup 內建的 move：它量頁面上的絕對位置，外層泳道 / 群組自己也在移動時會把外層的位移再算一次。
 * 這裡量 offsetTop / offsetLeft（相對容器，容器必須 position: relative），外層怎麼動都不影響。
 *
 * 起點用「看得到的位置」＝版面位置 ＋ 目前的 translate：上一段 FLIP 還沒跑完就又重排（打字打到一半刪掉），
 * 從半路接續而不是先瞬移到上一個終點（T4）。只有版面位置真的變了才重新起跳：篩選結果沒變的重新渲染不打斷進行中的位移。
 * 位移用 Web Animations（composite: 'add'、只動 transform），不寫 inline transition：寫了會蓋掉 class 上的進出場過渡
 * （淡入中的卡直接變實心 T5、列外層的原地收合直接到位），Vue 判斷內建 move 時複製第一個子元素也會連 inline 一起複製。
 * 用法：容器內 TransitionGroup 的 move-class 指到 `ov-card-still` / `ov-row-still`（overview-motion.css）停用內建 move。
 * 時序：本元件的 onBeforeUpdate 在 DOM 更新前記位置；onUpdated 在子元件（TransitionGroup）之後執行，
 * 這時離場元素已被 freezeLeave 釘成 absolute、不佔版面，量到的就是新位置。
 *
 * @param container 清單容器（元素的 offsetParent）
 * @param keyAttr 用來對應新舊元素的屬性名，例如 `data-project`
 * @param duration 時長：token 名（預設 `--t-panel`）或毫秒數（單元測試用）；曲線一律 `--ease`
 * @returns snapshotOf：更新前的位置，給同一次 patch 版面已先改掉的離場元素釘位用（freezeLeave 的 rectOf）
 */
export function useRelativeFlip(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  keyAttr: string,
  duration: string | number = '--t-panel',
): { snapshotOf: (el: Element) => LeaveRect | undefined } {
  /** 更新前看得到的位置，與當時的版面位置（offset，不含 translate）。 */
  let before = new Map<string, { seen: LeaveRect; top: number; left: number }>()
  let byEl = new WeakMap<Element, LeaveRect>()

  /** 容器裡留下的元素（離場中的不算：它們由 freezeLeave 釘在原位）。 */
  function items(): HTMLElement[] {
    const el = toValue(container)
    if (!el) return []
    return Array.from(el.children).filter(
      (c): c is HTMLElement =>
        c instanceof HTMLElement &&
        c.hasAttribute(keyAttr) &&
        !Array.from(c.classList).some((k) => k.endsWith('-leave-active')),
    )
  }

  onBeforeUpdate(() => {
    before = new Map()
    byEl = new WeakMap()
    for (const el of items()) {
      const t = currentTranslate(el)
      const top = el.offsetTop
      const left = el.offsetLeft
      const seen = { top: top + t.y, left: left + t.x, width: el.offsetWidth, height: el.offsetHeight }
      before.set(el.getAttribute(keyAttr)!, { seen, top, left })
      byEl.set(el, seen)
    }
  })

  onUpdated(() => {
    const ms = typeof duration === 'number' ? duration : tokenMs(duration)
    const easing = tokenValue('--ease') || 'ease'
    const moved: { el: HTMLElement; dx: number; dy: number }[] = []
    // 先全部讀完再動，避免讀寫交錯逼瀏覽器反覆重排
    for (const el of items()) {
      const old = before.get(el.getAttribute(keyAttr)!)
      if (!old) continue // 新進場的交給 enter 過渡
      const top = el.offsetTop
      const left = el.offsetLeft
      // 版面位置沒變（打字但篩選結果不變也會重新渲染）：進行中的 FLIP 終點沒變，照跑；從頭起跳會讓卡片頓一下再重新加速
      if (Math.abs(old.left - left) + Math.abs(old.top - top) < 0.5) continue
      moved.push({ el, dx: old.seen.left - left, dy: old.seen.top - top })
    }
    for (const { el, dx, dy } of moved) {
      // jsdom 沒有 getAnimations / animate
      for (const a of el.getAnimations?.() ?? []) if (a.id === FLIP_ID) a.cancel()
      if (!ms || typeof el.animate !== 'function') continue
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }], {
        duration: ms,
        easing,
        composite: 'add',
        id: FLIP_ID,
      })
    }
  })

  return { snapshotOf: (el) => byEl.get(el) }
}
