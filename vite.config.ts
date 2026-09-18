import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// dev server 與 Playwright 共用同一個 port，避免平行子任務互相搶佔。
const DEV_PORT = Number(process.env.PLAYWRIGHT_PORT ?? 5174)

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
  },
})
