import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Member } from '@/types/models'

/**
 * 專案成員與「我是誰」。
 * 資料由 taskStore.load() 從 ProjectData 餵進來（contract D：member store 本身不呼叫 api）。
 */
export const useMemberStore = defineStore('member', () => {
  const members = ref<Member[]>([])
  /** 目前登入者；mocks 固定 'm1'，接後端時改由登入流程填。 */
  const currentUserId = ref('')

  /** 依 id 取成員，查不到回 undefined。legacy `member()` :1909 */
  function byId(id: string): Member | undefined {
    return members.value.find((m) => m.id === id)
  }

  return { members, currentUserId, byId }
})
