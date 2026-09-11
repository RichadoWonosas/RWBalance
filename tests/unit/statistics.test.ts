import { describe, expect, it } from 'vitest'
import {
  EXCHANGE_PRIMARY_TAG_ID,
  exchangeExpenseTagId,
  exchangeIncomeTagId,
  implicitTagName,
  transactionStatisticalFlows,
} from '../../src/core/domain/statistics'
import type { Transaction } from '../../src/core/domain/types'

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    kind: 'transfer',
    selectedTagIds: [],
    explicitTagIds: [],
    note: '',
    bookedAt: '2026-09-11',
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    recordRole: 'normal',
    ...overrides,
  }
}

describe('statistical transaction flows', () => {
  it('projects a cross-currency transfer into both currencies with implicit tags', () => {
    const flows = transactionStatisticalFlows(transaction({
      sourceAccountId: 'cash',
      sourceMoney: { currency: 'CNY', minorUnits: 50_000 },
      destinationAccountId: 'cash',
      destinationMoney: { currency: 'JPY', minorUnits: 10_000 },
    }))

    expect(flows).toEqual([
      {
        kind: 'expense',
        money: { currency: 'CNY', minorUnits: 50_000 },
        primaryTagId: EXCHANGE_PRIMARY_TAG_ID,
        tagIds: [EXCHANGE_PRIMARY_TAG_ID, exchangeExpenseTagId('JPY')],
        label: '兑换到日元',
      },
      {
        kind: 'income',
        money: { currency: 'JPY', minorUnits: 10_000 },
        primaryTagId: EXCHANGE_PRIMARY_TAG_ID,
        tagIds: [EXCHANGE_PRIMARY_TAG_ID, exchangeIncomeTagId('CNY')],
        label: '从人民币兑换',
      },
    ])
    expect(implicitTagName(EXCHANGE_PRIMARY_TAG_ID)).toBe('换汇')
  })

  it('does not treat a same-currency internal transfer as income or expense', () => {
    expect(transactionStatisticalFlows(transaction({
      sourceAccountId: 'cash',
      sourceMoney: { currency: 'CNY', minorUnits: 100 },
      destinationAccountId: 'bank',
      destinationMoney: { currency: 'CNY', minorUnits: 100 },
    }))).toEqual([])
  })
})
