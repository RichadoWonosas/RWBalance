import { currencies, type Currency, type Money, type Transaction } from './types'

export const EXCHANGE_PRIMARY_TAG_ID = '__exchange__'
const EXCHANGE_EXPENSE_PREFIX = '__exchange_expense_'
const EXCHANGE_INCOME_PREFIX = '__exchange_income_'

const currencyNames: Record<Currency, string> = {
  CNY: '人民币',
  USD: '美元',
  GBP: '英镑',
  JPY: '日元',
}

export interface StatisticalFlow {
  kind: 'income' | 'expense'
  money: Money
  primaryTagId?: string
  tagIds: string[]
  label?: string
}

export function exchangeExpenseTagId(destinationCurrency: Currency): string {
  return `${EXCHANGE_EXPENSE_PREFIX}${destinationCurrency}`
}

export function exchangeIncomeTagId(sourceCurrency: Currency): string {
  return `${EXCHANGE_INCOME_PREFIX}${sourceCurrency}`
}

export function implicitTagName(tagId: string): string | undefined {
  if (tagId === EXCHANGE_PRIMARY_TAG_ID) return '换汇'
  const expenseCurrency = tagId.startsWith(EXCHANGE_EXPENSE_PREFIX) ? tagId.slice(EXCHANGE_EXPENSE_PREFIX.length) as Currency : undefined
  if (expenseCurrency && currencies.includes(expenseCurrency)) return `兑换到${currencyNames[expenseCurrency]}`
  const incomeCurrency = tagId.startsWith(EXCHANGE_INCOME_PREFIX) ? tagId.slice(EXCHANGE_INCOME_PREFIX.length) as Currency : undefined
  if (incomeCurrency && currencies.includes(incomeCurrency)) return `从${currencyNames[incomeCurrency]}兑换`
  return undefined
}

export function isImplicitTagId(tagId: string): boolean {
  return implicitTagName(tagId) !== undefined
}

/**
 * Projects a transaction into the income/expense events used by reporting.
 * Same-currency transfers remain internal movements; cross-currency transfers
 * become one expense in the source currency and one income in the destination.
 */
export function transactionStatisticalFlows(transaction: Transaction): StatisticalFlow[] {
  if (transaction.kind === 'income' && transaction.destinationMoney) {
    return [{ kind: 'income', money: transaction.destinationMoney, primaryTagId: transaction.primaryTagId, tagIds: transaction.selectedTagIds }]
  }
  if (transaction.kind === 'expense' && transaction.sourceMoney) {
    return [{ kind: 'expense', money: transaction.sourceMoney, primaryTagId: transaction.primaryTagId, tagIds: transaction.selectedTagIds }]
  }
  if (transaction.kind !== 'transfer' || !transaction.sourceMoney || !transaction.destinationMoney || transaction.sourceMoney.currency === transaction.destinationMoney.currency) return []

  const expenseTagId = exchangeExpenseTagId(transaction.destinationMoney.currency)
  const incomeTagId = exchangeIncomeTagId(transaction.sourceMoney.currency)
  return [
    {
      kind: 'expense',
      money: transaction.sourceMoney,
      primaryTagId: EXCHANGE_PRIMARY_TAG_ID,
      tagIds: [EXCHANGE_PRIMARY_TAG_ID, expenseTagId],
      label: implicitTagName(expenseTagId),
    },
    {
      kind: 'income',
      money: transaction.destinationMoney,
      primaryTagId: EXCHANGE_PRIMARY_TAG_ID,
      tagIds: [EXCHANGE_PRIMARY_TAG_ID, incomeTagId],
      label: implicitTagName(incomeTagId),
    },
  ]
}
