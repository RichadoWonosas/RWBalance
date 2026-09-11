/// <reference lib="webworker" />

import { addAccount, addTag, addTransactionsWithTags, correctTransaction, createLedger, deleteAccount, deleteTag, effectiveTransaction, isTransactionDeleted, normalizeName, occurrenceMigrationEntries, projectBalances, reorderTransactionUpdates, resolveAndDeleteTag, restoreAccount, restoreTransaction, reverseTransaction, transactionAuditChain, updateAccount, updateTag, updateTransactionTags, validateLedgerData, migrateLedgerToV3, migrateLedgerV1, setTagParent } from '../core/domain/ledger'
import { currencies, type Currency, type Ledger, type Transaction } from '../core/domain/types'
import { transactionStatisticalFlows } from '../core/domain/statistics'
import { decryptLedger, encryptLedger, openLedger, parseContainer, rewrapContainer, type EncryptedLedgerContainer, type SecurityAlgorithms } from '../core/security/crypto'
import { deleteLedger, getMigrationBackup, getContainer, getLedgerRecovery, listLedgerIndexes, restoreLedgerRecovery, saveLedger, type LedgerIndexEntry } from '../core/data/indexed-db/repository'
import type { LedgerView, LedgerWorkerCommand, LedgerWorkerRequest, LedgerWorkerResponse, LedgerWorkerResult } from './protocol'

let ledger: Ledger | undefined
let passphrase = ''
let dataKey: Uint8Array<ArrayBuffer> | undefined
let algorithms: SecurityAlgorithms | undefined
let activeContainer: EncryptedLedgerContainer | undefined
let hasRecovery = false
let hasMigrationBackup = false

function clearSession() {
  ledger = undefined
  passphrase = ''
  dataKey?.fill(0)
  dataKey = undefined
  algorithms = undefined
  activeContainer = undefined
  hasRecovery = false
  hasMigrationBackup = false
}

function requireLedger(): Ledger {
  if (!ledger || !passphrase) throw new Error('账本未解锁')
  return ledger
}

async function indexes(): Promise<LedgerIndexEntry[]> {
  return listLedgerIndexes()
}

function createView(current: Ledger): LedgerView {
  const roots = current.transactions.filter((transaction) => transaction.recordRole === 'normal')
  const normalTransactions = roots
    .filter((transaction) => !isTransactionDeleted(current, transaction.id))
    .map((transaction) => effectiveTransaction(current, transaction.id)!)
    .sort(compareModificationDesc)
  const deletedTransactions = roots
    .filter((transaction) => isTransactionDeleted(current, transaction.id))
    .map((transaction) => effectiveTransaction(current, transaction.id)!)
    .sort(compareModificationDesc)
  const totals = Object.fromEntries(currencies.map((currency) => [currency, { income: 0, expense: 0 }])) as LedgerView['totals']
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - 29)
  const primaryTotals = Object.fromEntries(currencies.map((currency) => [currency, new Map<string, number>()])) as Record<Currency, Map<string, number>>
  const includedTotals = Object.fromEntries(currencies.map((currency) => [currency, new Map<string, number>()])) as Record<Currency, Map<string, number>>
  for (const transaction of normalTransactions) {
    if (new Date(transaction.bookedAt) < cutoff) continue
    for (const flow of transactionStatisticalFlows(transaction)) {
      totals[flow.money.currency][flow.kind] += flow.money.minorUnits
      if (flow.kind !== 'expense') continue
      const currency = flow.money.currency
      const amount = flow.money.minorUnits
      if (flow.primaryTagId) primaryTotals[currency].set(flow.primaryTagId, (primaryTotals[currency].get(flow.primaryTagId) ?? 0) + amount)
      for (const tagId of flow.tagIds) includedTotals[currency].set(tagId, (includedTotals[currency].get(tagId) ?? 0) + amount)
    }
  }
  const rank = (maps: Record<Currency, Map<string, number>>) => Object.fromEntries(currencies.map((currency) => [currency, [...maps[currency]].map(([tagId, minorUnits]) => ({ tagId, minorUnits })).sort((a, b) => b.minorUnits - a.minorUnits).slice(0, 3)])) as LedgerView['tagStats']['primary']
  return {
    id: current.id,
    name: current.name,
    updatedAt: current.updatedAt,
    settings: structuredClone(current.settings),
    security: structuredClone(algorithms!),
    hasRecovery,
    hasMigrationBackup,
    hierarchyChanges: structuredClone(current.hierarchyChanges ?? []),
    tagReferences: structuredClone(current.transactions.filter(tx => tx.selectedTagIds.some(id => id !== '__system__'))),
    accounts: structuredClone(current.accounts),
    tags: structuredClone(current.tags),
    balances: projectBalances(current),
    totals,
    normalTransactions: structuredClone(normalTransactions),
    deletedTransactions: structuredClone(deletedTransactions),
    auditChains: Object.fromEntries(roots.map((root) => [root.id, structuredClone(transactionAuditChain(current, root.id))])),
    tagStats: { primary: rank(primaryTotals), included: rank(includedTotals) },
  }
}

