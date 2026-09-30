<script setup lang="ts">
// 成員頭像：圓形色塊 + 名字縮寫；hover 可展開成「縮寫 + 姓名」的膠囊。
import { computed, ref } from 'vue'
import { initialOf } from '@/lib/color'
import type { Member } from '@/types/models'

const props = withDefaults(
  defineProps<{
    /** 成員；查不到時 initialOf 回 '?'、色用灰。 */
    member?: Member
    /** 直徑（px）。legacy 用到 18 / 20 / 28 三種。 */
    size?: number
    /** hover 時往右展開顯示姓名（看板卡片與 Issue 卡片的負責人列）。 */
    expandable?: boolean
    /** 白色外框寬度；0 代表不畫。頭像疊在一起時 legacy 用 2px。 */
    ring?: number
    /** 疊放時往左收的負 margin（px）。 */
    overlap?: number
  }>(),
  { size: 20, expandable: false, ring: 0, overlap: 0 },
)

const initial = computed(() => initialOf(props.member))
/** 成員色來自資料，不是 token，所以走 :style。legacy `m.color`（:2742） */
const color = computed(() => props.member?.color ?? 'var(--text-placeholder)')
const name = computed(() => props.member?.name ?? '')

const glyphEl = ref<HTMLElement | null>(null)
const nameEl = ref<HTMLElement | null>(null)
/**
 * hover 展開的目標寬：縮寫 + 姓名的實際寬（上限 160px 同 legacy :623）。
 * 目標若寫死 160px 而內容只有約 50px：展開時可見的變化擠在過渡的前三成（像一下衝完），
 * 收合時前四成都在縮看不見的部分（像空等）（G14）。進入時才量：姓名可能改過。
 */
const openWidth = ref<number | null>(null)
function measureOpen(): void {
  if (!props.expandable || !glyphEl.value || !nameEl.value) return
  openWidth.value = glyphEl.value.offsetWidth + nameEl.value.offsetWidth
}

const style = computed(() => ({
  '--av-size': `${props.size}px`,
  '--av-color': color.value,
  '--av-ring': `${props.ring}px`,
  '--av-open': openWidth.value === null ? undefined : `${openWidth.value}px`,
  marginRight: props.overlap ? `${-props.overlap}px` : undefined,
}))
</script>

<template>
  <span
    class="avatar"
    :class="{ expandable }"
    :style="style"
    :title="expandable ? undefined : name"
    @mouseenter="measureOpen"
  >
    <span ref="glyphEl" class="glyph">{{ initial }}</span>
    <span v-if="expandable" ref="nameEl" class="name">{{ name }}</span>
  </span>
</template>

<style scoped>
.avatar {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  height: var(--av-size);
  border-radius: var(--r-pill);
  background: var(--av-color);
  color: var(--surface-1);
  border: var(--av-ring) solid var(--surface-1);
  /* 一般頭像連白框一起算進直徑（legacy :76 吃全域 border-box） */
  box-sizing: border-box;
  overflow: hidden;
}

.glyph {
  width: var(--av-size);
  flex: 0 0 var(--av-size);
  height: var(--av-size);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
}

/* 不展開的頭像：整顆連白框就是 --av-size 寬（legacy :76 / :1017 是
   `width:20px;height:20px;border:2px solid #fff` 吃全域 border-box）。
   少了這一條，白框會加在 --av-size 外面，直徑多出 2×ring。 */
.avatar:not(.expandable) {
  width: var(--av-size);
}

.avatar:not(.expandable) .glyph {
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
}

.name {
  font-size: var(--fs-pill);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  padding-left: var(--sp-1);
}

/* 用 max-width 過渡做展開，同 legacy（:623，content-box）；legacy 是撐到 160px，
   這裡撐到 mouseenter 量到的縮寫 + 姓名寬（--av-open，上限一樣 160px），
   寬度變化才會平均分布在整段過渡裡（G14）。還沒量過時退回 160px。 */
.expandable {
  box-sizing: content-box;
  max-width: var(--av-size);
  transition:
    max-width var(--t-layout) var(--ease),
    padding-right var(--t-layout) var(--ease);
}

.expandable:hover {
  max-width: min(var(--av-open, 160px), 160px);
  padding-right: var(--sp-4);
  z-index: 3;
}
</style>
