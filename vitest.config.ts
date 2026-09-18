import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // e2e 用 '**/e2e/**' 而不是 'e2e/**'，'**/.claude/**' 則是為了排掉
      // .claude/worktrees/<id>/ 底下的平行工作區——否則主工作區跑 vitest
      // 會把別的 worktree 的 Playwright spec 當單元測試撿進來。
      exclude: [...configDefaults.exclude, '**/e2e/**', '**/.claude/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
