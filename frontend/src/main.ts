import './assets/tokens.css'
import './assets/base.css'
import './assets/overview-motion.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { preloadLateGlyphs } from './lib/fontPreload'
import router from './router'

// 互動後才第一次出現的符號（甘特收合鈕的 ▶）所在的字型子集先載起來，第一次收合時才不會整頁重排（J2）
preloadLateGlyphs()

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
