import type { Account, BalanceMap, Currency, Ledger, Tag, Transaction, TransactionDraft } from './types'
import { currencies } from './types'
import { defaultTheme } from './theme'
import { assertCanSetParent, expandTagAncestors, validateTagHierarchy } from './tag-hierarchy'

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
export const defaultTagNames = ['收入', '出行', '饮食', '娱乐', '生活'] as const
const transactionKinds = new Set(['income', 'expense', 'transfer'])
const recordRoles = new Set(['normal', 'reversal', 'replacement', 'restoration', 'system-account-open', 'system-account-close'])

export function normalizeName(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase()
}

export function createLedger(name: string): Ledger {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('账本名称不能为空')
  const timestamp = now()
  const tags = defaultTagNames.map((tagName) => ({
    id: id(),
    name: tagName,
    normalizedName: normalizeName(tagName),
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  return { id: id(), name: cleanName, schemaVersion: 2, hierarchyChanges: [], createdAt: timestamp, updatedAt: timestamp, accounts: [], tags, transactions: [], settings: { ...defaultTheme, autoLockSeconds: 300 } }
}

/** Strict trust-boundary validation for decrypted/imported data. */
export function validateLedgerData(value: unknown): asserts value is Ledger {
  if (!value || typeof value !== 'object') throw new Error('账本数据不是有效对象')
  const ledger = value as Ledger
  if (ledger.schemaVersion !== 1 && ledger.schemaVersion !== 2) throw new Error('不支持此账本数据版本，请更新客户端')
  if ( typeof ledger.id !== 'string' || !ledger.id || typeof ledger.name !== 'string' || !ledger.name.trim()) throw new Error('账本基础信息无效')
  if (!Array.isArray(ledger.accounts) || !Array.isArray(ledger.tags) || !Array.isArray(ledger.transactions) || !ledger.settings || typeof ledger.settings !== 'object') throw new Error('账本数据结构不完整')
  const assertUniqueIds = (items: { id: string }[], label: string) => {
    if (items.some((item) => !item || typeof item.id !== 'string' || !item.id) || new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`${label} ID 无效或重复`)
  }
  assertUniqueIds(ledger.accounts, '账户'); assertUniqueIds(ledger.tags, '标签'); assertUniqueIds(ledger.transactions, '账目')
  const normalizedAccounts = new Set<string>(); const normalizedTags = new Set<string>()
  for (const account of ledger.accounts) {
    if (typeof account.name !== 'string' || !account.name.trim() || typeof account.isPendingSpend !== 'boolean') throw new Error('账户信息无效')
    const normalized = normalizeName(account.name); if (normalizedAccounts.has(normalized) && !account.deletedAt) throw new Error('存在重复的有效账户名称'); if (!account.deletedAt) normalizedAccounts.add(normalized)
  }
  for (const tag of ledger.tags) {
    if (tag.id === '__system__') throw new Error('系统标记不能用作用户标签')
    const normalized = typeof tag.name === 'string' ? normalizeName(tag.name) : ''
    if (!normalized || tag.normalizedName !== normalized || normalizedTags.has(normalized)) throw new Error('标签名称无效或重复')
    normalizedTags.add(normalized)
  }
  if (ledger.schemaVersion === 1 && ledger.tags.some(tag => tag.parentId !== undefined)) throw new Error('旧版账本不应包含父级关系')
  validateTagHierarchy(ledger.tags)
  if (ledger.schemaVersion === 2 && (!Array.isArray(ledger.hierarchyChanges) || ledger.hierarchyChanges.some(change =>
    !change || typeof change.tagId !== 'string' || typeof change.changedAt !== 'string' ||
    !['reparent', 'delete'].includes(change.action) || !Number.isSafeInteger(change.affectedTransactions) || change.affectedTransactions < 0 ||
    (change.parentId !== undefined && typeof change.parentId !== 'string') || (change.previousParentId !== undefined && typeof change.previousParentId !== 'string')
  ))) throw new Error('标签层级审计信息无效')
  const accountIds = new Set(ledger.accounts.map((item) => item.id)); const tagIds = new Set(ledger.tags.map((item) => item.id)); const transactionIds = new Set(ledger.transactions.map((item) => item.id))
  for (const transaction of ledger.transactions) {
    if (!transactionKinds.has(transaction.kind) || !recordRoles.has(transaction.recordRole) || typeof transaction.note !== 'string' || transaction.note.length > 240 || typeof transaction.bookedAt !== 'string' || !transaction.bookedAt) throw new Error('账目基础信息无效')
    const system = transaction.recordRole === 'system-account-close' || transaction.recordRole === 'reversal' || transaction.recordRole === 'restoration' ||
      (transaction.recordRole === 'replacement' && ledger.transactions.some(tx => tx.id === transaction.targetTransactionId && tx.recordRole === 'system-account-close'))
    const validTag = (tagId: string) => tagIds.has(tagId) || (system && tagId === '__system__')
    if (!Array.isArray(transaction.selectedTagIds) || new Set(transaction.selectedTagIds).size !== transaction.selectedTagIds.length || transaction.selectedTagIds.some(tagId => !validTag(tagId))) throw new Error('账目引用了无效或重复标签')
    if (ledger.schemaVersion === 2) {
      const direct = transaction.explicitTagIds
      if (!Array.isArray(direct) || new Set(direct).size !== direct.length || direct.some(tagId => !validTag(tagId))) throw new Error('账目直接标签无效')
      if (JSON.stringify(expandTransactionTags(ledger.tags, direct)) !== JSON.stringify(transaction.selectedTagIds)) throw new Error('账目祖先标签与直接选择不一致')
      if (transaction.primaryTagId && !direct.includes(transaction.primaryTagId)) throw new Error('主标签必须直接选中')
    }
    const checkMoney = (money: Transaction['sourceMoney'], label: string) => { if (!money || !currencies.includes(money.currency) || !Number.isSafeInteger(money.minorUnits) || money.minorUnits < 0) throw new Error(`${label}无效`) }
    if (transaction.kind === 'income') { if (!transaction.destinationAccountId || !accountIds.has(transaction.destinationAccountId)) throw new Error('收入账目账户无效'); checkMoney(transaction.destinationMoney, '收入金额') }
    if (transaction.kind === 'expense') { if (!transaction.sourceAccountId || !accountIds.has(transaction.sourceAccountId)) throw new Error('支出账目账户无效'); checkMoney(transaction.sourceMoney, '支出金额') }
    if (transaction.kind === 'transfer') { if (!transaction.sourceAccountId || !accountIds.has(transaction.sourceAccountId) || !transaction.destinationAccountId || !accountIds.has(transaction.destinationAccountId)) throw new Error('转移账目账户无效'); checkMoney(transaction.sourceMoney, '支出金额'); checkMoney(transaction.destinationMoney, '收入金额') }
    if (transaction.kind === 'expense' && (transaction.recordRole === 'normal' || transaction.recordRole === 'replacement')) {
      if (!transaction.selectedTagIds.length || !transaction.primaryTagId || !transaction.selectedTagIds.includes(transaction.primaryTagId)) throw new Error('支出账目缺少有效主标签')
    }
    if (transaction.targetTransactionId && (!transactionIds.has(transaction.targetTransactionId) || transaction.targetTransactionId === transaction.id)) throw new Error('账目审计引用无效')
    if (transaction.relatedTransactionIds?.some((id) => !transactionIds.has(id))) throw new Error('账目更正组引用无效')
  }
  for (const amounts of Object.values(projectBalances(ledger))) for (const amount of Object.values(amounts)) if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('账本包含负余额或越界余额')
  const timeout = ledger.settings.autoLockSeconds
  if (timeout !== undefined && (!Number.isInteger(timeout) || Number(timeout) < 30 || Number(timeout) > 86_400)) throw new Error('自动暂离设置无效')
}

export function projectBalances(ledger: Ledger): BalanceMap {
  const result: BalanceMap = {}
  for (const account of ledger.accounts) result[account.id] = {}
  for (const tx of ledger.transactions) {
    if (tx.sourceAccountId && tx.sourceMoney) adjust(result, tx.sourceAccountId, tx.sourceMoney.currency, -tx.sourceMoney.minorUnits)
    if (tx.destinationAccountId && tx.destinationMoney) adjust(result, tx.destinationAccountId, tx.destinationMoney.currency, tx.destinationMoney.minorUnits)
  }
  return result
}

function adjust(balances: BalanceMap, accountId: string, currency: Currency, delta: number) {
  balances[accountId] ??= {}
  balances[accountId]![currency] = (balances[accountId]![currency] ?? 0) + delta
}

function validateNonNegative(ledger: Ledger, candidateTransactions: Transaction[]) {
  const balances = projectBalances({ ...ledger, transactions: [...ledger.transactions, ...candidateTransactions] })
  for (const [accountId, byCurrency] of Object.entries(balances)) {
    for (const currency of currencies) {
      if ((byCurrency[currency] ?? 0) < 0) {
        const account = ledger.accounts.find((item) => item.id === accountId)
        throw new Error(`${account?.name ?? '未知账户'} 的 ${currency} 余额不足`)
      }
    }
  }
}

function validateMoney(money: TransactionDraft['sourceMoney'], field: string): void {
  if (!money || !currencies.includes(money.currency) || !Number.isSafeInteger(money.minorUnits) || money.minorUnits < 0) {
    throw new Error(`${field}必须是大于或等于 0 的有效金额`)
  }
}

function validateActiveAccount(ledger: Ledger, accountId: string | undefined, field: string): void {
  if (!accountId || !ledger.accounts.some((account) => account.id === accountId && !account.deletedAt)) {
    throw new Error(`${field}不存在或已删除`)
  }
}

function transactionFromDraft(draft: TransactionDraft, role: Transaction['recordRole'] = 'normal', groupId?: string, ledger?: Ledger): Transaction {
  const timestamp = now()
  if (!draft.bookedAt) throw new Error('请选择记账日期')
  if ((draft.note?.length ?? 0) > 240) throw new Error('备注不能超过 240 个字符')
  if (draft.kind === 'income') {
    if (!draft.destinationAccountId || !draft.destinationMoney) throw new Error('收入账目缺少收入账户或金额')
    validateMoney(draft.destinationMoney, '收入金额')
    if (ledger) validateActiveAccount(ledger, draft.destinationAccountId, '收入账户')
  }
  if (draft.kind === 'expense') {
    if (!draft.sourceAccountId || !draft.sourceMoney) throw new Error('支出账目缺少支出账户或金额')
    validateMoney(draft.sourceMoney, '支出金额')
    if (ledger) validateActiveAccount(ledger, draft.sourceAccountId, '支出账户')
    if (!draft.selectedTagIds?.length || !draft.primaryTagId || !draft.selectedTagIds.includes(draft.primaryTagId)) throw new Error('支出账目必须选择标签和主标签')
    if ((role === 'normal' || role === 'replacement') && ledger && draft.selectedTagIds.some((tagId) => !ledger.tags.some((tag) => tag.id === tagId))) throw new Error('支出账目包含不存在的标签')
  }
  if (draft.kind === 'transfer') {
    if (!draft.sourceAccountId || !draft.sourceMoney || !draft.destinationAccountId || !draft.destinationMoney) throw new Error('转移账目需要完整的收支两侧信息')
    validateMoney(draft.sourceMoney, '支出金额')
    validateMoney(draft.destinationMoney, '收入金额')
    if (ledger) {
      validateActiveAccount(ledger, draft.sourceAccountId, '支出账户')
      validateActiveAccount(ledger, draft.destinationAccountId, '收入账户')
    }
  }
  return {
    id: id(), kind: draft.kind, sourceAccountId: draft.sourceAccountId, sourceMoney: draft.sourceMoney,
    destinationAccountId: draft.destinationAccountId, destinationMoney: draft.destinationMoney,
    explicitTagIds: draft.kind === 'expense' ? [...new Set(draft.selectedTagIds ?? [])] : [],
    selectedTagIds: draft.kind === 'expense' ? (ledger ? expandTransactionTags(ledger.tags, draft.selectedTagIds ?? []) : [...new Set(draft.selectedTagIds ?? [])]) : [],
    primaryTagId: draft.kind === 'expense' ? draft.primaryTagId : undefined,
    note: draft.note?.trim() ?? '', bookedAt: draft.bookedAt, createdAt: timestamp, updatedAt: timestamp,
    recordRole: role, operationGroupId: groupId,
  }
}

export function addTransactions(ledger: Ledger, drafts: TransactionDraft[]): Transaction[] {
  if (!drafts.length) throw new Error('至少需要一条账目')
  const transactions = drafts.map((draft) => transactionFromDraft(draft, 'normal', undefined, ledger))
  validateNonNegative(ledger, transactions)
  ledger.transactions.push(...transactions)
  ledger.updatedAt = now()
  return transactions
}

export function addAccount(ledger: Ledger, name: string, isPendingSpend: boolean, initial: Partial<Record<Currency, number>>): Account {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('账户名称不能为空')
  if (ledger.accounts.some((item) => !item.deletedAt && normalizeName(item.name) === normalizeName(cleanName))) throw new Error('账户名称已存在')
  for (const currency of currencies) validateMoney({ currency, minorUnits: initial[currency] ?? 0 }, `${currency} 初始金额`)
  const timestamp = now()
  const account: Account = { id: id(), name: cleanName, isPendingSpend, createdAt: timestamp, updatedAt: timestamp }
  const groupId = id()
  const transactions = currencies.map((currency) => transactionFromDraft({
    kind: 'income', destinationAccountId: account.id, destinationMoney: { currency, minorUnits: initial[currency] ?? 0 },
    note: '账户初始余额', bookedAt: timestamp.slice(0, 10),
  }, 'system-account-open', groupId))
  ledger.accounts.push(account)
  ledger.transactions.push(...transactions)
  ledger.updatedAt = timestamp
  return account
}

export function updateAccount(ledger: Ledger, accountId: string, name: string, isPendingSpend: boolean): void {
  const account = ledger.accounts.find((item) => item.id === accountId && !item.deletedAt)
  if (!account) throw new Error('账户不存在或已删除')
  const cleanName = name.trim()
  if (!cleanName) throw new Error('账户名称不能为空')
  if (ledger.accounts.some((item) => item.id !== accountId && !item.deletedAt && normalizeName(item.name) === normalizeName(cleanName))) throw new Error('账户名称已存在')
  account.name = cleanName
  account.isPendingSpend = isPendingSpend
  account.updatedAt = now()
  ledger.updatedAt = account.updatedAt
}

export function deleteAccount(ledger: Ledger, accountId: string): void {
  const account = ledger.accounts.find((item) => item.id === accountId && !item.deletedAt)
  if (!account) throw new Error('账户不存在或已删除')
  const timestamp = now()
  const balances = projectBalances(ledger)[accountId] ?? {}
  const groupId = id()
  const transactions = currencies.map((currency) => transactionFromDraft({
    kind: 'expense', sourceAccountId: accountId, sourceMoney: { currency, minorUnits: balances[currency] ?? 0 },
    selectedTagIds: ['__system__'], primaryTagId: '__system__', note: '删除账户时移出余额', bookedAt: timestamp.slice(0, 10),
  }, 'system-account-close', groupId))
  account.deletedAt = timestamp
  account.updatedAt = timestamp
  ledger.transactions.push(...transactions)
  ledger.updatedAt = timestamp
}

export function restoreAccount(ledger: Ledger, accountId: string): void {
  const account = ledger.accounts.find((item) => item.id === accountId && item.deletedAt)
  if (!account) throw new Error('账户不存在或未删除')
  const latestClose = [...ledger.transactions].reverse().find((tx) => tx.recordRole === 'system-account-close' && tx.sourceAccountId === accountId)
  if (!latestClose?.operationGroupId) throw new Error('找不到账本删除审计记录')
  const closes = ledger.transactions.filter((tx) => tx.recordRole === 'system-account-close' && tx.sourceAccountId === accountId && tx.operationGroupId === latestClose.operationGroupId)
  const groupId = id()
  const timestamp = now()
  const restores = closes.flatMap((close) => {
    const restoration = {
    ...transactionFromDraft({ kind: 'income', destinationAccountId: accountId, destinationMoney: close.sourceMoney!, note: '恢复账户余额', bookedAt: close.bookedAt }, 'restoration', groupId),
    targetTransactionId: close.id,
      relatedTransactionIds: [close.id],
    }
    const replacement = {
      ...transactionFromDraft({
        kind: 'expense', sourceAccountId: accountId, sourceMoney: { currency: close.sourceMoney!.currency, minorUnits: 0 },
        selectedTagIds: ['__system__'], primaryTagId: '__system__', note: '账户恢复后的替代记录', bookedAt: close.bookedAt,
      }, 'replacement', groupId),
      targetTransactionId: close.id,
      relatedTransactionIds: [close.id, restoration.id],
    }
    restoration.relatedTransactionIds.push(replacement.id)
    return [restoration, replacement]
  })
  validateNonNegative(ledger, restores)
  ledger.transactions.push(...restores)
  account.deletedAt = undefined
  account.updatedAt = timestamp
  ledger.updatedAt = timestamp
}

export function addTag(ledger: Ledger, name: string, parentId?: string): Tag {
  const cleanName = name.trim()
  const normalizedName = normalizeName(cleanName)
  if (!normalizedName) throw new Error('标签名称不能为空')
  if (ledger.tags.some((tag) => tag.normalizedName === normalizedName)) throw new Error('标签名称已存在')
  const timestamp = now()
  const tag: Tag = { id: id(), name: cleanName, normalizedName, createdAt: timestamp, updatedAt: timestamp, parentId }
  validateTagHierarchy([...ledger.tags, tag])
  ledger.tags.push(tag)
  ledger.updatedAt = timestamp
  return tag
}

/** Direct selections are authoritative; internal markers stay outside the user tree. */
export function directTags(transaction: Transaction): string[] { return transaction.explicitTagIds ?? transaction.selectedTagIds }
function expandTransactionTags(tags: Tag[], direct: string[]): string[] {
  return [...new Set([...direct, ...expandTagAncestors(tags, direct.filter(id => id !== '__system__'))])]
}
function rebuildTagClosure(ledger: Ledger) {
  for (const transaction of ledger.transactions) transaction.selectedTagIds = expandTransactionTags(ledger.tags, directTags(transaction))
}
export function migrateLedgerV1(value: Ledger): Ledger {
  validateLedgerData(value)
  const candidate = structuredClone(value)
  if (candidate.schemaVersion === 2) return candidate
  candidate.schemaVersion = 2
  candidate.hierarchyChanges = []
  for (const tx of candidate.transactions) tx.explicitTagIds = [...tx.selectedTagIds]
  rebuildTagClosure(candidate)
  validateLedgerData(candidate)
  return candidate
}
export function previewTagParent(ledger: Ledger, tagId: string, parentId?: string) {
  assertCanSetParent(ledger.tags, tagId, parentId)
  const candidate = structuredClone(ledger)
  candidate.tags.find(tag => tag.id === tagId)!.parentId = parentId
  rebuildTagClosure(candidate)
  return candidate.transactions.filter((tx, index) => JSON.stringify(tx.selectedTagIds) !== JSON.stringify(ledger.transactions[index]!.selectedTagIds)).length
}
export function setTagParent(ledger: Ledger, tagId: string, parentId?: string): void {
  const affectedTransactions = previewTagParent(ledger, tagId, parentId)
  const tag = ledger.tags.find(tag => tag.id === tagId)!
  if (tag.parentId === parentId) return
  const changedAt = now()
  ledger.hierarchyChanges ??= []
  ledger.hierarchyChanges.push({ tagId, previousParentId: tag.parentId, parentId, changedAt, affectedTransactions, action: 'reparent' })
  tag.parentId = parentId
  tag.updatedAt = changedAt
  rebuildTagClosure(ledger)
  ledger.updatedAt = changedAt
}
export interface TagChildDisposition { mode: 'promote' | 'move'; parentId?: string }
function removeTagNode(ledger: Ledger, tagId: string, children?: TagChildDisposition) {
  const tag = ledger.tags.find(tag => tag.id === tagId)
  if (!tag) throw new Error('标签不存在')
  const childTags = ledger.tags.filter(tag => tag.parentId === tagId)
  if (childTags.length && !children) throw new Error('请先选择子标签的去向')
  if (children && !['promote', 'move'].includes(children.mode)) throw new Error('无效的子标签处理方式')
  const parentId = children?.mode === 'move' ? children.parentId : tag.parentId
  if (parentId) assertCanSetParent(ledger.tags, tagId, parentId)
  for (const child of childTags) setTagParent(ledger, child.id, parentId)
  ledger.tags = ledger.tags.filter(tag => tag.id !== tagId)
  rebuildTagClosure(ledger)
  ledger.hierarchyChanges ??= []
  ledger.hierarchyChanges.push({ tagId, previousParentId: tag.parentId, changedAt: now(), affectedTransactions: 0, action: 'delete' })
  ledger.updatedAt = now()
}
export function deleteTag(ledger: Ledger, tagId: string, children?: TagChildDisposition): void {
  if (ledger.transactions.some(tx => directTags(tx).includes(tagId))) throw new Error('该标签仍被账目直接引用，暂时无法删除')
  removeTagNode(ledger, tagId, children)
}

export interface TagDeletionResolution {
  transactionId: string
  action: 'remove' | 'replace'
  replacementTagId?: string
  replacementTagName?: string
}

export function resolveAndDeleteTag(ledger: Ledger, tagId: string, resolutions: TagDeletionResolution[], children?: TagChildDisposition): void {
  const tag = ledger.tags.find((item) => item.id === tagId)
  if (!tag) throw new Error('标签不存在')
  const references = ledger.transactions.filter((transaction) => directTags(transaction).includes(tagId))
  const resolutionByTransaction = new Map(resolutions.map((resolution) => [resolution.transactionId, resolution]))
  if (references.some((transaction) => !resolutionByTransaction.has(transaction.id))) throw new Error('仍有包含该标签的账目尚未处理')

  const plannedTags = new Map<string, Tag>()
  const resolved = references.map((transaction) => {
    const resolution = resolutionByTransaction.get(transaction.id)!
    let replacementId = resolution.replacementTagId
    if (resolution.action === 'replace') {
      if (replacementId === tagId) throw new Error('替换目标不能是待删除标签')
      if (replacementId && !ledger.tags.some((item) => item.id === replacementId)) throw new Error('替换目标标签不存在')
      if (!replacementId) {
        const cleanName = resolution.replacementTagName?.trim() ?? ''
        const normalizedName = normalizeName(cleanName)
        if (!normalizedName || normalizedName === tag.normalizedName) throw new Error('请输入有效的替换标签名称')
        const existing = ledger.tags.find((item) => item.normalizedName === normalizedName)
        if (existing) replacementId = existing.id
        else {
          const planned = plannedTags.get(normalizedName) ?? { id: id(), name: cleanName, normalizedName, createdAt: now(), updatedAt: now() }
          plannedTags.set(normalizedName, planned)
          replacementId = planned.id
        }
      }
    }
    const selectedTagIds = resolution.action === 'remove'
      ? directTags(transaction).filter((selectedId) => selectedId !== tagId)
      : directTags(transaction).map((selectedId) => selectedId === tagId ? replacementId! : selectedId).filter((selectedId, index, values) => values.indexOf(selectedId) === index)
    const primaryTagId = transaction.primaryTagId === tagId ? replacementId : transaction.primaryTagId
    if (!selectedTagIds.length || !primaryTagId || !selectedTagIds.includes(primaryTagId)) throw new Error('主标签账目必须指定新的主标签')
    return { transaction, selectedTagIds, primaryTagId }
  })

  const timestamp = now()
  ledger.tags.push(...plannedTags.values())
  for (const item of resolved) {
    item.transaction.explicitTagIds = item.selectedTagIds
    item.transaction.primaryTagId = item.primaryTagId
    item.transaction.updatedAt = timestamp
  }
  removeTagNode(ledger, tagId, children)
  ledger.updatedAt = timestamp
}

export interface PendingTag { clientId: string; name: string; parentId?: string }

export function addTransactionsWithTags(ledger: Ledger, drafts: TransactionDraft[], pendingTags: PendingTag[]): Transaction[] {
  if (!drafts.length) throw new Error('至少需要一条账目')
  if (new Set(pendingTags.map(tag => tag.clientId)).size !== pendingTags.length || pendingTags.some(tag => !tag.clientId || ledger.tags.some(existing => existing.id === tag.clientId))) throw new Error('临时标签 ID 无效或重复')
  const plannedTags: Tag[] = []
  const tagIdMap = new Map<string, string>()
  const referencedTagIds = new Set(drafts.flatMap((draft) => [...(draft.selectedTagIds ?? []), ...(draft.primaryTagId ? [draft.primaryTagId] : [])]))
  const pendingIndex = new Map(pendingTags.map(tag => [tag.clientId, tag]))
  for (const ref of [...referencedTagIds]) {
    const seen = new Set<string>()
    let current: string | undefined = ref
    while (current && pendingIndex.has(current)) {
      if (seen.has(current)) throw new Error('父子标签关系不能成环')
      seen.add(current); referencedTagIds.add(current); current = pendingIndex.get(current)!.parentId
    }
  }
  for (const pending of pendingTags.filter((tag) => referencedTagIds.has(tag.clientId))) {
    const cleanName = pending.name.trim()
    const normalizedName = normalizeName(cleanName)
    if (!normalizedName) throw new Error('标签名称不能为空')
    const existing = [...ledger.tags, ...plannedTags].find((tag) => tag.normalizedName === normalizedName)
    if (existing) tagIdMap.set(pending.clientId, existing.id)
    else {
      const timestamp = now()
      const tag = { id: id(), name: cleanName, normalizedName, createdAt: timestamp, updatedAt: timestamp }
      plannedTags.push(tag)
      tagIdMap.set(pending.clientId, tag.id)
    }
  }
  for (const pending of pendingTags) {
    const tag = plannedTags.find(tag => tag.id === tagIdMap.get(pending.clientId))
    if (tag && pending.parentId) tag.parentId = tagIdMap.get(pending.parentId) ?? pending.parentId
  }
  validateTagHierarchy([...ledger.tags, ...plannedTags])
  const mappedDrafts = drafts.map((draft) => ({
    ...draft,
    selectedTagIds: draft.selectedTagIds?.map((tagId) => tagIdMap.get(tagId) ?? tagId),
    primaryTagId: draft.primaryTagId ? tagIdMap.get(draft.primaryTagId) ?? draft.primaryTagId : undefined,
  }))
  const shadow = { ...ledger, tags: [...ledger.tags, ...plannedTags] }
  const transactions = mappedDrafts.map((draft) => transactionFromDraft(draft, 'normal', undefined, shadow))
  validateNonNegative(ledger, transactions)
  ledger.tags.push(...plannedTags)
  ledger.transactions.push(...transactions)
  ledger.updatedAt = now()
  return transactions
}

function reverseDraft(tx: Transaction): TransactionDraft {
  return {
    kind: tx.kind === 'income' ? 'expense' : tx.kind === 'expense' ? 'income' : 'transfer',
    sourceAccountId: tx.kind === 'income' ? tx.destinationAccountId : tx.kind === 'expense' ? undefined : tx.destinationAccountId,
    sourceMoney: tx.kind === 'income' ? tx.destinationMoney : tx.kind === 'expense' ? undefined : tx.destinationMoney,
    destinationAccountId: tx.kind === 'expense' ? tx.sourceAccountId : tx.kind === 'income' ? undefined : tx.sourceAccountId,
    destinationMoney: tx.kind === 'expense' ? tx.sourceMoney : tx.kind === 'income' ? undefined : tx.sourceMoney,
    selectedTagIds: tx.kind === 'income' ? ['__system__'] : [], primaryTagId: tx.kind === 'income' ? '__system__' : undefined,
    note: `冲销：${tx.note}`, bookedAt: tx.bookedAt,
  }
}

function rootTransaction(ledger: Ledger, transactionId: string): Transaction | undefined {
  const transaction = ledger.transactions.find((item) => item.id === transactionId)
  if (!transaction) return undefined
  if (transaction.recordRole === 'normal') return transaction
  if (transaction.recordRole === 'replacement' && transaction.targetTransactionId) {
    return ledger.transactions.find((item) => item.id === transaction.targetTransactionId && item.recordRole === 'normal')
  }
  return undefined
}

export function effectiveTransaction(ledger: Ledger, rootId: string): Transaction | undefined {
  const root = ledger.transactions.find((item) => item.id === rootId && item.recordRole === 'normal')
  if (!root) return undefined
  return [...ledger.transactions].reverse().find((item) => item.recordRole === 'replacement' && item.targetTransactionId === rootId) ?? root
}

export function transactionAuditChain(ledger: Ledger, transactionId: string): Transaction[] {
  const root = rootTransaction(ledger, transactionId)
  if (!root) return []
  const replacements = ledger.transactions.filter((item) => item.recordRole === 'replacement' && item.targetTransactionId === root.id)
  const effectiveIds = new Set([root.id, ...replacements.map((item) => item.id)])
  return ledger.transactions
    .filter((item) => item.id === root.id || item.targetTransactionId === root.id || (item.targetTransactionId && effectiveIds.has(item.targetTransactionId)) || item.relatedTransactionIds?.some((id) => effectiveIds.has(id)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function updateTransactionTags(ledger: Ledger, transactionId: string, selectedTagIds: string[], primaryTagId: string): void {
  const root = rootTransaction(ledger, transactionId)
  const target = root ? effectiveTransaction(ledger, root.id) : undefined
  if (!target || target.kind !== 'expense') throw new Error('只能修改有效支出账目的标签')
  if (!selectedTagIds.length || !primaryTagId || !selectedTagIds.includes(primaryTagId)) throw new Error('支出账目必须选择标签和主标签')
  if (selectedTagIds.some((tagId) => !ledger.tags.some((tag) => tag.id === tagId))) throw new Error('支出账目包含不存在的标签')
  target.explicitTagIds = [...new Set(selectedTagIds)]
  target.selectedTagIds = expandTagAncestors(ledger.tags, target.explicitTagIds)
  target.primaryTagId = primaryTagId
  target.updatedAt = now()
  ledger.updatedAt = target.updatedAt
}

export function correctTransaction(ledger: Ledger, transactionId: string, draft: TransactionDraft): Transaction {
  const root = rootTransaction(ledger, transactionId)
  if (!root || isTransactionDeleted(ledger, root.id)) throw new Error('账目不存在或已删除')
  const current = effectiveTransaction(ledger, root.id)!
  const groupId = id()
  const reversal = transactionFromDraft(reverseDraft(current), 'reversal', groupId)
  reversal.targetTransactionId = current.id
  const replacement = transactionFromDraft({ ...draft, bookedAt: root.bookedAt }, 'replacement', groupId, ledger)
  replacement.targetTransactionId = root.id
  reversal.relatedTransactionIds = [root.id, replacement.id]
  replacement.relatedTransactionIds = [root.id, current.id, reversal.id]
  validateNonNegative(ledger, [reversal, replacement])
  ledger.transactions.push(reversal, replacement)
  ledger.updatedAt = replacement.updatedAt
  return replacement
}

export function reverseTransaction(ledger: Ledger, transactionId: string): Transaction {
  const root = rootTransaction(ledger, transactionId)
  if (!root) throw new Error('只能删除普通账目')
  if (isTransactionDeleted(ledger, root.id)) throw new Error('账目已经删除')
  const target = effectiveTransaction(ledger, root.id)!
  const reversal = transactionFromDraft(reverseDraft(target), 'reversal')
  reversal.targetTransactionId = root.id
  reversal.relatedTransactionIds = target.id === root.id ? [root.id] : [root.id, target.id]
  validateNonNegative(ledger, [reversal])
  ledger.transactions.push(reversal)
  ledger.updatedAt = now()
  return reversal
}

export function isTransactionDeleted(ledger: Ledger, transactionId: string): boolean {
  const reversals = ledger.transactions.filter((tx) => tx.recordRole === 'reversal' && !tx.operationGroupId && tx.targetTransactionId === transactionId)
  return reversals.some((reversal) => !ledger.transactions.some((tx) => tx.recordRole === 'restoration' && tx.targetTransactionId === reversal.id))
}

export function restoreTransaction(ledger: Ledger, transactionId: string): Transaction {
  const target = rootTransaction(ledger, transactionId)
  const reversal = [...ledger.transactions].reverse().find((tx) => tx.recordRole === 'reversal' && tx.targetTransactionId === target?.id && !tx.operationGroupId && !ledger.transactions.some((candidate) => candidate.recordRole === 'restoration' && candidate.targetTransactionId === tx.id))
  if (!target || !reversal) throw new Error('账目不存在或未被删除')
  const restoration = transactionFromDraft(reverseDraft(reversal), 'restoration')
  restoration.targetTransactionId = reversal.id
  restoration.relatedTransactionIds = [target.id, reversal.id]
  validateNonNegative(ledger, [restoration])
  ledger.transactions.push(restoration)
  ledger.updatedAt = now()
  return restoration
}
