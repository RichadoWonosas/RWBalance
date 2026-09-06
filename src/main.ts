import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './app/router'
import { useLedgerStore } from './modules/ledger/session'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
router.beforeEach((to) => {
  const session = useLedgerStore(pinia)
  if (to.name !== 'login' && !session.isUnlocked) return { name: 'login' }
  if (to.name === 'login' && session.isUnlocked) return { name: 'dashboard' }
})
app.use(router).mount('#app')
