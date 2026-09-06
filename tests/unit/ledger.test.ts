import { describe, expect, it } from 'vitest'
import { addAccount, addTag, addTransactions, addTransactionsWithTags, correctTransaction, createLedger, defaultTagNames, deleteAccount, effectiveTransaction, isTransactionDeleted, normalizeName, projectBalances, resolveAndDeleteTag, restoreAccount, restoreTransaction, reverseTransaction, transactionAuditChain, updateAccount, updateTransactionTags, validateLedgerData } from '../../src/core/domain/ledger'
import { decodeAppearance, encodeAppearance, normalizeHue, profileForHue } from '../../src/core/domain/theme'
import { currencyRules, toMinorUnits } from '../../src/core/domain/money'

describe('ledger domain', () => {
  it('normalizes Unicode-compatible names', () => {
    const ledger = createLedger('默认主题')
    expect(normalizeName('  ＦＯＯ ')).toBe('foo')
    expect(ledger.settings).toMatchObject({ primaryHue: 270, secondaryHue: 225, autoLockSeconds: 300 })
    expect(ledger.tags.map((tag) => tag.name)).toEqual([...defaultTagNames])
  })

  it('rejects externally modified data that violates business constraints', () => {
    const ledger = createLedger('外部校验')
    validateLedgerData(ledger)
    const malformed = structuredClone(ledger)
    malformed.tags.push({ ...malformed.tags[0]!, id: crypto.randomUUID() })
    expect(() => validateLedgerData(malformed)).toThrow('标签名称无效或重复')
  })

  it('normalizes arbitrary hues and calibrates their visual profile', () => {
    expect(normalizeHue(721)).toBe(1)
    expect(normalizeHue(-15)).toBe(345)
    expect(profileForHue(45)).toEqual({ saturation: 0.92, lightness: 0.82 })
    const compact = encodeAppearance({ primaryHue: 270, secondaryHue: 210, colorTone: 'dark' })
    expect(compact.length).toBeLessThanOrEqual(4)
    expect(decodeAppearance(compact)).toEqual({ primaryHue: 270, secondaryHue: 210, colorTone: 'dark' })
  })

  it('keeps tag-only edits out of the money audit stream', () => {
    const ledger = createLedger('标签修改')
    const account = addAccount(ledger, '现金', false, { CNY: 10_000 })
    const first = ledger.tags.find((tag) => tag.name === '饮食')!
    const second = ledger.tags.find((tag) => tag.name === '生活')!
    const [transaction] = addTransactions(ledger, [{ kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 1_000 }, selectedTagIds: [first.id], primaryTagId: first.id, bookedAt: '2026-09-07' }])
    const count = ledger.transactions.length
    updateTransactionTags(ledger, transaction!.id, [second.id, first.id], second.id)
    expect(ledger.transactions).toHaveLength(count)
    expect(transaction).toMatchObject({ selectedTagIds: [second.id, first.id], primaryTagId: second.id })
  })

  it('creates atomic correction groups and follows continuous audit history', () => {
    const ledger = createLedger('连续更正')
    const account = addAccount(ledger, '现金', false, { CNY: 10_000 })
    const tag = ledger.tags.find((item) => item.name === '饮食')!
    const [root] = addTransactions(ledger, [{ kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 8_000 }, selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2026-09-01' }])
    const first = correctTransaction(ledger, root!.id, { kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 6_000 }, selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2099-01-01' })
    expect(first.bookedAt).toBe('2026-09-01')
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(4_000)
    const second = correctTransaction(ledger, first.id, { kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 7_000 }, selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2099-01-01' })
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(3_000)
    expect(effectiveTransaction(ledger, root!.id)?.id).toBe(second.id)
    expect(isTransactionDeleted(ledger, root!.id)).toBe(false)
    expect(transactionAuditChain(ledger, root!.id)).toHaveLength(5)
    expect(() => correctTransaction(ledger, second.id, { kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 11_000 }, selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2026-09-01' })).toThrow('余额不足')
  })

  it('deletes and restores the latest corrected value', () => {
    const ledger = createLedger('更正后删除')
    const account = addAccount(ledger, '现金', false, { CNY: 10_000 })
    const tag = ledger.tags[1]!
    const [root] = addTransactions(ledger, [{ kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 2_000 }, selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2026-09-01' }])
    const replacement = correctTransaction(ledger, root!.id, { kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 3_000 }, selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2026-09-01' })
    reverseTransaction(ledger, replacement.id)
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(10_000)
    expect(isTransactionDeleted(ledger, root!.id)).toBe(true)
    restoreTransaction(ledger, replacement.id)
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(7_000)
    expect(isTransactionDeleted(ledger, root!.id)).toBe(false)
  })

  it('applies centralized currency precision, half-up rounding and limits', () => {
    expect(toMinorUnits('1.235', 'CNY')).toBe(124)
    expect(toMinorUnits('1.49', 'JPY')).toBe(1)
    expect(toMinorUnits('1.50', 'JPY')).toBe(2)
    expect(() => toMinorUnits(String(currencyRules.CNY.maxMinorUnits), 'CNY')).toThrow('超过允许上限')
  })

  it('creates opening transactions and projects balances', () => {
    const ledger = createLedger('日常')
    const account = addAccount(ledger, '现金', false, { CNY: 12_345 })
    expect(ledger.transactions).toHaveLength(4)
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(12_345)
  })

  it('edits account identity without creating financial records', () => {
    const ledger = createLedger('日常')
    const account = addAccount(ledger, '现金', false, { CNY: 100 })
    const before = ledger.transactions.length
    updateAccount(ledger, account.id, '零钱', true)
    expect(account).toMatchObject({ name: '零钱', isPendingSpend: true })
    expect(ledger.transactions).toHaveLength(before)
  })

  it('rejects a batch atomically when it would make a balance negative', () => {
    const ledger = createLedger('日常')
    const account = addAccount(ledger, '现金', false, { CNY: 1_000 })
    const tag = addTag(ledger, '餐饮')
    const before = ledger.transactions.length
    expect(() => addTransactions(ledger, [{
      kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 1_001 },
      selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2026-09-05',
    }])).toThrow('余额不足')
    expect(ledger.transactions).toHaveLength(before)
  })

  it('rejects malformed minor-unit amounts in the domain layer', () => {
    const ledger = createLedger('日常')
    expect(() => addAccount(ledger, '现金', false, { CNY: -1 })).toThrow('有效金额')
  })

  it('deletes and restores a transaction with append-only records', () => {
    const ledger = createLedger('日常')
    const account = addAccount(ledger, '现金', false, { CNY: 1_000 })
    const tag = addTag(ledger, '餐饮')
    const [transaction] = addTransactions(ledger, [{
      kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 200 },
      selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2026-09-05',
    }])
    expect(transaction).toBeDefined()
    reverseTransaction(ledger, transaction!.id)
    expect(isTransactionDeleted(ledger, transaction!.id)).toBe(true)
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(1_000)
    restoreTransaction(ledger, transaction!.id)
    expect(isTransactionDeleted(ledger, transaction!.id)).toBe(false)
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(800)
  })

  it('restores an account and its balance through audit records', () => {
    const ledger = createLedger('日常')
    const account = addAccount(ledger, '现金', false, { CNY: 5_000 })
    const before = ledger.transactions.length
    deleteAccount(ledger, account.id)
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(0)
    restoreAccount(ledger, account.id)
    expect(projectBalances(ledger)[account.id]?.CNY).toBe(5_000)
    const restoreGroup = ledger.transactions.slice(before + 4)
    expect(restoreGroup.filter((transaction) => transaction.recordRole === 'restoration')).toHaveLength(4)
    expect(restoreGroup.filter((transaction) => transaction.recordRole === 'replacement')).toHaveLength(4)
    expect(new Set(restoreGroup.map((transaction) => transaction.operationGroupId))).toHaveLength(1)
  })

  it('creates temporary tags and transactions as one domain operation', () => {
    const ledger = createLedger('日常')
    const account = addAccount(ledger, '现金', false, { CNY: 1_000 })
    const [transaction] = addTransactionsWithTags(ledger, [{
      kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 10 },
      selectedTagIds: ['temp:coffee'], primaryTagId: 'temp:coffee', bookedAt: '2026-09-06',
    }], [{ clientId: 'temp:coffee', name: '咖啡' }])
    const tag = ledger.tags.find((item) => item.name === '咖啡')
    expect(tag).toBeDefined()
    expect(transaction?.selectedTagIds).toEqual([tag?.id])
    expect(transaction?.primaryTagId).toBe(tag?.id)
  })

  it('resolves every tag reference before deleting it', () => {
    const ledger = createLedger('日常')
    const account = addAccount(ledger, '现金', false, { CNY: 1_000 })
    const target = addTag(ledger, '旧标签')
    const other = addTag(ledger, '保留标签')
    const [primaryReference, secondaryReference] = addTransactions(ledger, [{
      kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 10 },
      selectedTagIds: [target.id], primaryTagId: target.id, bookedAt: '2026-09-06',
    }, {
      kind: 'expense', sourceAccountId: account.id, sourceMoney: { currency: 'CNY', minorUnits: 10 },
      selectedTagIds: [other.id, target.id], primaryTagId: other.id, bookedAt: '2026-09-06',
    }])
    expect(() => resolveAndDeleteTag(ledger, target.id, [])).toThrow('尚未处理')
    resolveAndDeleteTag(ledger, target.id, [
      { transactionId: primaryReference!.id, action: 'replace', replacementTagName: '新标签' },
      { transactionId: secondaryReference!.id, action: 'remove' },
    ])
    expect(ledger.tags.some((tag) => tag.id === target.id)).toBe(false)
    expect(primaryReference?.primaryTagId).toBe(ledger.tags.find((tag) => tag.name === '新标签')?.id)
    expect(secondaryReference?.selectedTagIds).toEqual([other.id])
  })
})
