import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createLedger } from '../../src/core/domain/ledger'
import { decryptLedger, encryptLedger } from '../../src/core/security/crypto'
import { getContainer, getLedgerRecovery, restoreLedgerRecovery, saveLedger } from '../../src/core/data/indexed-db/repository'

describe('encrypted IndexedDB repository', () => {
  it('keeps and atomically swaps the previous encrypted container', async () => {
    const ledger = createLedger(`恢复测试-${crypto.randomUUID()}`)
    const first = await encryptLedger(ledger, 'repository-passphrase')
    const index = { ledgerId: ledger.id, displayName: ledger.name, normalizedName: ledger.name.toLocaleLowerCase(), containerVersion: first.version, updatedAt: ledger.updatedAt }
    await saveLedger(first, index)
    ledger.name = `${ledger.name}-新版`
    ledger.updatedAt = new Date(Date.now() + 1000).toISOString()
    const second = await encryptLedger(ledger, 'repository-passphrase')
    await saveLedger(second, { ...index, displayName: ledger.name, normalizedName: ledger.name.toLocaleLowerCase(), containerVersion: second.version, updatedAt: ledger.updatedAt })
    expect((await getLedgerRecovery(ledger.id))?.container).toEqual(first)
    await restoreLedgerRecovery(ledger.id)
    expect((await decryptLedger((await getContainer(ledger.id))!, 'repository-passphrase')).name).not.toContain('新版')
    expect((await getLedgerRecovery(ledger.id))?.container).toEqual(second)
  })
})
