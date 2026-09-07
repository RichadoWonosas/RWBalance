import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateServiceWorker = vi.fn(async () => undefined)
let registrationOptions: { onNeedRefresh?: () => void } | undefined
vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn((options) => {
    registrationOptions = options
    return updateServiceWorker
  }),
}))

import { applyPwaUpdate, initializePwa, pwaUpdateInstalling, pwaUpdateReady } from '../../src/app/pwa'

describe('PWA updates', () => {
  beforeEach(() => {
    pwaUpdateReady.value = false
    pwaUpdateInstalling.value = false
    updateServiceWorker.mockClear()
  })

  it('offers and applies a waiting Service Worker update', async () => {
    initializePwa()
    registrationOptions?.onNeedRefresh?.()
    expect(pwaUpdateReady.value).toBe(true)
    await applyPwaUpdate()
    expect(pwaUpdateInstalling.value).toBe(true)
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })
})
