import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

export const pwaUpdateReady = ref(false)
export const pwaUpdateInstalling = ref(false)

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined

export function initializePwa() {
  if (updateServiceWorker) return
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      pwaUpdateReady.value = true
    },
    onNeedReload: () => window.location.reload(),
    onRegisterError: (error) => console.error('Service Worker 注册失败', error),
  })
}

export async function applyPwaUpdate() {
  if (!updateServiceWorker || pwaUpdateInstalling.value) return
  pwaUpdateInstalling.value = true
  try {
    await updateServiceWorker(true)
  } catch (error) {
    pwaUpdateInstalling.value = false
    throw error
  }
}
