import type { EncryptedLedgerContainer } from '../../security/crypto'

export interface LedgerIndexEntry {
  ledgerId: string
  displayName: string
  normalizedName: string
  containerVersion: number
  updatedAt: string
}

export interface LedgerRecoveryEntry {
  ledgerId: string
  container: EncryptedLedgerContainer
  index: LedgerIndexEntry
  savedAt: string
}

const DB_NAME = 'rwbalance'
const DB_VERSION = 3

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('containers')) db.createObjectStore('containers', { keyPath: 'ledgerId' })
      if (!db.objectStoreNames.contains('index')) db.createObjectStore('index', { keyPath: 'ledgerId' })
      if (!db.objectStoreNames.contains('migration')) db.createObjectStore('migration', { keyPath: 'ledgerId' })
      if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'ledgerId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function listLedgerIndexes(): Promise<LedgerIndexEntry[]> {
  const db = await openDb()
  const tx = db.transaction('index', 'readonly')
  const result = await requestResult(tx.objectStore('index').getAll())
  db.close()
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getContainer(ledgerId: string): Promise<EncryptedLedgerContainer | undefined> {
  const db = await openDb()
  const tx = db.transaction('containers', 'readonly')
  const result = await requestResult<EncryptedLedgerContainer | undefined>(tx.objectStore('containers').get(ledgerId))
  db.close()
  return result
}

export async function saveLedger(container: EncryptedLedgerContainer, entry: LedgerIndexEntry, migrationBackup?: EncryptedLedgerContainer): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['containers', 'index', 'recovery', 'migration'], 'readwrite')
  const done = transactionDone(tx)
  // Subscribe immediately: synchronous request errors must also abort queued writes.
  void done.catch(() => {})
  try {
    const [previousContainer, previousIndex, existingMigration] = await Promise.all([
      requestResult<EncryptedLedgerContainer | undefined>(tx.objectStore('containers').get(container.ledgerId)),
      requestResult<LedgerIndexEntry | undefined>(tx.objectStore('index').get(container.ledgerId)),
      requestResult(tx.objectStore('migration').get(container.ledgerId)),
    ])
    if (previousContainer && previousIndex && JSON.stringify(previousContainer) !== JSON.stringify(container)) {
      tx.objectStore('recovery').put({ ledgerId: container.ledgerId, container: previousContainer, index: previousIndex, savedAt: new Date().toISOString() } satisfies LedgerRecoveryEntry)
    }
    if (migrationBackup && !existingMigration) tx.objectStore('migration').put({ ledgerId: container.ledgerId, container: migrationBackup })
    tx.objectStore('containers').put(container)
    tx.objectStore('index').put(entry)
    await done
  } catch (error) {
    try { tx.abort() } catch { /* Already completed or aborted. */ }
    await done.catch(() => {})
    throw error
  } finally { db.close() }
}

export async function deleteLedger(ledgerId: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['containers', 'index', 'recovery', 'migration'], 'readwrite')
  tx.objectStore('containers').delete(ledgerId)
  tx.objectStore('index').delete(ledgerId)
  tx.objectStore('recovery').delete(ledgerId)
  tx.objectStore('migration').delete(ledgerId)
  await transactionDone(tx)
  db.close()
}

export async function getLedgerRecovery(ledgerId: string): Promise<LedgerRecoveryEntry | undefined> {
  const db = await openDb()
  const tx = db.transaction('recovery', 'readonly')
  const result = await requestResult<LedgerRecoveryEntry | undefined>(tx.objectStore('recovery').get(ledgerId))
  db.close()
  return result
}

export async function restoreLedgerRecovery(ledgerId: string): Promise<LedgerRecoveryEntry> {
  const recovery = await getLedgerRecovery(ledgerId)
  if (!recovery) throw new Error('没有可恢复的上一版本')
  await saveLedger(recovery.container, recovery.index)
  return recovery
}

/** Durable encrypted pre-migration snapshot; ordinary edits never overwrite it. */
export async function getMigrationBackup(ledgerId: string): Promise<EncryptedLedgerContainer | undefined> {
  const db = await openDb()
  try {
    const entry = await requestResult<{ container: EncryptedLedgerContainer } | undefined>(db.transaction('migration').objectStore('migration').get(ledgerId))
    return entry?.container
  } finally { db.close() }
}
