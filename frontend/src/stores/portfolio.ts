import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import type { Member, PortfolioData, ProjectSummary } from '@/types/models'

/**
 * 資料層：多專案總覽的專案摘要清單與成員名錄的唯一擁有者（契約 E）。
 *
 * 成員名錄有兩份：這裡的 `members` 給總覽用（含各專案的 PM），
 * `member` store 的給 Dashboard 用（單一專案的成員）。總覽元件查成員一律用這裡的 `byId`。
 * 載入狀態不在這裡：`load()` 只回 Promise，狀態由 `usePortfolioBoot` 維護。
 */
export const usePortfolioStore = defineStore('portfolio', () => {
  const projects = ref<ProjectSummary[]>([])
  const members = ref<Member[]>([])
  /** 登入者；接後端時由 adapter 從登入流程填。 */
  const currentUserId = ref('')

  /**
   * 載入整份摘要。給 `data` 就直接套用（測試用，比照 `taskStore.load(data?)`），
   * 否則打 `api.listProjects()`。失敗直接往上拋，舊資料不動。
   */
  async function load(data?: PortfolioData): Promise<void> {
    const next = data ?? (await api.listProjects())
    projects.value = next.projects
    members.value = next.members
    currentUserId.value = next.currentUserId
  }

  /** 依 id 取成員，查不到回 undefined。 */
  function byId(id: string): Member | undefined {
    return members.value.find((m) => m.id === id)
  }

  /** 依 id 取專案摘要，查不到回 undefined。 */
  function projectById(id: string): ProjectSummary | undefined {
    return projects.value.find((p) => p.id === id)
  }

  return { projects, members, currentUserId, load, byId, projectById }
})
