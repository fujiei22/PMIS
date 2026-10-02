<script setup lang="ts">
// 總覽頂欄右端的登入者：名字、角色、頭像，點了展開選單（decisions Q10：入口都放這裡）。
// 選單目前只有「登出」；回收桶（F5）與匯入專案（F6）的畫面做好時各自加在「登出」上面。
// 開關是這個元件自己的狀態（只有它用得到）；點外面或按 Esc 關（useDismiss，同總覽其他浮層）。
import { computed, ref } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import { useDismiss } from '@/composables/useDismiss'
import { useSession } from '@/composables/useSession'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSessionStore } from '@/stores/session'
import type { Member } from '@/types/models'

const portfolio = usePortfolioStore()
const session = useSessionStore()
const { logout } = useSession()

/**
 * 顯示的登入者：名錄載到了用名錄那一筆（頭像有成員色）；名錄還沒到（載入中、載入失敗）就用 session 的
 * 名字與角色、頭像先用灰色，登出選單才一直點得到。兩邊都沒有（還沒登入）就不顯示。
 */
const me = computed<Member | null>(() => {
  const s = session.info
  const found = portfolio.byId(s?.memberId ?? portfolio.currentUserId)
  if (found) return found
  if (!s) return null
  return {
    id: s.memberId,
    name: s.name,
    role: s.role,
    color: 'var(--text-placeholder)',
    active: true,
  }
})

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)

useDismiss(
  root,
  () => open.value,
  () => {
    open.value = false
  },
  trigger,
)

/** 登出中：選項停用，連點不會送兩次。 */
const leaving = ref(false)

async function onLogout(): Promise<void> {
  if (leaving.value) return
  leaving.value = true
  open.value = false
  try {
    await logout()
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <div v-if="me" ref="root" class="user-menu">
    <button
      ref="trigger"
      type="button"
      class="me"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="`${me.name}的選單`"
      data-testid="user-menu"
      @click="open = !open"
    >
      <span class="me-name">{{ me.name }}</span>
      <span class="me-role">{{ me.role }}</span>
      <Avatar class="me-av" :member="me" :size="30" />
    </button>
    <!-- 進出場用 base.css 的 pop（同總覽的下拉 OvDropdown） -->
    <Transition name="pop">
      <div v-if="open" class="menu" role="menu">
        <button type="button" class="item" role="menuitem" :disabled="leaving" @click="onLogout">
          登出
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.user-menu {
  position: relative;
  flex: 0 0 auto;
}

/*
 * 外觀維持原本的登入者區塊（名字、角色、頭像），只多 hover 底色與焦點環：
 * 內距用負外距抵掉，版面寬高跟原本一樣（頂欄的排列與 e2e 量的位置不變）。
 */
.me {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin: calc(-1 * var(--sp-1)) calc(-1 * var(--sp-3));
  padding: var(--sp-1) var(--sp-3);
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著 */
@media (hover: hover) {
  .me:hover {
    background: var(--surface-3);
  }
}

.me[aria-expanded='true'] {
  background: var(--surface-3);
}

.me:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.me-name {
  font-size: var(--fs-control);
  font-weight: var(--fw-medium);
  color: var(--text-2);
}

.me-role {
  font-size: var(--fs-date);
  color: var(--text-muted);
}

/* 30px 頭像的縮寫字放大一階（B2 .avatar.lg） */
.me-av :deep(.glyph) {
  font-size: var(--fs-control);
}

/* 面板照 OvDropdown 的 .dd-menu：右緣對齊、往左展開（登入者在頂欄最右端） */
.menu {
  position: absolute;
  top: calc(100% + var(--sp-2));
  right: 0;
  z-index: 100;
  min-width: 150px;
  padding: var(--sp-2);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
}

/* 選項照 OvDropdown 的 .dd-item */
.item {
  display: flex;
  align-items: center;
  width: 100%;
  height: var(--dd-item-h);
  padding: 0 var(--sp-4);
  border: 0;
  border-radius: var(--r-control);
  background: transparent;
  font: inherit;
  font-size: var(--fs-control);
  color: var(--text-2);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

@media (hover: hover) {
  .item:hover:not(:disabled) {
    background: var(--surface-3);
  }
}

.item:disabled {
  color: var(--text-placeholder);
  cursor: default;
}

.item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
