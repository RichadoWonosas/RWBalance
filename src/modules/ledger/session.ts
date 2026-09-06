import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppearanceSettings } from '../../core/domain/theme'
import type { TransactionDraft } from '../../core/domain/types'
import type { PendingTag, TagDeletionResolution } from '../../core/domain/ledger'
import type { LedgerIndexEntry } from '../../core/data/indexed-db/repository'
import { createLedgerWorkerClient, type LedgerWorkerClient } from '../../worker/client'
import type { LedgerView, LedgerWorkerCommand, LedgerWorkerResult } from '../../worker/protocol'
import type { EncryptionId, KdfId } from '../../core/security/crypto'

function downloadContainer(container: object, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(container)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name}.rwbl`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export const useLedgerStore = defineStore('ledger-session', () => {
  const ledger = ref<LedgerView>()
  const indexes = ref<LedgerIndexEntry[]>([])
  const busy = ref(false)
  const error = ref('')
  let client: LedgerWorkerClient | undefined

  const isUnlocked = computed(() => Boolean(ledger.value))

  function worker(): LedgerWorkerClient {
    client ??= createLedgerWorkerClient()
    return client
  }

  function apply(result: LedgerWorkerResult) {
    if ('view' in result) ledger.value = result.view
    if (result.indexes) indexes.value = result.indexes
  }

  async function run(command: LedgerWorkerCommand): Promise<LedgerWorkerResult | undefined> {
    busy.value = true
    error.value = ''
    try {
      const result = await worker().request(command)
      apply(result)
      return result
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '操作失败'
      return undefined
    } finally {
      busy.value = false
    }
  }

  function terminateSession() {
    client?.terminate()
    client = undefined
    ledger.value = undefined
    error.value = ''
    busy.value = false
  }

  async function initialize() { await run({ type: 'list-indexes' }) }
  async function create(name: string, secret: string) { return run({ type: 'create', name, secret }) }
  async function unlock(ledgerId: string, secret: string) { return run({ type: 'unlock', ledgerId, secret }) }
  async function refreshIndexes() { return run({ type: 'list-indexes' }) }
  function lock() { terminateSession() }
  async function remove(ledgerId: string, secret: string) { return run({ type: 'remove', ledgerId, secret }) }
  async function rename(name: string, secret: string, ledgerId?: string) {
    return run(ledgerId && ledgerId !== ledger.value?.id
      ? { type: 'rename-locked', ledgerId, name, secret }
      : { type: 'rename-current', name, secret })
  }
  async function addAccount(name: string, isPendingSpend: boolean, initial: Record<string, number>) { return run({ type: 'add-account', name, isPendingSpend, initial }) }
  async function updateAccount(accountId: string, name: string, isPendingSpend: boolean) { return run({ type: 'update-account', accountId, name, isPendingSpend }) }
  async function deleteAccount(accountId: string) { return run({ type: 'delete-account', accountId }) }
  async function restoreAccount(accountId: string) { return run({ type: 'restore-account', accountId }) }
  async function addTag(name: string) { return run({ type: 'add-tag', name }) }
  async function deleteTag(tagId: string) { return run({ type: 'delete-tag', tagId }) }
  async function resolveDeleteTag(tagId: string, resolutions: TagDeletionResolution[]) { return run({ type: 'resolve-delete-tag', tagId, resolutions }) }
  async function addTransactions(drafts: TransactionDraft[], pendingTags: PendingTag[] = []) { return run({ type: 'add-transactions', drafts, pendingTags }) }
  async function reverseTransaction(transactionId: string) { return run({ type: 'reverse-transaction', transactionId }) }
  async function restoreTransaction(transactionId: string) { return run({ type: 'restore-transaction', transactionId }) }
  async function updateTransactionTags(transactionId: string, selectedTagIds: string[], primaryTagId: string) { return run({ type: 'update-transaction-tags', transactionId, selectedTagIds, primaryTagId }) }
  async function correctTransaction(transactionId: string, draft: TransactionDraft) { return run({ type: 'correct-transaction', transactionId, draft }) }
  async function setAppearance(appearance: AppearanceSettings) { return run({ type: 'set-appearance', appearance }) }
  async function setAutoLockSeconds(seconds: number) { return run({ type: 'set-auto-lock', seconds }) }
  async function exportById(ledgerId: string) {
    const result = await run({ type: 'get-container', ledgerId })
    if (result?.container) downloadContainer(result.container, result.exportName ?? '账本')
    return Boolean(result?.container)
  }
  async function exportCurrent() {
    if (!ledger.value) return false
    return exportById(ledger.value.id)
  }
  async function inspectImportFile(file: File, secret: string) { return run({ type: 'inspect-import', text: await file.text(), secret }) }
  async function importFile(file: File, secret: string, mode: 'new' | 'copy' | 'replace') {
    const result = await run({ type: 'import', text: await file.text(), secret, mode })
    if (result?.backupContainer) downloadContainer(result.backupContainer, result.backupName ?? '替换前备份')
    return result
  }
  async function changePassphrase(oldSecret: string, newSecret: string) { return run({ type: 'change-passphrase', oldSecret, newSecret }) }
  async function migrateSecurity(secret: string, kdf: KdfId, encryption: EncryptionId) { return run({ type: 'migrate-security', secret, kdf, encryption }) }
  async function restoreRecovery(secret: string) { return run({ type: 'restore-recovery', secret }) }

  return {
    ledger, indexes, busy, error, isUnlocked,
    initialize, refreshIndexes, create, unlock, lock, terminateSession, remove, rename,
    addAccount, updateAccount, deleteAccount, restoreAccount, addTag, deleteTag, resolveDeleteTag, addTransactions,
    reverseTransaction, restoreTransaction, updateTransactionTags, correctTransaction, setAppearance, setAutoLockSeconds, exportById, exportCurrent,
    inspectImportFile, importFile, changePassphrase, migrateSecurity, restoreRecovery,
  }
})
