<script setup lang="ts">
// 登入頁（`/login`）：網域帳號＋密碼。登入後回到 ?redirect= 的原路徑（沒有就回總覽）。
// 登出、登入失效（401）、沒登入就開頁都會到這裡；掛上時先把前端整個重置（resetSession），
// 舊頁這時已經淡出卸載，下一位登入的人看不到上一位的任何東西。
import { nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { resetSession } from '@/composables/useSession'
import { API_ERROR_TEXT, LOGIN_EMPTY_TEXT, LOGIN_FAIL_TEXT, apiErrorCode } from '@/constants/api'
import { safeRedirect } from '@/lib/redirect'
import { useSessionStore } from '@/stores/session'

resetSession()

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const account = ref('')
const password = ref('')
/** 登入中：按鈕停用、顯示「登入中…」，防止重按送出兩次。 */
const busy = ref(false)
/** 失敗訊息；null = 沒有。 */
const error = ref<string | null>(null)

const accountInput = ref<HTMLInputElement | null>(null)
const passwordInput = ref<HTMLInputElement | null>(null)

onMounted(() => accountInput.value?.focus())

async function submit(): Promise<void> {
  if (busy.value) return
  const name = account.value.trim()
  if (!name || !password.value) {
    error.value = LOGIN_EMPTY_TEXT
    ;(name ? passwordInput : accountInput).value?.focus()
    return
  }
  busy.value = true
  error.value = null
  try {
    const result = await session.login(name, password.value)
    if (result.ok) {
      await router.replace(safeRedirect(route.query.redirect))
      return
    }
    error.value = LOGIN_FAIL_TEXT[result.reason]
    // 帳密錯：清掉密碼重打；帳號留著（多半是密碼打錯）
    if (result.reason === 'invalid') {
      password.value = ''
      await nextTick()
      passwordInput.value?.focus()
    }
  } catch (e) {
    console.error('[api]', '登入', e)
    error.value = API_ERROR_TEXT[apiErrorCode(e)]
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login" data-view="login">
    <form class="card" novalidate @submit.prevent="submit">
      <header class="head">
        <h1 class="title">PMIS</h1>
        <p class="sub">專案管理資訊系統</p>
      </header>

      <label class="field">
        <span class="label">帳號</span>
        <input
          ref="accountInput"
          v-model="account"
          class="input"
          name="username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          placeholder="網域帳號，例：chen_daming"
        />
      </label>

      <label class="field">
        <span class="label">密碼</span>
        <input
          ref="passwordInput"
          v-model="password"
          class="input"
          type="password"
          name="password"
          autocomplete="current-password"
        />
      </label>

      <p v-if="error" class="error" role="alert" data-testid="login-error">{{ error }}</p>

      <button type="submit" class="submit" :disabled="busy">
        {{ busy ? '登入中…' : '登入' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
/* 整頁底色同總覽與 Dashboard；卡片外框照總覽面板（OvPanel）。根元素不寫 opacity / transition（切頁淡入淡出在 base.css） */
.login {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: var(--sp-8);
  background: var(--bg-page);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-8);
  width: 100%;
  max-width: 360px;
  padding: var(--sp-12);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-panel);
}

.head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

/* 字級照頂欄標題（.project）與面板標題的層級 */
.title {
  margin: 0;
  font-size: var(--fs-modal);
  font-weight: var(--fw-bold);
  letter-spacing: -0.01em;
  color: var(--text-1);
}

.sub {
  margin: 0;
  font-size: var(--fs-control);
  color: var(--text-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* 欄位名稱照頂欄的分組標籤（.section） */
.label {
  font-size: var(--fs-date);
  font-weight: var(--fw-bold);
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

/* 輸入框照總覽搜尋框：--ctrl-h、--border-1 框，焦點時 accent 框＋焦點環 */
.input {
  height: var(--ctrl-h);
  padding: 0 var(--sp-6);
  border: 1px solid var(--border-1);
  border-radius: var(--r-input);
  background: var(--surface-1);
  font-size: var(--fs-control);
  color: var(--text-1);
  outline: none;
  transition:
    border-color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.input::placeholder {
  color: var(--text-placeholder);
}

@media (hover: hover) {
  .input:hover {
    border-color: var(--border-control);
  }
}

.input:focus {
  border-color: var(--accent);
  box-shadow: var(--ring-focus);
}

/* 錯誤訊息：同錯誤條的紅（danger 系） */
.error {
  margin: 0;
  padding: var(--sp-4) var(--sp-6);
  border: 1px solid var(--danger-bd);
  border-radius: var(--r-input);
  background: var(--danger-bg);
  color: var(--danger-text);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}

/* 主要按鈕：accent 實心（同留言的送出鈕），登入中停用時轉灰 */
.submit {
  height: var(--ctrl-h);
  border: 0;
  border-radius: var(--r-input);
  background: var(--accent);
  color: var(--surface-1);
  font-size: var(--fs-control);
  font-weight: var(--fw-bold);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

@media (hover: hover) {
  .submit:hover:not(:disabled) {
    background: var(--accent-hover);
  }
}

.submit:disabled {
  background: var(--border-1);
  color: var(--text-placeholder);
  cursor: default;
}

.submit:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
