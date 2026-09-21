import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginPlaywright from 'eslint-plugin-playwright'
import pluginVitest from '@vitest/eslint-plugin'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  // legacy/ 是唯讀的行為與設計基準，不參與 lint；
  // .claude/ 底下是平行施工用的 git worktree，不是本專案的原始碼。
  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', 'legacy/**', '**/.claude/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginPlaywright.configs['flat/recommended'],
    files: ['e2e/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*'],
  },

  // 共用原子元件的檔名由 plan §檔案結構 指定（Avatar / Pill），照 plan 保留單字命名。
  {
    name: 'app/common-atoms',
    files: ['src/components/common/{Avatar,Pill}.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },

  skipFormatting,
)
