export const currencies = ['CNY', 'USD', 'GBP', 'JPY'] as const
export type Currency = (typeof currencies)[number]
export type TransactionKind = 'income' | 'expense' | 'transfer'
export type RecordRole =
  | 'normal'
  | 'reversal'
  | 'replacement'
  | 'restoration'
  | 'system-account-open'
  | 'system-account-close'

export interface Money {
  currency: Currency
  minorUnits: number
}

export interface Account {
  id: string
  name: string
  isPendingSpend: boolean
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface Tag {
  id: string
  name: string
  normalizedName: string
  createdAt: string
  updatedAt: string
}

export interface Transaction {
  id: string
  kind: TransactionKind
  sourceAccountId?: string
  sourceMoney?: Money
  destinationAccountId?: string
  destinationMoney?: Money
  selectedTagIds: string[]
  primaryTagId?: string
  note: string
  bookedAt: string
  createdAt: string
  updatedAt: string
  recordRole: RecordRole
  targetTransactionId?: string
  relatedTransactionIds?: string[]
  operationGroupId?: string
}

export interface Ledger {
  id: string
  name: string
  schemaVersion: 1
  createdAt: string
  updatedAt: string
  accounts: Account[]
  tags: Tag[]
  transactions: Transaction[]
  settings: {
    primaryHue?: number
    secondaryHue?: number
    colorTone?: 'light' | 'dark'
    autoLockSeconds?: number
    [key: string]: unknown
  }
}

export interface TransactionDraft {
  kind: TransactionKind
  sourceAccountId?: string
  sourceMoney?: Money
  destinationAccountId?: string
  destinationMoney?: Money
  selectedTagIds?: string[]
  primaryTagId?: string
  note?: string
  bookedAt: string
}

export type BalanceMap = Record<string, Partial<Record<Currency, number>>>
