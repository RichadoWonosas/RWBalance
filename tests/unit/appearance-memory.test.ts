import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { defaultTheme, encodeAppearance } from '../../src/core/domain/theme'
const { getContainer } = vi.hoisted(() => ({ getContainer: vi.fn() }))
vi.mock('../../src/core/data/indexed-db/repository', () => ({ getContainer }))
import { appearanceStorageKey, readRememberedAppearance, rememberedAppearance, rememberAppearance, selectLedgerAppearance } from '../../src/app/appearance-memory'

let saved: Map<string, string>
beforeEach(() => {
  saved = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) })
  rememberAppearance({ ...defaultTheme })
  getContainer.mockReset()
})
afterEach(() => vi.unstubAllGlobals())
it('stores only compact appearance metadata and tolerates disabled or corrupt storage', () => {
  const appearance = { primaryHue: 12, secondaryHue: 190, colorTone: 'dark' as const }
  rememberAppearance(appearance)
  expect(readRememberedAppearance()).toEqual(appearance)
  expect(saved.get(appearanceStorageKey)).toBe(encodeAppearance(appearance))
  saved.set(appearanceStorageKey, 'not-an-appearance')
  expect(readRememberedAppearance()).toEqual(defaultTheme)
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } })
  expect(readRememberedAppearance()).toEqual(defaultTheme)
  expect(() => rememberAppearance(appearance)).not.toThrow()
})
it('ignores a slow previous selection and a pending selection after creating a ledger', async () => {
  let resolveOld!: (value: unknown) => void
  getContainer.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  const first = selectLedgerAppearance('old')
  const next = { primaryHue: 120, secondaryHue: 180, colorTone: 'dark' as const }
  getContainer.mockResolvedValueOnce({ appearance: encodeAppearance(next) })
  await selectLedgerAppearance('next')
  resolveOld({ appearance: encodeAppearance(defaultTheme) })
  await first
  expect(rememberedAppearance.value).toEqual(next)
  getContainer.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  const pending = selectLedgerAppearance('old')
  rememberAppearance({ ...defaultTheme })
  resolveOld({ appearance: encodeAppearance(next) })
  await pending
  expect(rememberedAppearance.value).toEqual(defaultTheme)
})
