<script setup lang="ts">
// 寫入失敗的提示條：掛在 TopBar 的 <header> 第二列（契約 C、review M11）。
// 主文是操作名稱、副文是錯誤碼對應的固定中文；server 原文只進 console（review M2）。
// 在文件流裡、不是浮層：出現 / 關閉 / 換行時高度原地展開 / 收起，下面的內容與 sticky 面板頭（top 跟著頂欄高度）
// 逐幀被推開 / 收回，不是一幀跳 40px（動畫稽核 G11 / D14）。
import { computed, ref, watch } from 'vue'
import { API_ERROR_TEXT } from '@/constants/api'
import { parseDuration } from '@/lib/easing'
import { useUiStore } from '@/stores/ui'

/** 畫面最多列幾筆，其餘收成「還有 N 筆」。契約 C */
const MAX_SHOWN = 3

const ui = useUiStore()
const shown = computed(() => ui.errors.slice(0, MAX_SHOWN))
const rest = computed(() => Math.max(0, ui.errors.length - MAX_SHOWN))

/**
 * 每次從「沒有錯誤」變成「有錯誤」換一個 key：收起途中又來一筆時，收到一半的那條照樣收完、新的另外展開，頁面高度連續。
 * 同一個 key 的話，Vue 在同 key 的元素重新進場時會當場拿掉離場中的舊元素，收到一半的高度一幀掉到 0。
 */
const round = ref(0)
watch(
  () => ui.errors.length > 0,
  (on) => {
    if (on) round.value++
  },
)

/**
 * 進場、離場、換行三種高度變化走同一條：在外層（.error-slot）用 Web Animations 補間 height 與透明度，
 * 每次都從畫面上看得到的高度與透明度起步，中途接手（進場途中又換行、少一行途中關掉最後一筆）也接得上。
 * 不用 grid 0fr ↔ 1fr：裡面一層被補間寫上 px 高度時，它的最小貢獻就是那個 px，外層的 0fr 收不下去，
 * 補間跑完才一幀掉到插值的位置。
 */
interface Look {
  /** 高度（px） */
  h: number
  /** 透明度 */
  o: number
}

/** 每個 slot 正在跑的補間與它的終點（離場中的舊 slot 與新的並存時各管各的）。 */
const motions = new WeakMap<Element, { anim: Animation; to: number }>()

/** 畫面上看得到的高度與透明度（補間中就是補間當下的值）。 */
function looks(el: HTMLElement): Look {
  const o = parseFloat(getComputedStyle(el).opacity)
  return { h: el.getBoundingClientRect().height, o: Number.isNaN(o) ? 1 : o }
}

/**
 * 把 slot 從 from 補到 to，取代它正在跑的補間；補完（或被下一段接手）呼叫 done。
 * 時長 --t-panel、曲線 --ease（同面板收合、排序 chip）；讀不到時長就不補、直接 done。
 */
function tween(
  el: HTMLElement,
  from: Look,
  to: Look,
  done?: () => void,
  fill: FillMode = 'none',
): void {
  // 上一段先停：from 已經量好了，停了之後同一個 task 裡就接上新的一段，中間不會畫出一幀
  motions.get(el)?.anim.cancel()
  motions.delete(el)
  const cs = getComputedStyle(document.documentElement)
  const duration = parseDuration(cs.getPropertyValue('--t-panel'))
  if (!duration) {
    done?.()
    return
  }
  const anim = el.animate(
    [
      { height: `${from.h}px`, opacity: from.o },
      { height: `${to.h}px`, opacity: to.o },
    ],
    { duration, easing: cs.getPropertyValue('--ease').trim() || 'ease', fill },
  )
  motions.set(el, { anim, to: to.h })
  const end = (): void => {
    if (motions.get(el)?.anim === anim) motions.delete(el)
    done?.()
  }
  anim.onfinish = end
  anim.oncancel = end
}

/** 進場：剛插入、還沒補間，量到的就是內容高度；從 0 展開。 */
function onEnter(el: Element, done: () => void): void {
  const slot = el as HTMLElement
  tween(slot, { h: 0, o: 0 }, { h: slot.getBoundingClientRect().height, o: 1 }, done)
}

