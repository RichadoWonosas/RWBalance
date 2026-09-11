export const currencies = ['CNY', 'USD', 'GBP', 'JPY'] as const
export type Currency = (typeof currencies)[number]
export type TransactionKind = 'income' | 'expense' | 'transfer'
export type TimePrecision = 'date' | 'second'
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
  parentId?: string
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
  /** Absent only in schema v1. Direct selections, in user-selected order. */
  explicitTagIds?: string[]
  primaryTagId?: string
  note: string
  bookedAt: string
  /** Business occurrence instant. Required from schema v3 onward. */
  occurredAt?: string
  timePrecision?: TimePrecision
  /** Stable operation ordering. Required from schema v3 onward. */
  commitRevision?: number
  commitIndex?: number
  updatedRevision?: number
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
  schemaVersion: 1 | 2 | 3
  nextTransactionRevision?: number
  hierarchyChanges?: { tagId: string; previousParentId?: string; parentId?: string; changedAt: string; affectedTransactions: number; action: 'reparent' | 'delete' }[]
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
  occurredAt: string
}

export type BalanceMap = Record<string, Partial<Record<Currency, number>>>