function compareModificationDesc(a: Transaction, b: Transaction) {
  return b.updatedAt.localeCompare(a.updatedAt) || (a.updatedOrder ?? a.commitIndex ?? 0) - (b.updatedOrder ?? b.commitIndex ?? 0) || (b.updatedRevision ?? 0) - (a.updatedRevision ?? 0)
}

async function persistLedger(current: Ledger): Promise<void> {
  validateLedgerData(current)
  const existed = Boolean(await getContainer(current.id))
  const container = await encryptLedger(current, passphrase, { algorithms, dataKey })
  const verified = await openLedger(container, passphrase)
  validateLedgerData(verified.ledger)
  await saveLedger(container, {
    ledgerId: current.id,
    displayName: current.name,
    normalizedName: normalizeName(current.name),
    containerVersion: container.version,
    updatedAt: current.updatedAt,
  })
  activeContainer = container
  dataKey = verified.dataKey
  algorithms = verified.algorithms
  if (existed) hasRecovery = true
}

async function persist(): Promise<void> { await persistLedger(requireLedger()) }

async function ensureUniqueName(name: string, exceptLedgerId?: string) {
  const normalized = normalizeName(name)
  if (!normalized) throw new Error('账本名称不能为空')
  if ((await indexes()).some((entry) => entry.ledgerId !== exceptLedgerId && entry.normalizedName === normalized)) throw new Error('账本名称已存在')
}

async function mutate(operation: (current: Ledger) => void): Promise<LedgerWorkerResult> {
  const current = requireLedger()
  const candidate = structuredClone(current)
  operation(candidate)
  await persistLedger(candidate)
  ledger = candidate
  return { view: createView(candidate), indexes: await indexes() }
}

function migrationPreview(current: Ledger, container: EncryptedLedgerContainer): LedgerWorkerResult {
  // Validate the complete migration before even showing confirmation. No write or session data.
  const candidate = migrateLedgerV1(current)
  const occurrenceEntries = occurrenceMigrationEntries(candidate)
  return { migrationInfo: { name: current.name, fromVersion: current.schemaVersion as 1 | 2, tags: current.tags.length, transactions: current.transactions.length, occurrenceEntries }, backupContainer: container, backupName: `${current.name}-v${current.schemaVersion}升级前备份` }
}
async function upgradedContainer(current: Ledger, secret: string, security: SecurityAlgorithms, occurredAt: Record<string, string>) {
  const upgraded = await encryptLedger(migrateLedgerToV3(current, occurredAt), secret, { algorithms: security })
  validateLedgerData((await openLedger(upgraded, secret)).ledger)
  return upgraded
}
async function saveMigrated(container: EncryptedLedgerContainer, current: Ledger, backup: EncryptedLedgerContainer) {
  await saveLedger(container, { ledgerId: current.id, displayName: current.name, normalizedName: normalizeName(current.name), containerVersion: container.version, updatedAt: current.updatedAt }, backup)
}

