import { describe, expect, it } from 'vitest'
import { addAccount, addTag, addTransactions, addTransactionsWithTags, correctTransaction, createLedger, deleteAccount, deleteTag, directTags, migrateLedgerV1, previewTagParent, projectBalances, resolveAndDeleteTag, restoreAccount, restoreTransaction, reverseTransaction, setTagParent, updateTag, updateTransactionTags, validateLedgerData } from '../../src/core/domain/ledger'
import { expandTagAncestors, rootTagId } from '../../src/core/domain/tag-hierarchy'
import { decryptLedger, encryptLedger } from '../../src/core/security/crypto'
import type { Ledger, TransactionDraft } from '../../src/core/domain/types'

function fixture() {
  const ledger = createLedger('子标签测试'), account = addAccount(ledger, '现金', false, { CNY: 10000, USD: 5000, JPY: 1000 })
  const parent = ledger.tags.find(tag => tag.name === '娱乐')!
  const child = addTag(ledger, '游戏付款', parent.id), leaf = addTag(ledger, '游戏内购买', child.id), sibling = addTag(ledger, '电影', parent.id)
  const draft: TransactionDraft = { kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 100 }, selectedTagIds: [leaf.id, sibling.id], primaryTagId: leaf.id, bookedAt: '2026-09-08', occurredAt: '2026-09-08T12:00:00Z' }
  return { ledger, account, parent, child, leaf, sibling, draft }
}
describe('subtags and schema migration', () => {
  it('expands all ancestors once while preserving explicit order and primary', () => {
    const { ledger, parent, child, leaf, sibling, draft } = fixture()
    const [tx] = addTransactions(ledger, [draft])
    expect(tx?.explicitTagIds).toEqual([leaf.id, sibling.id])
    expect(tx?.selectedTagIds).toEqual([leaf.id, sibling.id, child.id, parent.id])
    expect(rootTagId(ledger.tags, leaf.id)).toBe(parent.id)
    updateTransactionTags(ledger, tx!.id, [sibling.id], sibling.id)
    expect(tx?.selectedTagIds).toEqual([sibling.id, parent.id])
    expect(() => updateTransactionTags(ledger, tx!.id, [sibling.id], parent.id)).toThrow('主标签')
    validateLedgerData(ledger)
  })
  it('reparents all historical and deleted records without changing money, primary or dates', () => {
    const { ledger, parent, child, leaf, draft } = fixture()
    const [tx] = addTransactions(ledger, [draft])
    const corrected = correctTransaction(ledger, tx!.id, { ...draft, sourceMoney: { currency: 'CNY', minorUnits: 200 } })
    reverseTransaction(ledger, corrected.id)
    const before = structuredClone(ledger), balances = projectBalances(ledger)
    const newParent = ledger.tags.find(tag => tag.name === '生活')!
    expect(previewTagParent(ledger, child.id, newParent.id)).toBe(2)
    setTagParent(ledger, child.id, newParent.id)
    expect(projectBalances(ledger)).toEqual(balances)
    ledger.transactions.forEach((record, i) => {
      expect({ ...record, selectedTagIds: [] }).toEqual({ ...before.transactions[i], selectedTagIds: [] })
      if (directTags(record).includes(leaf.id)) expect(record.selectedTagIds).toContain(newParent.id)
    })
    expect(ledger.hierarchyChanges?.at(-1)).toMatchObject({ previousParentId: parent.id, parentId: newParent.id, affectedTransactions: 2 })
    restoreTransaction(ledger, corrected.id)
    validateLedgerData(ledger)
  })
  it('rejects cycles, cross-ledger parents and corrupted derived selections', () => {
    const { ledger, parent, leaf, draft } = fixture()
    for (const [id, parentId] of [[parent.id, parent.id], [parent.id, leaf.id], [leaf.id, 'foreign-id']]) expect(() => setTagParent(ledger, id!, parentId)).toThrow()
    const [tx] = addTransactions(ledger, [draft])
    tx!.selectedTagIds = [...tx!.explicitTagIds!]
    expect(() => validateLedgerData(ledger)).toThrow('祖先标签')
    tx!.selectedTagIds = expandTagAncestors(ledger.tags, tx!.explicitTagIds!)
    parent.parentId = leaf.id
    expect(() => validateLedgerData(ledger)).toThrow('成环')
  })
  it('renames a tag atomically and accepts an equivalent normalized display name', () => {
    const ledger = createLedger('标签重命名')
    const tag = addTag(ledger, 'Game')
    updateTag(ledger, tag.id, 'ＧＡＭＥ')
    expect(tag).toMatchObject({ name: 'ＧＡＭＥ', normalizedName: 'game' })
    const other = addTag(ledger, 'Other')
    expect(() => updateTag(ledger, other.id, 'game')).toThrow('名称已存在')
    expect(other.name).toBe('Other')
    validateLedgerData(ledger)
  })
  it('requires a child disposition and retains descendants on parent deletion', () => {
    const { ledger, parent, child, leaf, draft } = fixture()
    addTransactions(ledger, [draft])
    expect(() => deleteTag(ledger, parent.id)).toThrow('去向')
    deleteTag(ledger, parent.id, { mode: 'promote' })
    expect(child.parentId).toBeUndefined()
    expect(leaf.parentId).toBe(child.id)
    expect(ledger.transactions.at(-1)?.selectedTagIds).not.toContain(parent.id)
    validateLedgerData(ledger)
  })
  it('resolves direct references including previous corrections before moving children', () => {
    const { ledger, parent, child, leaf, draft } = fixture()
    const [tx] = addTransactions(ledger, [{ ...draft, selectedTagIds: [child.id], primaryTagId: child.id }])
    correctTransaction(ledger, tx!.id, { ...draft, selectedTagIds: [child.id, leaf.id], primaryTagId: child.id })
    const refs = ledger.transactions.filter(tx => directTags(tx).includes(child.id))
    expect(() => resolveAndDeleteTag(ledger, child.id, [])).toThrow('尚未处理')
    resolveAndDeleteTag(ledger, child.id, refs.map(tx => ({ transactionId: tx.id, action: 'replace', replacementTagId: parent.id })), { mode: 'promote' })
    expect(leaf.parentId).toBe(parent.id)
    expect(ledger.transactions.some(tx => tx.selectedTagIds.includes(child.id))).toBe(false)
    expect(refs.every(tx => tx.primaryTagId === parent.id)).toBe(true)
    validateLedgerData(ledger)
  })
  it('keeps temporary ancestor tags, rejects cycles atomically and drops unused new tags', () => {
    const { ledger, draft, parent } = fixture()
    const pending = [{ clientId: 'temp:leaf', name: '临时子级', parentId: 'temp:parent' }, { clientId: 'temp:parent', name: '临时父级', parentId: parent.id }, { clientId: 'temp:unused', name: '未使用' }]
    const [tx] = addTransactionsWithTags(ledger, [{ ...draft, selectedTagIds: ['temp:leaf'], primaryTagId: 'temp:leaf' }], pending)
    expect(tx?.selectedTagIds).toHaveLength(3)
    expect(ledger.tags.some(tag => tag.name === '未使用')).toBe(false)
    const before = structuredClone(ledger)
    expect(() => addTransactionsWithTags(ledger, [{ ...draft, selectedTagIds: ['temp:a'], primaryTagId: 'temp:a' }], [{ clientId: 'temp:a', name: 'a', parentId: 'temp:b' }, { clientId: 'temp:b', name: 'b', parentId: 'temp:a' }])).toThrow('成环')
    expect(ledger).toEqual(before)
    validateLedgerData(ledger)
  })
  it('migrates flat v1 with multi-currency and full audit history losslessly and idempotently', async () => {
    const ledger = createLedger('旧账本')
    const account = addAccount(ledger, '现金', false, { CNY: 10000, USD: 5000, GBP: 200, JPY: 300 })
    const [tag, secondary] = ledger.tags
    const draft: TransactionDraft = { kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 100 }, selectedTagIds: [secondary!.id, tag!.id], primaryTagId: tag!.id, bookedAt: '2026-01-01', occurredAt: '2026-01-01T12:00:00Z' }
    const [tx] = addTransactions(ledger, [draft])
    correctTransaction(ledger, tx!.id, draft)
    reverseTransaction(ledger, tx!.id)
    restoreTransaction(ledger, tx!.id)
    deleteAccount(ledger, account.id); restoreAccount(ledger, account.id)
    ledger.schemaVersion = 1; delete ledger.hierarchyChanges
    ledger.transactions.forEach(tx => { delete tx.explicitTagIds })
    const before = structuredClone(ledger), migrated = migrateLedgerV1(ledger)
    expect(ledger).toEqual(before)
    expect(projectBalances(migrated)).toEqual(projectBalances(ledger))
    expect(migrated.tags).toEqual(ledger.tags)
    migrated.transactions.forEach((tx, i) => expect(tx).toEqual({ ...ledger.transactions[i], explicitTagIds: ledger.transactions[i]!.selectedTagIds }))
    expect(migrateLedgerV1(migrated)).toEqual(migrated)
    expect(await decryptLedger(await encryptLedger(migrated, 'passphrase'), 'passphrase')).toEqual(migrated)
    validateLedgerData(migrated)
  })
  it('accepts empty legacy data but refuses unknown schema and malformed references', async () => {
    const ledger = createLedger('空'); ledger.schemaVersion = 1; ledger.tags = []
    expect(migrateLedgerV1(ledger).schemaVersion).toBe(2)
    const future = { ...ledger, schemaVersion: 99 } as unknown as Ledger
    expect(() => validateLedgerData(future)).toThrow('不支持')
    await expect(decryptLedger(await encryptLedger(future, 'passphrase'), 'passphrase')).rejects.toThrow('不支持')
    const malformed = fixture().ledger; malformed.tags[0]!.parentId = 'foreign'
    expect(() => migrateLedgerV1(malformed)).toThrow('父标签不存在')
  })
})
