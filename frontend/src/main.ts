import './assets/tokens.css'
import './assets/base.css'
import './assets/overview-motion.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { onUnauthorized } from './api/authEvents'
import { expireSession } from './composables/useSession'
import { preloadLateGlyphs } from './lib/fontPreload'
import router from './router'

// 互動後才第一次出現的符號（甘特收合鈕的 ▶）所在的字型子集先載起來，第一次收合時才不會整頁重排（J2）
preloadLateGlyphs()

const app = createApp(App)

app.use(createPinia())
// 登入失效（api 層遇到 401）：導到登入頁，登入後回原頁。api 層不認識 router，所以在這裡接起來；
// 註冊在 app.use(router) 之前，第一次導航（它會打 api）就接得到
onUnauthorized(() => expireSession(router))
app.use(router)

app.mount('#app')
