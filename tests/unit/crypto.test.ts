import { describe, expect, it } from 'vitest'
import { createLedger } from '../../src/core/domain/ledger'
import { decryptLedger, encryptLedger, openLedger, rewrapContainer } from '../../src/core/security/crypto'

describe('encrypted ledger appearance metadata', () => {
  it('stores appearance compactly outside ciphertext and authenticates it', async () => {
    const ledger = createLedger('外观测试')
    ledger.settings.primaryHue = 17
    ledger.settings.secondaryHue = 203
    ledger.settings.colorTone = 'dark'

    const container = await encryptLedger(ledger, 'test-passphrase')
    expect(container.appearance?.length).toBeLessThanOrEqual(4)
    expect(JSON.stringify(container)).not.toContain('primaryHue')
    expect(JSON.stringify(container)).not.toContain('colorTone')

    const restored = await decryptLedger(container, 'test-passphrase')
    expect(restored.settings).toMatchObject({ primaryHue: 17, secondaryHue: 203, colorTone: 'dark' })

    const tampered = { ...container, appearance: container.appearance === '0' ? '1' : '0' }
    await expect(decryptLedger(tampered, 'test-passphrase')).rejects.toThrow('账本损坏')
  })

  it('wraps an independent data key and changes passphrase without rewriting ciphertext', async () => {
    const ledger = createLedger('密钥封装测试')
    const container = await encryptLedger(ledger, 'old-passphrase')
    expect(container.version).toBe(2)
    if (container.version !== 2) throw new Error('expected v2')
    expect(container.encryption.wrappedKey).not.toBe('')
    const changed = await rewrapContainer(container, 'old-passphrase', 'new-passphrase', 'PBKDF2-SHA-512')
    expect(changed.ciphertext).toBe(container.ciphertext)
    expect(changed.encryption.bodyIv).toBe(container.encryption.bodyIv)
    expect(changed.encryption.wrappedKey).not.toBe(container.encryption.wrappedKey)
    await expect(decryptLedger(changed, 'old-passphrase')).rejects.toThrow('口令错误')
    expect((await openLedger(changed, 'new-passphrase')).algorithms.kdf).toBe('PBKDF2-SHA-512')
  })
})
