import { onBeforeUpdate, onUpdated, toValue, type MaybeRefOrGetter } from 'vue'

/**
 * 以「相對於容器」的位移做 FLIP 重排動畫，給巢狀在另一個會移動的容器裡的清單用
 * （卡片檢視的欄內卡片、時間軸的群組內專案列）。
 *
 * 為什麼不用 TransitionGroup 內建的 move：它量的是 `getBoundingClientRect()`（頁面上的絕對位置），
 * 外層欄 / 群組自己也在移動時，會把外層的位移再算一次，卡片先跳出去再飄回來。
 * 外層有沒有移動用 index 猜不準（兩欄 grid 裡前一列變矮，後一列整欄上移但 index 不變）。
 * 這裡改量 `offsetTop / offsetLeft`：相對於容器（必須是 `position: relative`），外層怎麼動都不影響。
 *
 * 用法：容器內的 TransitionGroup 設 `move-class` 為沒有定義的 class（停用內建 move），進出場照舊。
 * 時序：本元件的 onBeforeUpdate 在 DOM 更新前記位置；onUpdated 在子元件（TransitionGroup）之後執行，
 * 這時離場元素已被 freezeLeave 釘成 absolute、不佔版面，量到的就是新位置。
 *
 * @param container 清單容器（元素的 offsetParent）
 * @param keyAttr 用來對應新舊元素的屬性名，例如 `data-project`
 * @param duration 過渡時長，CSS 值（用 token，例如 `var(--t-panel)`）
 */
export function useRelativeFlip(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  keyAttr: string,
  duration = 'var(--t-panel)',
): void {
  let before = new Map<string, { x: number; y: number }>()

  /** 容器裡正在留下的元素（離場中的不算，它們已經被釘在原位淡出）。 */
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
    before = new Map(items().map((el) => [el.getAttribute(keyAttr)!, { x: el.offsetLeft, y: el.offsetTop }]))
  })

  onUpdated(() => {
    const moved: { el: HTMLElement; dx: number; dy: number }[] = []
    // 先全部讀完再寫，避免讀寫交錯逼瀏覽器反覆重排
    for (const el of items()) {
      const old = before.get(el.getAttribute(keyAttr)!)
      if (!old) continue // 新進場的元素交給 enter 過渡
      const dx = old.x - el.offsetLeft
      const dy = old.y - el.offsetTop
      if (dx || dy) moved.push({ el, dx, dy })
    }
    if (!moved.length) return

    // Invert：先瞬間移回舊位置
    for (const { el, dx, dy } of moved) {
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    // 強制套用上面的樣式，下一步的 transition 才有起點
    void toValue(container)?.offsetHeight
    // Play：放開 transform，沿過渡回到新位置；結束後清掉 inline 樣式，讓元件自己的 transition 接手
    for (const { el } of moved) {
      el.style.transition = `transform ${duration} var(--ease)`
      el.style.transform = ''
      const done = (e: TransitionEvent): void => {
        if (e.target !== el || e.propertyName !== 'transform') return
        el.style.transition = ''
        el.removeEventListener('transitionend', done)
      }
      el.addEventListener('transitionend', done)
    }
  })
}
