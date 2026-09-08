import type { Account, BalanceMap, Currency, Ledger, Tag, Transaction, TransactionDraft } from '../core/domain/types'
import type { AppearanceSettings } from '../core/domain/theme'
import type { LedgerIndexEntry } from '../core/data/indexed-db/repository'
import type { EncryptedLedgerContainer, EncryptionId, KdfId, SecurityAlgorithms } from '../core/security/crypto'
import type { PendingTag, TagDeletionResolution, TagChildDisposition } from '../core/domain/ledger'

export interface TagSpendingStat { tagId: string; minorUnits: number }

export interface LedgerView {
  id: string
  name: string
  updatedAt: string
  settings: Ledger['settings']
  security: SecurityAlgorithms
  hasRecovery: boolean
  hasMigrationBackup: boolean
  hierarchyChanges: NonNullable<Ledger['hierarchyChanges']>
  tagReferences: Transaction[]
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
  | { type: 'create'; name: string; secret: string; algorithms?: Pick<SecurityAlgorithms, 'kdf' | 'encryption'> }
  | { type: 'unlock'; ledgerId: string; secret: string; confirmMigration?: boolean }
  | { type: 'lock' }
  | { type: 'add-account'; name: string; isPendingSpend: boolean; initial: Record<string, number> }
  | { type: 'update-account'; accountId: string; name: string; isPendingSpend: boolean }
  | { type: 'delete-account'; accountId: string }
  | { type: 'restore-account'; accountId: string }
  | { type: 'add-tag'; name: string; parentId?: string }
  | { type: 'set-tag-parent'; tagId: string; parentId?: string }
  | { type: 'get-migration-backup'; ledgerId: string }
  | { type: 'delete-tag'; tagId: string; children?: TagChildDisposition }
  | { type: 'resolve-delete-tag'; tagId: string; resolutions: TagDeletionResolution[]; children?: TagChildDisposition }
  | { type: 'add-transactions'; drafts: TransactionDraft[]; pendingTags?: PendingTag[] }
  | { type: 'reverse-transaction'; transactionId: string }
  | { type: 'restore-transaction'; transactionId: string }
  | { type: 'update-transaction-tags'; transactionId: string; selectedTagIds: string[]; primaryTagId: string }
  | { type: 'correct-transaction'; transactionId: string; draft: TransactionDraft }
  | { type: 'set-appearance'; appearance: AppearanceSettings }
  | { type: 'set-auto-lock'; seconds: number }
  | { type: 'change-passphrase'; oldSecret: string; newSecret: string }
  | { type: 'migrate-security'; secret: string; kdf: KdfId; encryption: EncryptionId }
  | { type: 'restore-recovery'; secret: string; confirmMigration?: boolean }
  | { type: 'rename-current'; name: string; secret: string }
  | { type: 'rename-locked'; ledgerId: string; name: string; secret: string }
  | { type: 'remove'; ledgerId: string; secret: string }
  | { type: 'get-container'; ledgerId: string }
  | { type: 'inspect-import'; text: string; secret: string }
  | { type: 'import'; text: string; secret: string; mode: 'new' | 'copy' | 'replace'; confirmMigration?: boolean }

export interface LedgerWorkerResult {
  migrationInfo?: { name: string; tags: number; transactions: number }
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
