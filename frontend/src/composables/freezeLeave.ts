/**
 * TransitionGroup 的 `@before-leave`：把離場元素釘在它當下的位置與尺寸。
 *
 * 離場元素要設 absolute，其他元素才能立刻開始 FLIP 位移；
 * 但只設 absolute 的話，元素會落到容器內容區的起點（grid 的第一格、flex 的開頭），
 * 看起來像先跳走再淡出。所以連同 top / left / width / height 一起寫死。
 * 父層容器必須是 `position: relative`，offset 才以它為基準。
 */
export function freezeLeave(el: Element): void {
  const node = el as HTMLElement
  // 先讀完四個值再寫，避免讀寫交錯觸發多次 layout
  const { offsetTop, offsetLeft, offsetWidth, offsetHeight } = node
  node.style.position = 'absolute'
  node.style.top = `${offsetTop}px`
  node.style.left = `${offsetLeft}px`
  node.style.width = `${offsetWidth}px`
  node.style.height = `${offsetHeight}px`
}