async function handle(command: LedgerWorkerCommand): Promise<LedgerWorkerResult> {
  switch (command.type) {
    case 'list-indexes': return { indexes: await indexes() }
    case 'create': {
      await ensureUniqueName(command.name)
      clearSession()
      if (command.algorithms) algorithms = { ...command.algorithms, compression: 'deflate', serialization: 'json-v1' }
      ledger = createLedger(command.name)
      passphrase = command.secret
      try { await persist() } catch (error) { clearSession(); throw error }
      return { view: createView(ledger), indexes: await indexes() }
    }
    case 'unlock': {
      clearSession()
      let container = await getContainer(command.ledgerId)
      if (!container) throw new Error('找不到账本数据')
      let opened = await openLedger(container, command.secret)
      validateLedgerData(opened.ledger)
      if (opened.ledger.schemaVersion < 3) {
        if (!command.confirmMigration) return migrationPreview(opened.ledger, container)
        const backup = container
        container = await upgradedContainer(opened.ledger, command.secret, opened.algorithms, command.migrationOccurredAt ?? {})
        opened = await openLedger(container, command.secret)
        await saveMigrated(container, opened.ledger, backup)
      }
      hasMigrationBackup = Boolean(await getMigrationBackup(container.ledgerId))
      ledger = opened.ledger
      passphrase = command.secret
      dataKey = opened.dataKey
      algorithms = opened.algorithms
      activeContainer = container
      hasRecovery = Boolean(await getLedgerRecovery(container.ledgerId))
      return { view: createView(opened.ledger) }
    }
    case 'lock': clearSession(); return {}
    case 'add-account': return mutate((current) => addAccount(current, command.name, command.isPendingSpend, command.initial as Partial<Record<Currency, number>>))
    case 'update-account': return mutate((current) => updateAccount(current, command.accountId, command.name, command.isPendingSpend))
    case 'delete-account': return mutate((current) => deleteAccount(current, command.accountId))
    case 'restore-account': return mutate((current) => restoreAccount(current, command.accountId))
    case 'add-tag': return mutate((current) => addTag(current, command.name, command.parentId))
    case 'update-tag': return mutate(current => { updateTag(current, command.tagId, command.name, command.parentId) })
    case 'set-tag-parent': return mutate(current => setTagParent(current, command.tagId, command.parentId))
    case 'delete-tag': return mutate((current) => deleteTag(current, command.tagId, command.children))
    case 'resolve-delete-tag': return mutate((current) => resolveAndDeleteTag(current, command.tagId, command.resolutions, command.children))
    case 'add-transactions': return mutate((current) => { addTransactionsWithTags(current, command.drafts, command.pendingTags ?? []) })
    case 'reverse-transaction': return mutate((current) => { reverseTransaction(current, command.transactionId) })
    case 'restore-transaction': return mutate((current) => { restoreTransaction(current, command.transactionId) })
    case 'update-transaction-tags': return mutate((current) => { updateTransactionTags(current, command.transactionId, command.selectedTagIds, command.primaryTagId) })
    case 'correct-transaction': return mutate((current) => { correctTransaction(current, command.transactionId, command.draft) })
    case 'reorder-transaction-updates': return mutate((current) => { reorderTransactionUpdates(current, command.orderedGroups) })
    case 'set-appearance': return mutate((current) => {
      current.settings = { ...current.settings, ...command.appearance }
      current.updatedAt = new Date().toISOString()
    })
    case 'set-auto-lock': return mutate((current) => {
      if (!Number.isInteger(command.seconds) || command.seconds < 30 || command.seconds > 86_400) throw new Error('自动暂离时间需要在 30 到 86400 秒之间')
      current.settings.autoLockSeconds = command.seconds
      current.updatedAt = new Date().toISOString()
    })
    case 'change-passphrase': {
      const current = requireLedger()
      if (!activeContainer) throw new Error('找不到账本数据')
      const changed = await rewrapContainer(activeContainer, command.oldSecret, command.newSecret, algorithms!.kdf)
      const verified = await openLedger(changed, command.newSecret)
      validateLedgerData(verified.ledger)
      await saveLedger(changed, { ledgerId: current.id, displayName: current.name, normalizedName: normalizeName(current.name), containerVersion: changed.version, updatedAt: current.updatedAt })
      passphrase = command.newSecret
      activeContainer = changed
      dataKey?.fill(0); dataKey = verified.dataKey
      algorithms = verified.algorithms
      hasRecovery = true
      return { view: createView(current), indexes: await indexes() }
    }
    case 'migrate-security': {
      const current = requireLedger()
      if (command.secret !== passphrase) {
        if (!activeContainer) throw new Error('找不到账本数据')
        await decryptLedger(activeContainer, command.secret)
      }
      const nextAlgorithms: SecurityAlgorithms = { ...algorithms!, kdf: command.kdf, encryption: command.encryption }
      const migrated = await encryptLedger(current, command.secret, { algorithms: nextAlgorithms })
      const verified = await openLedger(migrated, command.secret)
      validateLedgerData(verified.ledger)
      await saveLedger(migrated, { ledgerId: current.id, displayName: current.name, normalizedName: normalizeName(current.name), containerVersion: migrated.version, updatedAt: current.updatedAt })
      passphrase = command.secret
      activeContainer = migrated
      dataKey?.fill(0); dataKey = verified.dataKey
      algorithms = verified.algorithms
      hasRecovery = true
      return { view: createView(current), indexes: await indexes() }
    }
    case 'restore-recovery': {
      const current = requireLedger()
      const recovery = await getLedgerRecovery(current.id)
      if (!recovery) throw new Error('没有可恢复的上一版本')
      let container = recovery.container
      let opened = await openLedger(container, command.secret)
      validateLedgerData(opened.ledger)
      if (opened.ledger.schemaVersion < 3) {
        if (!command.confirmMigration) return migrationPreview(opened.ledger, container)
        container = await upgradedContainer(opened.ledger, command.secret, opened.algorithms, command.migrationOccurredAt ?? {})
        opened = await openLedger(container, command.secret)
        await saveMigrated(container, opened.ledger, recovery.container)
        hasMigrationBackup = true
      } else await restoreLedgerRecovery(current.id)
      ledger = opened.ledger
      passphrase = command.secret
      dataKey?.fill(0); dataKey = opened.dataKey
      algorithms = opened.algorithms
      activeContainer = container
      hasRecovery = true
      return { view: createView(opened.ledger), indexes: await indexes() }
    }
    case 'rename-current': {
      const current = requireLedger()
      const container = await getContainer(current.id)
      if (!container) throw new Error('找不到账本数据')
      await decryptLedger(container, command.secret)
      await ensureUniqueName(command.name, current.id)
      const candidate = structuredClone(current)
      candidate.name = command.name.trim()
      candidate.updatedAt = new Date().toISOString()
      await persistLedger(candidate)
      ledger = candidate
      return { view: createView(candidate), indexes: await indexes() }
    }
    case 'rename-locked': {
      const container = await getContainer(command.ledgerId)
      if (!container) throw new Error('找不到账本数据')
      const opened = await openLedger(container, command.secret)
      const current = opened.ledger
      validateLedgerData(current)
      await ensureUniqueName(command.name, current.id)
      current.name = command.name.trim()
      current.updatedAt = new Date().toISOString()
      const renamed = await encryptLedger(current, command.secret, { algorithms: opened.algorithms, dataKey: opened.dataKey })
      await decryptLedger(renamed, command.secret)
      await saveLedger(renamed, { ledgerId: current.id, displayName: current.name, normalizedName: normalizeName(current.name), containerVersion: renamed.version, updatedAt: current.updatedAt })
      return { indexes: await indexes() }
    }
    case 'remove': {
      const container = await getContainer(command.ledgerId)
      if (!container) throw new Error('找不到账本数据')
      await decryptLedger(container, command.secret)
      await deleteLedger(command.ledgerId)
      if (ledger?.id === command.ledgerId) clearSession()
      return { indexes: await indexes(), view: ledger ? createView(ledger) : undefined }
    }
    case 'get-migration-backup': {
      const container = await getMigrationBackup(command.ledgerId)
      if (!container) throw new Error('没有升级前备份')
      return { container, exportName: '账本-升级前备份' }
    }
    case 'get-container': {
      const container = await getContainer(command.ledgerId)
      if (!container) throw new Error('找不到账本数据')
      const entry = (await indexes()).find((candidate) => candidate.ledgerId === command.ledgerId)
      return { container, exportName: entry?.displayName ?? '账本' }
    }
    case 'inspect-import': {
      const container = parseContainer(command.text)
      const imported = await decryptLedger(container, command.secret)
      validateLedgerData(imported)
      const entries = await indexes()
      const conflict = entries.some((entry) => entry.ledgerId === imported.id) ? 'id' : entries.some((entry) => entry.normalizedName === normalizeName(imported.name)) ? 'name' : 'none'
      return { importInfo: { ledgerId: imported.id, displayName: imported.name, conflict } }
    }
    case 'import': {
      const container = parseContainer(command.text)
      const opened = await openLedger(container, command.secret)
      validateLedgerData(opened.ledger)
      const legacy = opened.ledger.schemaVersion < 3
      if (legacy && !command.confirmMigration) return migrationPreview(opened.ledger, container)
      const imported = legacy ? migrateLedgerToV3(opened.ledger, command.migrationOccurredAt ?? {}) : opened.ledger
      const entries = await indexes()
      const idConflict = entries.find((entry) => entry.ledgerId === imported.id)
      const nameConflict = entries.find((entry) => entry.normalizedName === normalizeName(imported.name) && entry.ledgerId !== imported.id)
      if (idConflict && command.mode === 'new') throw new Error('该账本 ID 已存在，请选择导入为副本或替换')
      if (nameConflict && command.mode !== 'copy') throw new Error('存在同名账本，请导入为副本')
      let target = container
      let targetLedger = imported
      let backupContainer: EncryptedLedgerContainer | undefined
      let backupName: string | undefined
      if (command.mode === 'copy') {
        const baseName = `${imported.name}（副本）`; let displayName = baseName; let sequence = 2
        while (entries.some((entry) => entry.normalizedName === normalizeName(displayName))) displayName = `${baseName} ${sequence++}`
        targetLedger = { ...structuredClone(imported), id: crypto.randomUUID(), name: displayName, updatedAt: new Date().toISOString() }
        target = await encryptLedger(targetLedger, command.secret, { algorithms: opened.algorithms })
      } else if (command.mode === 'replace') {
        if (!idConflict) throw new Error('只有相同账本 ID 才能执行替换')
        backupContainer = await getContainer(imported.id)
        backupName = `${idConflict.displayName}-替换前备份`
      }
      if (legacy && command.mode !== 'copy') target = await encryptLedger(imported, command.secret, { algorithms: opened.algorithms })
      validateLedgerData((await openLedger(target, command.secret)).ledger)
      await saveLedger(target, { ledgerId: targetLedger.id, displayName: targetLedger.name, normalizedName: normalizeName(targetLedger.name), containerVersion: target.version, updatedAt: targetLedger.updatedAt }, legacy ? container : undefined)
      return { indexes: await indexes(), backupContainer, backupName }
    }
  }
}

let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<LedgerWorkerRequest>) => {
  const { id, command } = event.data
  queue = queue.then(async () => {
    try {
      const result = await handle(command)
      self.postMessage({ id, ok: true, result } satisfies LedgerWorkerResponse)
    } catch (cause) {
      self.postMessage({ id, ok: false, error: cause instanceof Error ? cause.message : '操作失败' } satisfies LedgerWorkerResponse)
    }
  })
}
