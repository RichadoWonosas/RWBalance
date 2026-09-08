import { ref } from 'vue'
import { decodeAppearance, defaultTheme, encodeAppearance, type AppearanceSettings } from '../core/domain/theme'
import { getContainer } from '../core/data/indexed-db/repository'

export const appearanceStorageKey = 'rwbalance:last-appearance'
export function readRememberedAppearance(): AppearanceSettings {
  try {
    const packed = localStorage.getItem(appearanceStorageKey)
    if (!packed || !/^[0-9a-z]{1,6}$/.test(packed)) return { ...defaultTheme }
    const value = Number.parseInt(packed, 36)
    if (value > 0x7ffff || (value & 0x1ff) > 359 || ((value >> 9) & 0x1ff) > 359) return { ...defaultTheme }
    return decodeAppearance(packed)
  } catch { return { ...defaultTheme } }
}

export const rememberedAppearance = ref<AppearanceSettings>(readRememberedAppearance())
let selectionVersion = 0

export function rememberAppearance(appearance: AppearanceSettings) {
  selectionVersion++
  const packed = encodeAppearance(appearance)
  rememberedAppearance.value = decodeAppearance(packed)
  try { localStorage.setItem(appearanceStorageKey, packed) } catch { /* Storage may be unavailable; keep the in-memory theme. */ }
}

export async function selectLedgerAppearance(ledgerId: string) {
  const version = ++selectionVersion
  try {
    // Only the public appearance header is used. This does not unlock the ledger.
    const container = await getContainer(ledgerId)
    if (version === selectionVersion) rememberAppearance(decodeAppearance(container?.appearance))
  } catch {
    // Leave the last usable theme in place if local storage cannot be read.
  }
}
