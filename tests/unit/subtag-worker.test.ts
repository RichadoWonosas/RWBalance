import 'fake-indexeddb/auto'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { addAccount, addTransactions, createLedger } from '../../src/core/domain/ledger'
import { EXCHANGE_PRIMARY_TAG_ID, exchangeExpenseTagId } from '../../src/core/domain/statistics'
import { decryptLedger, encryptLedger } from '../../src/core/security/crypto'
import * as repository from '../../src/core/data/indexed-db/repository'
import type { LedgerWorkerCommand, LedgerWorkerResponse, LedgerWorkerResult } from '../../src/worker/protocol'

let sequence = 0
const replies = new Map<number, { resolve: (value: LedgerWorkerResult) => void; reject: (error: Error) => void }>()
const scope = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined, postMessage(response: LedgerWorkerResponse) {
  const pending = replies.get(response.id)!
  replies.delete(response.id)
  if (response.ok) pending.resolve(response.result)
  else pending.reject(new Error(response.error))
} }
beforeAll(async () => { vi.stubGlobal('self', scope); await import('../../src/worker/ledger.worker') })
afterEach(() => vi.restoreAllMocks())
function request(command: LedgerWorkerCommand) {
  return new Promise<LedgerWorkerResult>((resolve, reject) => { const id = ++sequence; replies.set(id, { resolve, reject }); scope.onmessage!({ data: { id, command } }) })
}
async function legacy(save = true) {
  const ledger = createLedger('旧账本-' + crypto.randomUUID())
  const account = addAccount(ledger, '现金', false, { CNY: 1000 })
  const tag = ledger.tags[0]!
  addTransactions(ledger, [{ kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 100 }, selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2026-09-08' }])
  ledger.schemaVersion = 1; delete ledger.hierarchyChanges; ledger.transactions.forEach(tx => { delete tx.explicitTagIds })
  const container = await encryptLedger(ledger, 'test-passphrase')
  const index = { ledgerId: ledger.id, displayName: ledger.name, normalizedName: ledger.name, containerVersion: container.version, updatedAt: ledger.updatedAt }
  if (save) await repository.saveLedger(container, index)
  return { ledger, container, index }
}
describe('Worker migration and hierarchy trust boundary', () => {
  it('previews without data access or writes; upgrades only after confirmation; reopens v2 normally', async () => {
    const { ledger, container } = await legacy()
    const preview = await request({ type: 'unlock', ledgerId: ledger.id, secret: 'test-passphrase' })
    expect(preview.migrationInfo).toMatchObject({ tags: 5, transactions: 5 })
    expect(preview.view).toBeUndefined()
    expect(await repository.getContainer(ledger.id)).toEqual(container)
    await expect(request({ type: 'add-tag', name: '不能写入' })).rejects.toThrow('未解锁')
    const opened = await request({ type: 'unlock', ledgerId: ledger.id, secret: 'test-passphrase', confirmMigration: true })
    expect(opened.view?.hasMigrationBackup).toBe(true)
    expect(await repository.getMigrationBackup(ledger.id)).toEqual(container)
    await request({ type: 'add-tag', name: '新标签' })
    expect(await repository.getMigrationBackup(ledger.id)).toEqual(container)
    await request({ type: 'lock' })
    expect((await request({ type: 'unlock', ledgerId: ledger.id, secret: 'test-passphrase' })).migrationInfo).toBeUndefined()
    const current = await decryptLedger((await repository.getContainer(ledger.id))!, 'test-passphrase')
    expect(current.schemaVersion).toBe(2)
    // The shipped old client's explicit version guard rejects v2, never downgrades it.
    expect(current.schemaVersion === (1 as number)).toBe(false)
  })
  it('keeps the original encrypted data on quota errors and retries safely', async () => {
    const { ledger, container } = await legacy()
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'migration') throw new DOMException('模拟空间不足', 'QuotaExceededError')
      return original.apply(this, args)
    })
    await expect(request({ type: 'unlock', ledgerId: ledger.id, secret: 'test-passphrase', confirmMigration: true })).rejects.toThrow('空间不足')
    expect(await repository.getContainer(ledger.id)).toEqual(container)
    expect(await repository.getLedgerRecovery(ledger.id)).toBeUndefined()
    expect(await repository.getMigrationBackup(ledger.id)).toBeUndefined()
    vi.restoreAllMocks()
    expect((await request({ type: 'unlock', ledgerId: ledger.id, secret: 'test-passphrase', confirmMigration: true })).view).toBeDefined()
  })
  it('uses the same migration gate for import, copy and v1 recovery', async () => {
    const { ledger, container } = await legacy(false)
    const command = { type: 'import', text: JSON.stringify(container), secret: 'test-passphrase', mode: 'new' } as const
    expect((await request(command)).migrationInfo).toBeDefined()
    expect(await repository.getContainer(ledger.id)).toBeUndefined()
    await request({ ...command, confirmMigration: true })
    expect((await decryptLedger((await repository.getContainer(ledger.id))!, 'test-passphrase')).schemaVersion).toBe(2)
    const copy = await request({ ...command, mode: 'copy', confirmMigration: true })
    const copied = copy.indexes!.find(entry => entry.displayName.startsWith(ledger.name + '（副本）'))!
    expect(copied.ledgerId).not.toBe(ledger.id)
    expect(await repository.getMigrationBackup(copied.ledgerId)).toEqual(container)
    // Local upgrade places v1 in recovery. Restoring it also needs confirmation.
    const local = await legacy()
    await request({ type: 'unlock', ledgerId: local.ledger.id, secret: 'test-passphrase', confirmMigration: true })
    const before = await repository.getContainer(local.ledger.id)
    expect((await request({ type: 'restore-recovery', secret: 'test-passphrase' })).migrationInfo).toBeDefined()
    expect(await repository.getContainer(local.ledger.id)).toEqual(before)
    expect((await request({ type: 'restore-recovery', secret: 'test-passphrase', confirmMigration: true })).view?.hasMigrationBackup).toBe(true)
    expect((await decryptLedger((await repository.getContainer(local.ledger.id))!, 'test-passphrase')).schemaVersion).toBe(2)
  })
  it('rejects forged parent changes, preserves session on failure and counts ancestors once', async () => {
    const created = await request({ type: 'create', name: 'Worker-' + crypto.randomUUID(), secret: 'test-passphrase' })
    const parent = created.view!.tags.find(tag => tag.name === '娱乐')!
    let result = await request({ type: 'add-tag', name: '子一', parentId: parent.id })
    const child = result.view!.tags.find(tag => tag.name === '子一')!
    result = await request({ type: 'add-tag', name: '子二', parentId: parent.id })
    const sibling = result.view!.tags.find(tag => tag.name === '子二')!
    for (const parentId of [parent.id, child.id, 'foreign']) await expect(request({ type: 'set-tag-parent', tagId: parent.id, parentId })).rejects.toThrow()
    result = await request({ type: 'add-account', name: '现金', isPendingSpend: false, initial: { CNY: 1000 } })
    const account = result.view!.accounts[0]!
    result = await request({ type: 'add-transactions', drafts: [{ kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 100 }, selectedTagIds: [child.id, sibling.id], primaryTagId: child.id, bookedAt: new Date().toISOString().slice(0, 10) }] })
    expect(result.view!.tagStats.included.CNY.find(row => row.tagId === parent.id)?.minorUnits).toBe(100)
    const container = await repository.getContainer(result.view!.id)
    vi.spyOn(repository, 'saveLedger').mockRejectedValueOnce(new Error('模拟写入中断'))
    await expect(request({ type: 'set-tag-parent', tagId: child.id })).rejects.toThrow('写入中断')
    expect(await repository.getContainer(result.view!.id)).toEqual(container)
    result = await request({ type: 'set-auto-lock', seconds: 300 })
    expect(result.view!.tags.find(tag => tag.id === child.id)?.parentId).toBe(parent.id)
  })
  it('includes both sides of currency exchange in totals and derives hidden spending tags', async () => {
    let result = await request({ type: 'create', name: '换汇统计-' + crypto.randomUUID(), secret: 'test-passphrase' })
    result = await request({ type: 'add-account', name: '多币种钱包', isPendingSpend: false, initial: { CNY: 100_000, JPY: 0 } })
    const account = result.view!.accounts[0]!
    result = await request({ type: 'add-transactions', drafts: [{
      kind: 'transfer',
      sourceAccountId: account.id,
      sourceMoney: { currency: 'CNY', minorUnits: 50_000 },
      destinationAccountId: account.id,
      destinationMoney: { currency: 'JPY', minorUnits: 10_000 },
      bookedAt: new Date().toISOString().slice(0, 10),
    }] })

    expect(result.view!.totals.CNY.expense).toBe(50_000)
    expect(result.view!.totals.JPY.income).toBe(10_000)
    expect(result.view!.tagStats.primary.CNY).toContainEqual({ tagId: EXCHANGE_PRIMARY_TAG_ID, minorUnits: 50_000 })
    expect(result.view!.tagStats.included.CNY).toContainEqual({ tagId: exchangeExpenseTagId('JPY'), minorUnits: 50_000 })
    expect(result.view!.tags.some(tag => tag.id.startsWith('__'))).toBe(false)
  })
})
