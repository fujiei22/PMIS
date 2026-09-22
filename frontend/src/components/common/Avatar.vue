<script setup lang="ts">
// 成員頭像：圓形色塊 + 名字縮寫；hover 可展開成「縮寫 + 姓名」的膠囊。
import { computed } from 'vue'
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

const style = computed(() => ({
  '--av-size': `${props.size}px`,
  '--av-color': color.value,
  '--av-ring': `${props.ring}px`,
  marginRight: props.overlap ? `${-props.overlap}px` : undefined,
}))
</script>

<template>
  <span
    class="avatar"
    :class="{ expandable }"
    :style="style"
    :title="expandable ? undefined : name"
  >
    <span class="glyph">{{ initial }}</span>
    <span v-if="expandable" class="name">{{ name }}</span>
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

/* legacy 是用 max-width 從 20px 撐到 160px 做展開（:623），且那裡是 content-box */
.expandable {
  box-sizing: content-box;
  max-width: var(--av-size);
  transition:
    max-width var(--t-layout) var(--ease),
    padding-right var(--t-layout) var(--ease);
}

.expandable:hover {
  max-width: 160px;
  padding-right: var(--sp-4);
  z-index: 3;
}
</style>
