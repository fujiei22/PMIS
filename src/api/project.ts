import { sampleProject } from '@/mocks/sampleProject'
import type { ProjectData } from '@/types/models'

/**
 * 取得專案資料。
 * 目前回傳 mocks 的深拷貝（拷貝是為了讓 store 改資料時不污染 mocks，測試才能重複跑）。
 * 接後端時只換這支：改成 fetch，並在這裡把 null 之類的空值正規化成 ''。
 */
export async function loadProject(): Promise<ProjectData> {
  return structuredClone(sampleProject)
}
