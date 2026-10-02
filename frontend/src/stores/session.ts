import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import type { LoginResult } from '@/api/types'
import type { SessionInfo } from '@/types/models'

/**
 * 資料層：目前登入的是誰（`api.getSession()`）。
 *
 * 只給導頁（登入守衛，`router/index.ts`）與畫面顯示用；權限一律由後端判斷，前端不拿它做授權。
 * 登出 / 401 之後的整頁重置不在這裡（資料層不認識派生層），在 `composables/useSession.ts`。
 */
export const useSessionStore = defineStore('session', () => {
  /** 登入中的人；null = 沒登入或還不知道（看 `checked`）。 */
  const info = ref<SessionInfo | null>(null)
  /** 問過後端了沒。登入守衛只在 false 時打 `getSession()`，之後的導航直接看 `info`。 */
  const checked = ref(false)
  /**
   * 請求序號：問到一半就登入 / 登出 / 重置了，那一發晚回來的結果不能蓋掉新的狀態
   * （例：剛登出，還在飛的 getSession 回來說「已登入」）。
   */
  let seq = 0

  /** 問後端現在是誰登入。失敗（連不上）直接往上拋、狀態不動，`checked` 留 false，下次導航再問。 */
  async function load(): Promise<void> {
    const ticket = ++seq
    const next = await api.getSession()
    if (ticket !== seq) return
    info.value = next
    checked.value = true
  }

  /** 登入；成功就記下登入者。失敗原因原樣回給登入頁顯示，連不上之類的意外照樣拋 `ApiError`。 */
  async function login(account: string, password: string): Promise<LoginResult> {
    const ticket = ++seq
    const result = await api.login(account, password)
    if (result.ok && ticket === seq) {
      info.value = { ...result.session }
      checked.value = true
    }
    return result
  }

  /**
   * 登出。後端失敗（連不上）也當成登出：畫面照樣回登入頁，之後的導航會再問一次後端
   * （session 若還在，後端會說還登入著）。
   */
  async function logout(): Promise<void> {
    ++seq
    info.value = null
    checked.value = false
    try {
      await api.logout()
    } catch (error) {
      console.error('[api]', '登出', error)
    }
  }

  /** 回到還沒問過後端的樣子（整頁重置與 401 時用）；還在飛的 `load()` / `login()` 結果作廢。 */
  function clear(): void {
    ++seq
    info.value = null
    checked.value = false
  }

  return { info, checked, load, login, logout, clear }
})
