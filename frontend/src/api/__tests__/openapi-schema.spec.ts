// @vitest-environment node
// openapi-typescript 要 Node 的檔案與 URL 處理，不在 jsdom 裡跑。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript'
import { expect, expectTypeOf, it } from 'vitest'
import type { components } from '@/api/http/schema'
import type { WorkCalendar } from '@/types/models'

/**
 * 守住「`schema.ts` 是由 repo 裡的 `openapi.json` 產生的最新版」。
 *
 * 兩個檔都是產生檔、都進版控：後端匯出 `openapi.json`，`npm run gen:api` 再由它產生
 * `schema.ts`（之後 `src/api/http/` 的 adapter 用它對後端的型別）。這裡用 openapi-typescript
 * 的 Node API 照 `npm run gen:api`（CLI）的做法重新產生一次，跟 repo 裡的 `schema.ts` 一個字都不能差。
 * 後端那一側（程式 → `openapi.json`）由 `backend/tests/test_openapi_snapshot.py` 擋。
 */

const HTTP_DIR = resolve(process.cwd(), 'src/api/http')

it('schema.ts 等於由 openapi.json 重新產生的結果', async () => {
  // CLI 的寫法：COMMENT_HEADER ＋ astToString(openapiTS(檔案 URL))，選項都用預設值。
  const nodes = await openapiTS(pathToFileURL(resolve(HTTP_DIR, 'openapi.json')), { silent: true })
  const generated = COMMENT_HEADER + astToString(nodes)
  const committed = readFileSync(resolve(HTTP_DIR, 'schema.ts'), 'utf8')
  // 失敗訊息寫成單一字串字面值：vitest/valid-expect 只允許第二個參數是字串字面值。
  expect(
    committed,
    'schema.ts 不是由 openapi.json 產生的最新版。改了 API 要依序跑：(1) backend/ 跑 uv run python -m app.scripts.export_openapi (2) frontend/ 跑 npm run gen:api；兩個產物連同程式一起 commit，schema.ts 不要手改',
  ).toBe(generated)
})

/**
 * 前端手寫的 `WorkCalendar`（types/models.ts）要跟後端 OpenAPI 產生的型別一致。
 * 這是型別層的檢查：不一致時 `vue-tsc --build` 會失敗（vitest 執行期不檢查型別）。
 * 不一致時改 models.ts 對齊後端，不手改 schema.ts。
 */
// eslint-disable-next-line vitest/expect-expect -- expectTypeOf 是型別層斷言，由 vue-tsc 檢查；規則只認 expect
it('WorkCalendar 跟後端 OpenAPI 的型別一致', () => {
  expectTypeOf<WorkCalendar>().toEqualTypeOf<components['schemas']['WorkCalendar']>()
})
