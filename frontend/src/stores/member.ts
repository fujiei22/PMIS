import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Member } from '@/types/models'

/**
 * 專案成員與「我是誰」。
 * 資料由 taskStore.load() 從 ProjectData 餵進來（成員目前沒有任何寫入 api）。
 */
export const useMemberStore = defineStore('member', () => {
  const members = ref<Member[]>([])
  /** 目前登入者；mocks 固定 'm1'，接後端時由 adapter 從登入流程填（契約 A）。 */
  const currentUserId = ref('')

  /** 載入時整份換掉。 */
  function setAll(list: Member[], me: string): void {
    members.value = list
    currentUserId.value = me
  }

  /** 依 id 取成員，查不到回 undefined。legacy `member()` :1909 */
  function byId(id: string): Member | undefined {
    return members.value.find((m) => m.id === id)
  }

  return { members, currentUserId, setAll, byId }
})