/**
 * 離場：從看得到的高度與透明度（可能還在進場或換行的補間中）收到 0。
 * 補完停在 0（fill）直到 Vue 拿掉它，不會先彈回內容高度一幀。
 */
function onLeave(el: Element, done: () => void): void {
  const slot = el as HTMLElement
  // 離場中不攔點擊（同 base.css 的 pop-leave-active）：收起中的 ✕ 不再吃點擊
  slot.style.pointerEvents = 'none'
  tween(slot, looks(slot), { h: 0, o: 0 }, done, 'forwards')
}

/**
 * 已經在畫面上、筆數或 ×N 變了讓它換行 / 少一行：pre 量看得到的樣子，post 量新的內容高度，從看得到的補過去。
 * 進場途中換行也走這裡（接手進場的補間，透明度從當下接到 1）。
 */
const slotEl = ref<HTMLElement | null>(null)
const barEl = ref<HTMLElement | null>(null)
let before: Look | null = null

/** 會改變錯誤列內容的東西：筆數（含「還有 N 筆」）與每筆的 ×N。每次都回新陣列，任一項變了就觸發。 */
const content = (): number[] => ui.errors.map((e) => e.count)

watch(
  content,
  () => {
    before = slotEl.value ? looks(slotEl.value) : null
  },
  { flush: 'pre' },
)

watch(
  content,
  () => {
    const slot = slotEl.value
    const from = before
    before = null
    // 剛出現（pre 時還沒有 slot，交給進場）或正在關閉（slot 已卸載，交給離場）
    if (!slot || !barEl.value || !from) return
    const to = barEl.value.getBoundingClientRect().height
    // 正在補的終點（沒在補就是看得到的高度）已經是新高度：內容變了但高度沒變，照原本的補間走完
    if (Math.abs(to - (motions.get(slot)?.to ?? from.h)) < 0.5) return
    tween(slot, from, { h: to, o: 1 })
  },
  { flush: 'post' },
)
</script>

<template>
  <!--
    兩層：.error-slot 是補間高度與透明度的那層（v-if 拿掉的就是它，裁掉補間中比內容矮的部分）；
    .error-bar 是內容本身。進出場由上面的 onEnter / onLeave 補間，不用 CSS 過渡。
  -->
  <Transition :css="false" @enter="onEnter" @leave="onLeave">
    <div v-if="ui.errors.length" :key="round" ref="slotEl" class="error-slot">
      <!-- 不自動關閉：使用者自己按 ✕（契約 C） -->
      <div ref="barEl" class="error-bar" role="alert" data-errorbar>
        <div v-for="e in shown" :key="e.id" class="error-item">
          <span class="error-label">{{ e.label }}</span>
          <span class="error-code">{{ API_ERROR_TEXT[e.code] }}</span>
          <span v-if="e.count > 1" class="error-count">×{{ e.count }}</span>
          <span class="error-x" role="button" title="關閉" @click="ui.dismissError(e.id)">✕</span>
        </div>
        <div v-if="rest" class="error-rest">還有 {{ rest }} 筆</div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/*
 * 補間高度的那層：裁掉補間中比內容矮的部分（用 clip 不用 hidden：hidden 會讓它變成捲動容器）。
 * min-height: 0：它是頂欄（flex 直排）的項目，不讓 flex 的自動最小高度把它撐回內容高度。
 */
.error-slot {
  min-height: 0;
  overflow: clip;
}

.error-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-10) var(--sp-4);
}

.error-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 26px;
  padding: 0 var(--sp-4) 0 var(--sp-5);
  font-size: var(--fs-control);
  border: 1px solid var(--danger-bd);
  background: var(--danger-bg);
  color: var(--danger-text);
  border-radius: var(--r-control);
}

.error-label {
  font-weight: var(--fw-medium);
}

.error-code {
  color: var(--danger);
  opacity: 0.85;
}

.error-count {
  font-family: var(--font-mono);
}

.error-x {
  cursor: pointer;
  padding: 0 var(--r-2);
  opacity: 0.7;
}

.error-x:hover {
  opacity: 1;
}

.error-rest {
  font-size: var(--fs-control);
  color: var(--danger-text);
}
</style>
