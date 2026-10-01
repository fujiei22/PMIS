<script setup lang="ts">
// 寫入失敗的提示條：掛在 TopBar 的 <header> 第二列（契約 C、review M11）。
// 主文是操作名稱、副文是錯誤碼對應的固定中文；server 原文只進 console（review M2）。
// 在文件流裡、不是浮層：出現 / 關閉時高度原地展開 / 收起，下面的內容與 sticky 面板頭（top 跟著頂欄高度）
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
 * 錯誤列已經在畫面上、筆數或 ×N 變了讓它換行 / 少一行時，高度也要補間（進出場的 0fr ↔ 1fr 只管出現與關閉）。
 * 補間寫在裁切層的 height：外層的 0fr ↔ 1fr 是乘在它上面的比例，進場途中內容又變也接得上。
 */
const clipEl = ref<HTMLElement | null>(null)
const barEl = ref<HTMLElement | null>(null)
let fromH = 0
let resize: Animation | undefined

/** 會改變錯誤列內容的東西：筆數（含「還有 N 筆」）與每筆的 ×N。每次都回新陣列，任一項變了就觸發。 */
const content = (): number[] => ui.errors.map((e) => e.count)

watch(
  content,
  () => {
    // 補間中的話量裁切層（看得到的高度），否則量內容本身（進場中裁切層被外層壓扁，量它會少算）
    const el = resize?.playState === 'running' ? clipEl.value : barEl.value
    fromH = el?.getBoundingClientRect().height ?? 0
  },
  { flush: 'pre' },
)

watch(
  content,
  () => {
    const clip = clipEl.value
    const from = fromH
    fromH = 0
    // 剛出現（from 0）或正在關閉（已卸載）交給進出場
    if (!clip || !barEl.value || !from) return
    const to = barEl.value.getBoundingClientRect().height
    // 上一段補間先停：停了裁切層就回到內容高度 to；不停的話它跑完會從舊終點跳到 to
    resize?.cancel()
    if (Math.abs(to - from) < 0.5) return
    const cs = getComputedStyle(document.documentElement)
    const timing = {
      duration: parseDuration(cs.getPropertyValue('--t-panel')),
      easing: cs.getPropertyValue('--ease').trim() || 'ease',
    }
    if (!timing.duration) return
    resize = clip.animate([{ height: `${from}px` }, { height: `${to}px` }], timing)
  },
  { flush: 'post' },
)
</script>

<template>
  <!--
    三層：.error-slot 是單欄 grid，列高 0fr ↔ 1fr 補間、連同透明度做進出場（v-if 拿掉的就是這層）；
    .error-clip 是裁切層，min-height: 0 讓列高能收到 0；.error-bar 是內容本身。
  -->
  <Transition name="errorbar">
    <div v-if="ui.errors.length" :key="round" class="error-slot">
      <div ref="clipEl" class="error-clip">
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
    </div>
  </Transition>
</template>

<style scoped>
/*
 * 平常的列高寫在 :where() 裡（scoped 的屬性選擇器也編進 :where()，特異度 0）：
 * 下面進出場的 .errorbar-enter-from / .errorbar-leave-to（scoped 後 0,2,0）不論寫在前面後面都蓋得過它。
 * 外層也裁切（用 clip 不用 hidden：hidden 會讓它變成捲動容器）：裁切層正在補間高度時會比外層的列高高，
 * 不裁的話多出來的部分會蓋到頂欄下面的頁面內容上。
 */
:where(.error-slot) {
  display: grid;
  grid-template-rows: 1fr;
  overflow: clip;
}

/* 進出場：列高 0fr ↔ 1fr、透明度 0 ↔ 1，時長 --t-panel、曲線 --ease（同面板收合、排序 chip） */
.errorbar-enter-active,
.errorbar-leave-active {
  transition:
    grid-template-rows var(--t-panel) var(--ease),
    opacity var(--t-panel) var(--ease);
}

/* 離場中不攔點擊（同 base.css 的 pop-leave-active）：收起中的 ✕ 不再吃點擊 */
.errorbar-leave-active {
  pointer-events: none;
}

.errorbar-enter-from,
.errorbar-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

.error-clip {
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
