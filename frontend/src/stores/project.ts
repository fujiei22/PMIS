import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ProjectMeta } from '@/types/models'

/** 還沒載入（或換專案剛清空）時的專案資料：全部空字串，畫面上就是沒有名稱。 */
const EMPTY_META: ProjectMeta = { id: '', name: '', pmId: '' }

/**
 * 目前這個 Dashboard 的專案本身：id、名稱、擁有者，以及登入者能不能改（`canEdit`）。
 * 資料由 taskStore.load() 從 ProjectData 餵進來（目前沒有寫入 api）。
 *
 * `canEdit` 由後端算，前端不自己拿 `meta.pmId` 比對登入者（權限規則只留在後端一處）。
 * 還沒載入時是 false：資料還沒到，不該有任何寫入。
 */
export const useProjectStore = defineStore('project', () => {
  const meta = ref<ProjectMeta>({ ...EMPTY_META })
  const canEdit = ref(false)

  /** 載入時整份換掉。 */
  function setAll(next: ProjectMeta, editable: boolean): void {
    meta.value = { ...next }
    canEdit.value = editable
  }

  /** 換專案時清空，回到還沒載入的樣子。 */
  function reset(): void {
    setAll(EMPTY_META, false)
  }

  return { meta, canEdit, setAll, reset }
})
