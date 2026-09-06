import type { Account, BalanceMap, Currency, Ledger, Tag, Transaction, TransactionDraft } from '../core/domain/types'
import type { AppearanceSettings } from '../core/domain/theme'
import type { LedgerIndexEntry } from '../core/data/indexed-db/repository'
import type { EncryptedLedgerContainer, EncryptionId, KdfId, SecurityAlgorithms } from '../core/security/crypto'
import type { PendingTag, TagDeletionResolution } from '../core/domain/ledger'

export interface TagSpendingStat { tagId: string; minorUnits: number }

export interface LedgerView {
  id: string
  name: string
  updatedAt: string
  settings: Ledger['settings']
  security: SecurityAlgorithms
  hasRecovery: boolean
  accounts: Account[]
  tags: Tag[]
  balances: BalanceMap
  totals: Record<Currency, { income: number; expense: number }>
  normalTransactions: Transaction[]
  deletedTransactions: Transaction[]
  auditChains: Record<string, Transaction[]>
  tagStats: {
    primary: Record<Currency, TagSpendingStat[]>
    included: Record<Currency, TagSpendingStat[]>
  }
}

export type LedgerWorkerCommand =
  | { type: 'list-indexes' }
  | { type: 'create'; name: string; secret: string }
  | { type: 'unlock'; ledgerId: string; secret: string }
  | { type: 'lock' }
  | { type: 'add-account'; name: string; isPendingSpend: boolean; initial: Record<string, number> }
  | { type: 'update-account'; accountId: string; name: string; isPendingSpend: boolean }
  | { type: 'delete-account'; accountId: string }
  | { type: 'restore-account'; accountId: string }
  | { type: 'add-tag'; name: string }
  | { type: 'delete-tag'; tagId: string }
  | { type: 'resolve-delete-tag'; tagId: string; resolutions: TagDeletionResolution[] }
  | { type: 'add-transactions'; drafts: TransactionDraft[]; pendingTags?: PendingTag[] }
  | { type: 'reverse-transaction'; transactionId: string }
  | { type: 'restore-transaction'; transactionId: string }
  | { type: 'update-transaction-tags'; transactionId: string; selectedTagIds: string[]; primaryTagId: string }
  | { type: 'correct-transaction'; transactionId: string; draft: TransactionDraft }
  | { type: 'set-appearance'; appearance: AppearanceSettings }
  | { type: 'set-auto-lock'; seconds: number }
  | { type: 'change-passphrase'; oldSecret: string; newSecret: string }
  | { type: 'migrate-security'; secret: string; kdf: KdfId; encryption: EncryptionId }
  | { type: 'restore-recovery'; secret: string }
  | { type: 'rename-current'; name: string; secret: string }
  | { type: 'rename-locked'; ledgerId: string; name: string; secret: string }
  | { type: 'remove'; ledgerId: string; secret: string }
  | { type: 'get-container'; ledgerId: string }
  | { type: 'inspect-import'; text: string; secret: string }
  | { type: 'import'; text: string; secret: string; mode: 'new' | 'copy' | 'replace' }

export interface LedgerWorkerResult {
  indexes?: LedgerIndexEntry[]
  view?: LedgerView
  container?: EncryptedLedgerContainer
  exportName?: string
  importInfo?: { ledgerId: string; displayName: string; conflict: 'none' | 'id' | 'name' }
  backupContainer?: EncryptedLedgerContainer
  backupName?: string
}

export interface LedgerWorkerRequest {
  id: number
  command: LedgerWorkerCommand
}

export type LedgerWorkerResponse =
  | { id: number; ok: true; result: LedgerWorkerResult }
  | { id: number; ok: false; error: string }
