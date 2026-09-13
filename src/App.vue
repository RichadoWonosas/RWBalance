<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currencyRules, formatMinorUnits, formatMoney, toMinorUnits } from './core/domain/money'
import { currencies, type Currency, type TagCategory, type Transaction, type TransactionDraft, type TransactionKind } from './core/domain/types'
import { directTags, type PendingTag, type TagDeletionResolution } from './core/domain/ledger'
import { defaultTheme, normalizeHue, profileForHue, lightThemeColor, hslColor, previewThemeColor, type ColorTone, type ThemeChannel } from './core/domain/theme'
import { useLedgerStore } from './modules/ledger/session'
import { appPages, type AppPage } from './app/router'
import { rememberedAppearance, rememberAppearance, selectLedgerAppearance } from './app/appearance-memory'
import { applyPwaUpdate, pwaUpdateInstalling, pwaUpdateReady } from './app/pwa'
import PickerDialog from './components/PickerDialog.vue'
import TagSelection from './components/TagSelection.vue'
import TagParentPicker from './components/TagParentPicker.vue'
import { assertCanSetParent, expandTagAncestors, flattenTagHierarchy, rootTagId, tagPath } from './core/domain/tag-hierarchy'
import { implicitTagName, isImplicitTagId, transactionStatisticalFlows } from './core/domain/statistics'
import AccountPicker from './components/AccountPicker.vue'
import AnalyticsPage from './components/AnalyticsPage.vue'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import DashboardPage from './components/DashboardPage.vue'
import AccountsPage from './components/AccountsPage.vue'
import LoginPage from './components/LoginPage.vue'
import TagsPage from './components/TagsPage.vue'
import SettingsPage, { type SettingsSection } from './components/SettingsPage.vue'
import TransactionsPage, { type TransactionFilters } from './components/TransactionsPage.vue'
import AppModal from './components/AppModal.vue'
import OccurrenceMigrationDialog, { type MigrationTimeRow } from './components/OccurrenceMigrationDialog.vue'
import ThemeDialog from './components/ThemeDialog.vue'
import TagWizardDialog from './components/TagWizardDialog.vue'
import AccountFormDialog, { type AccountCreateForm, type AccountEditForm } from './components/AccountFormDialog.vue'
import TransactionEntryDialog, { type DraftForm } from './components/TransactionEntryDialog.vue'
import LedgerDeleteDialog, { type LedgerDeleteForm } from './components/LedgerDeleteDialog.vue'
import { blockingCapabilityMessages, detectPlatformCapabilities } from './core/platform/capabilities'
import type { EncryptionId, KdfId } from './core/security/crypto'
import lightCompassDialUrl from './assets/theme/compass-dial-light.svg?url'
import darkCompassDialUrl from './assets/theme/compass-dial-dark.svg?url'

const session = useLedgerStore()
const route = useRoute()
const router = useRouter()
const page = computed<AppPage>({
  get: () => appPages.includes(route.name as AppPage) ? route.name as AppPage : 'dashboard',
  set: (value) => { void router.push({ name: value }) },
})
const settingsSection = ref<SettingsSection | null>('security')
type SessionTransition = 'idle' | 'unlocking' | 'locking'
const sessionTransition = ref<SessionTransition>('idle')
const showLogin = computed(() => !session.isUnlocked || sessionTransition.value !== 'idle')
const search = ref('')
type Dialog = 'tag-create' | 'tag-edit' | 'account-create' | 'create' | 'unlock' | 'import' | 'import-conflict' | 'rename-name' | 'rename-secret' | 'delete' | 'theme' | 'transaction-entry' | 'discard-entry' | 'account-edit' | 'account-delete' | 'tag-delete-warning' | 'tag-delete-resolve' | 'tag-delete-confirm' | 'transaction-delete' | 'transaction-tags' | 'transaction-correct' | 'transaction-order' | 'audit-chain' | 'change-passphrase' | 'security-migration' | 'restore-recovery'
const dialog = ref<Dialog | null>(null)
const suspendedWorkspace = ref<{ ledgerId: string; page: AppPage; dialog: Dialog | null }>()
const selectedLedgerId = ref('')
const createAdvanced = ref(false)
const createForm = reactive({ name: '', secret: '', confirmation: '', kdf: 'PBKDF2-SHA-256' as KdfId, encryption: 'AES-256-GCM' as EncryptionId })
const secret = ref('')
const importFile = ref<File>()
const importDragging = ref(false)
const importInfo = ref<{ ledgerId: string; displayName: string; conflict: 'none' | 'id' | 'name' }>()
const capabilities = detectPlatformCapabilities()
const missingCapabilities = blockingCapabilityMessages(capabilities)
const passphraseForm = reactive({ oldSecret: '', newSecret: '', confirmation: '' })
const securityForm = reactive<{ secret: string; kdf: KdfId; encryption: EncryptionId }>({ secret: '', kdf: 'PBKDF2-SHA-256', encryption: 'AES-256-GCM' })
const recoverySecret = ref('')
const migrationTimeRows = ref<MigrationTimeRow[]>([])
const migrationDragIndex = ref<number | null>(null)
type ToastType = 'success' | 'warning' | 'error'
interface ToastMessage { id: number; type: ToastType; message: string }
const toasts = ref<ToastMessage[]>([])
let toastSequence = 0
function dismissToast(id: number) { toasts.value = toasts.value.filter((toast) => toast.id !== id) }
function notify(type: ToastType, message: string) {
  const toast = { id: ++toastSequence, type, message }
  if (toasts.value.length >= 5) toasts.value.shift()
  toasts.value.push(toast)
  window.setTimeout(() => dismissToast(toast.id), 5_000)
}
async function loadPwaUpdate() {
  try { await applyPwaUpdate() }
  catch { notify('error', '新版本载入失败，请稍后重试') }
}
watch(() => session.error, (error) => { if (error) notify('error', error) })
function localDateTime(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 19)
}
function occurredAtFromLocal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('请填写有效的发生时间')
  const normalized = value.length === 16 ? `${value}:00` : value
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) throw new Error('发生时间无效')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${normalized}${sign}${hours}:${minutes}`
}
function displayOccurredAt(transaction: Transaction | TransactionDraft) { return transaction.occurredAt?.replace('T', ' ').slice(0, 19) ?? transaction.bookedAt }
function generateMigrationTimes() {
  const positions = new Map<string, number>()
  for (const row of migrationTimeRows.value) {
    const position = positions.get(row.bookedAt) ?? 0
    const seconds = Math.max(0, 20 * 3600 - position * 60)
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0')
    const minutes = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')
    row.occurredAtLocal = `${row.bookedAt}T${hours}:${minutes}:00`
    positions.set(row.bookedAt, position + 1)
  }
}
watch(() => session.migration?.migrationInfo, (info) => {
  migrationTimeRows.value = (info?.occurrenceEntries ?? []).map((entry) => ({ ...entry, occurredAtLocal: '' }))
  if (migrationTimeRows.value.length) generateMigrationTimes()
})
function moveListItem<T>(items: T[], from: number, to: number) {
  const [item] = items.splice(from, 1)
  if (item !== undefined) items.splice(to, 0, item)
}
type ReorderScope = 'migration' | 'pending' | 'transaction-order'
let pointerReorder: { scope: ReorderScope; index: number; pointerId: number } | undefined
function setActiveDragIndex(scope: ReorderScope, index: number | null) {
  if (scope === 'migration') migrationDragIndex.value = index
  else if (scope === 'pending') pendingDraftDragIndex.value = index
  else transactionOrderDragIndex.value = index
}
function startPointerReorder(event: PointerEvent, scope: ReorderScope, index: number) {
  if (event.pointerType === 'mouse') return
  pointerReorder = { scope, index, pointerId: event.pointerId }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  setActiveDragIndex(scope, index)
}
function movePointerReorder(event: PointerEvent) {
  if (!pointerReorder || pointerReorder.pointerId !== event.pointerId) return
  const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[data-reorder-scope="${pointerReorder.scope}"]`)
  const target = Number(targetElement?.dataset.reorderIndex)
  if (!Number.isInteger(target) || target === pointerReorder.index) return
  if (pointerReorder.scope === 'migration') moveMigrationRow(pointerReorder.index, target)
  else if (pointerReorder.scope === 'pending') movePendingDraft(pointerReorder.index, target)
  else moveTransactionOrderRow(pointerReorder.index, target)
  pointerReorder.index = target
  setActiveDragIndex(pointerReorder.scope, target)
}
function finishPointerReorder(event: PointerEvent) {
  if (!pointerReorder || pointerReorder.pointerId !== event.pointerId) return
  setActiveDragIndex(pointerReorder.scope, null)
  pointerReorder = undefined
}
function moveMigrationRow(index: number, target: number) {
  const rows = migrationTimeRows.value
  if (!rows[index] || !rows[target] || rows[index]!.bookedAt !== rows[target]!.bookedAt) return
  const bookedAt = rows[index]!.bookedAt
  const timeSlots = rows.filter((row) => row.bookedAt === bookedAt).map((row) => row.occurredAtLocal)
  moveListItem(rows, index, target)
  rows.filter((row) => row.bookedAt === bookedAt).forEach((row, position) => { row.occurredAtLocal = timeSlots[position]! })
}
function startMigrationDrag(event: DragEvent, index: number) {
  migrationDragIndex.value = index
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function startMigrationPointer(event: PointerEvent, index: number) { startPointerReorder(event, 'migration', index) }
function startPendingPointer(event: PointerEvent, index: number) { startPointerReorder(event, 'pending', index) }
function dropMigrationRow(index: number) {
  if (migrationDragIndex.value !== null) moveMigrationRow(migrationDragIndex.value, index)
  migrationDragIndex.value = null
}
function nudgeMigrationRow(index: number, direction: -1 | 1) {
  moveMigrationRow(index, index + direction)
}
function confirmOccurrenceMigration() {
  try {
    const occurredAt: Record<string, string> = {}
    const latestByDate = new Map<string, string>()
    for (const row of migrationTimeRows.value) {
      if (!row.occurredAtLocal.startsWith(`${row.bookedAt}T`)) throw new Error('发生时间必须位于原记账日期内')
      const previous = latestByDate.get(row.bookedAt)
      if (previous && row.occurredAtLocal > previous) throw new Error(`${row.bookedAt} 的发生时间与当前排列顺序不一致`)
      latestByDate.set(row.bookedAt, row.occurredAtLocal)
      occurredAt[row.id] = occurredAtFromLocal(row.occurredAtLocal)
    }
    session.confirmMigration(occurredAt)
  } catch (cause) { notify('error', messageOf(cause)) }
}
function cancelOccurrenceMigration() {
  const shouldLockCurrentLedger = session.isUnlocked
  session.confirmMigration(false)
  if (shouldLockCurrentLedger) lock('away')
}
const previewPrimaryHue = ref<number>(defaultTheme.primaryHue)
const previewSecondaryHue = ref<number>(defaultTheme.secondaryHue)
const previewColorTone = ref<ColorTone>(defaultTheme.colorTone)
const themeChannel = ref<ThemeChannel>('primary')
const draggingHue = ref(false)
const renameTargetId = ref<string>()
const renameOriginalName = ref('')
const deleteForm = reactive<LedgerDeleteForm>({ ledgerId: '', name: '', secret: '', confirmed: false })

const filteredIndexes = computed(() => session.indexes.filter((entry) => entry.displayName.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const ledger = computed(() => session.ledger)
const currentPrimaryHue = computed(() => normalizeHue(ledger.value?.settings.primaryHue ?? rememberedAppearance.value.primaryHue, defaultTheme.primaryHue))
const currentSecondaryHue = computed(() => normalizeHue(ledger.value?.settings.secondaryHue ?? rememberedAppearance.value.secondaryHue, defaultTheme.secondaryHue))
const currentColorTone = computed<ColorTone>(() => ledger.value ? (ledger.value.settings.colorTone === 'dark' ? 'dark' : 'light') : rememberedAppearance.value.colorTone)
watch(() => ledger.value && ({
  primaryHue: normalizeHue(ledger.value.settings.primaryHue, defaultTheme.primaryHue),
  secondaryHue: normalizeHue(ledger.value.settings.secondaryHue, defaultTheme.secondaryHue),
  colorTone: ledger.value.settings.colorTone === 'dark' ? 'dark' as const : 'light' as const,
}), (appearance) => { if (appearance) rememberAppearance(appearance) }, { immediate: true, flush: 'sync' })
const currentAutoLockSeconds = computed(() => {
  const value = Number(ledger.value?.settings.autoLockSeconds ?? 300)
  return Number.isInteger(value) && value >= 30 && value <= 86_400 ? value : 300
})
const autoLockSecondsInput = ref(300)
watch(currentAutoLockSeconds, (seconds) => { autoLockSecondsInput.value = seconds }, { immediate: true })
const activePrimaryHue = computed(() => dialog.value === 'theme' ? previewPrimaryHue.value : currentPrimaryHue.value)
const activeSecondaryHue = computed(() => dialog.value === 'theme' ? previewSecondaryHue.value : currentSecondaryHue.value)
const activeColorTone = computed(() => dialog.value === 'theme' ? previewColorTone.value : currentColorTone.value)
const compassDialUrl = computed(() => activeColorTone.value === 'dark' ? darkCompassDialUrl : lightCompassDialUrl)
const selectedHue = computed({
  get: () => themeChannel.value === 'primary' ? previewPrimaryHue.value : previewSecondaryHue.value,
  set: (value: number) => {
    const normalized = normalizeHue(value)
    if (themeChannel.value === 'primary') previewPrimaryHue.value = normalized
    else previewSecondaryHue.value = normalized
  },
})
watchEffect(() => {
  const primaryProfile = profileForHue(activePrimaryHue.value, activeColorTone.value)
  const secondaryProfile = profileForHue(activeSecondaryHue.value, activeColorTone.value)
  const root = document.documentElement.style
  document.documentElement.dataset.colorTone = activeColorTone.value
  root.setProperty('--rw-theme-primary-saturation-scale', String(primaryProfile.saturation))
  root.setProperty('--rw-theme-primary-lightness-scale', String(primaryProfile.lightness))
  root.setProperty('--rw-theme-secondary-saturation-scale', String(secondaryProfile.saturation))
  root.setProperty('--rw-theme-secondary-lightness-scale', String(secondaryProfile.lightness))
  root.setProperty('--rw-theme-primary-hue', `${activePrimaryHue.value}`)
  root.setProperty('--rw-theme-primary-saturation', `${Math.round(72 * primaryProfile.saturation)}%`)
  root.setProperty('--rw-theme-primary-lightness', `${Math.round(48 * primaryProfile.lightness)}%`)
  root.setProperty('--rw-theme-secondary-hue', `${activeSecondaryHue.value}`)
  root.setProperty('--rw-theme-secondary-saturation', `${Math.round(78 * secondaryProfile.saturation)}%`)
  root.setProperty('--rw-theme-secondary-lightness', `${Math.round(53 * secondaryProfile.lightness)}%`)
  root.setProperty('--rw-color-light-banner', hslColor(lightThemeColor(activePrimaryHue.value, 'banner')))
  if (activeColorTone.value === 'light') {
    const primary = lightThemeColor(activePrimaryHue.value, 'action')
    const secondary = lightThemeColor(activeSecondaryHue.value, 'action')
    root.setProperty('--rw-theme-primary-saturation', `${primary.saturation}%`)
    root.setProperty('--rw-theme-primary-lightness', `${primary.lightness}%`)
    root.setProperty('--rw-theme-secondary-saturation', `${secondary.saturation}%`)
    root.setProperty('--rw-theme-secondary-lightness', `${secondary.lightness}%`)
  }
})
const balances = computed(() => ledger.value?.balances ?? {})
const activeAccounts = computed(() => ledger.value?.accounts.filter((account) => !account.deletedAt) ?? [])
const normalTransactions = computed(() => ledger.value?.normalTransactions ?? [])
const deletedTransactions = computed(() => ledger.value?.deletedTransactions ?? [])
function compareOccurrence(a: Transaction, b: Transaction, direction: 1 | -1) {
  const occurred = (a.occurredAt ?? a.bookedAt).localeCompare(b.occurredAt ?? b.bookedAt) * direction
  if (occurred) return occurred
  const revision = ((a.commitRevision ?? 0) - (b.commitRevision ?? 0)) * direction
  return revision || (a.commitIndex ?? 0) - (b.commitIndex ?? 0)
}
function compareModification(a: Transaction, b: Transaction, direction: 1 | -1) {
  return a.updatedAt.localeCompare(b.updatedAt) * direction
    || (a.updatedOrder ?? a.commitIndex ?? 0) - (b.updatedOrder ?? b.commitIndex ?? 0)
    || ((a.updatedRevision ?? 0) - (b.updatedRevision ?? 0)) * direction
}
const recentTransactions = computed(() => [...normalTransactions.value].sort((a, b) => compareOccurrence(a, b, -1)).slice(0, 6))
const totals = computed(() => ledger.value?.totals ?? Object.fromEntries(currencies.map((currency) => [currency, { income: 0, expense: 0 }])) as Record<Currency, { income: number; expense: number }>)

let autoLockTimer: number | undefined
const activityEvents = ['pointerdown', 'keydown', 'touchstart'] as const

function resetAutoLock() {
  if (autoLockTimer) window.clearTimeout(autoLockTimer)
  if (session.isUnlocked && sessionTransition.value === 'idle') autoLockTimer = window.setTimeout(() => lock('idle'), currentAutoLockSeconds.value * 1000)
}
function clearOnPageExit() { session.terminateSession() }

onMounted(async () => {
  if (missingCapabilities.length) { notify('error', `当前浏览器缺少必要能力：${missingCapabilities.join('、')}`); return }
  await session.initialize()
  if (!session.isUnlocked && route.name !== 'login') await router.replace({ name: 'login' })
  activityEvents.forEach((event) => window.addEventListener(event, resetAutoLock, { passive: true }))
  window.addEventListener('pagehide', clearOnPageExit)
  window.addEventListener('beforeunload', clearOnPageExit)
})
onBeforeUnmount(() => {
  if (autoLockTimer) window.clearTimeout(autoLockTimer)
  activityEvents.forEach((event) => window.removeEventListener(event, resetAutoLock))
  window.removeEventListener('pagehide', clearOnPageExit)
  window.removeEventListener('beforeunload', clearOnPageExit)
  session.terminateSession()
})

function openUnlock(id: string) {
  if (suspendedWorkspace.value && suspendedWorkspace.value.ledgerId !== id) clearWorkspaceDrafts()
  selectedLedgerId.value = id
  void selectLedgerAppearance(id)
  secret.value = ''
  dialog.value = 'unlock'
}
function openCreateDialog() {
  rememberAppearance({ ...defaultTheme })
  createAdvanced.value = false
  dialog.value = 'create'
}
function closeDialog() {
  if (dialog.value === 'transaction-entry' && hasUnsavedTransactionInput.value) {
    dialog.value = 'discard-entry'
    return
  }
  if (dialog.value === 'discard-entry') {
    dialog.value = 'transaction-entry'
    return
  }
  if (dialog.value === 'transaction-delete') transactionDeleteTargetId.value = ''
  dialog.value = null
  session.error = ''
  secret.value = ''
  importFile.value = undefined
  importInfo.value = undefined
  importDragging.value = false
  createForm.secret = ''
  createForm.confirmation = ''
  renameForm.secret = ''
  deleteForm.secret = ''
  Object.assign(passphraseForm, { oldSecret: '', newSecret: '', confirmation: '' })
  securityForm.secret = ''
  recoverySecret.value = ''
  previewPrimaryHue.value = currentPrimaryHue.value
  previewSecondaryHue.value = currentSecondaryHue.value
  previewColorTone.value = currentColorTone.value
}
async function createNewLedger() {
  if (createForm.secret !== createForm.confirmation) { session.error = '两次输入的口令不一致'; return }
  if (createForm.secret.length < 8) { session.error = '访问口令至少需要 8 个字符'; return }
  await session.create(createForm.name, createForm.secret, { kdf: createForm.kdf, encryption: createForm.encryption })
  if (session.isUnlocked) { clearWorkspaceDrafts(); page.value = 'dashboard'; Object.assign(createForm, { name: '', secret: '', confirmation: '' }); beginUnlockTransition() }
}
async function unlock() {
  const ledgerId = selectedLedgerId.value
  await session.unlock(ledgerId, secret.value)
  if (!session.isUnlocked) return
  secret.value = ''
  const suspended = suspendedWorkspace.value?.ledgerId === ledgerId ? suspendedWorkspace.value : undefined
  suspendedWorkspace.value = undefined
  dialog.value = suspended?.dialog ?? null
  autoLockSecondsInput.value = currentAutoLockSeconds.value
  beginUnlockTransition(suspended?.page ?? 'dashboard')
}
function openDeleteDialog(ledgerId: string, name: string) {
  Object.assign(deleteForm, { ledgerId, name, secret: '', confirmed: false })
  session.error = ''
  dialog.value = 'delete'
}
async function backupDeleteTarget() {
  if (await session.exportById(deleteForm.ledgerId)) notify('success', '加密备份已导出，可以继续删除')
}
async function deleteLedgerConfirmed() {
  if (!deleteForm.secret) { session.error = '请输入账本访问口令'; return }
  if (!deleteForm.confirmed) { session.error = '请确认已理解删除不可恢复'; return }
  const deletingCurrent = ledger.value?.id === deleteForm.ledgerId
  await session.remove(deleteForm.ledgerId, deleteForm.secret)
  if (!session.error) {
    if (suspendedWorkspace.value?.ledgerId === deleteForm.ledgerId) clearWorkspaceDrafts()
    Object.assign(deleteForm, { ledgerId: '', name: '', secret: '', confirmed: false })
    dialog.value = null
    if (deletingCurrent) await router.replace({ name: 'login' })
  }
}
async function importLedger() {
  if (!importFile.value) { session.error = '请选择账本文件'; return }
  const result = await session.inspectImportFile(importFile.value, secret.value)
  if (!result?.importInfo) return
  importInfo.value = result.importInfo
  if (result.importInfo.conflict === 'none') await completeImport('new')
  else dialog.value = 'import-conflict'
}
async function completeImport(mode: 'new' | 'copy' | 'replace') {
  if (!importFile.value) return
  const result = await session.importFile(importFile.value, secret.value, mode)
  if (!result || session.error) return
  const replaced = mode === 'replace'
  secret.value = ''; importFile.value = undefined; importInfo.value = undefined; dialog.value = null
  notify('success', replaced ? '现有账本已备份并被导入文件替换' : mode === 'copy' ? '账本已作为独立副本导入' : '账本文件已验证并导入')
}
function selectImportFile(file?: File) {
  if (!file) return
  if (!file.name.toLocaleLowerCase().endsWith('.rwbl')) { notify('warning', '请选择 .rwbl 账本文件'); return }
  importFile.value = file
}
function dropImportFile(event: DragEvent) {
  importDragging.value = false
  selectImportFile(event.dataTransfer?.files[0])
}
function beginUnlockTransition(destination: AppPage = 'dashboard') {
  sessionTransition.value = 'unlocking'
  void router.replace({ name: destination })
  window.setTimeout(() => { sessionTransition.value = 'idle'; resetAutoLock() }, 1_220)
}
function lock(reason: 'away' | 'exit' | 'idle' = 'away') {
  if (sessionTransition.value !== 'idle') return
  const leavingTemporarily = reason === 'away' || reason === 'idle'
  if (leavingTemporarily && ledger.value) suspendedWorkspace.value = { ledgerId: ledger.value.id, page: page.value, dialog: dialog.value }
  else clearWorkspaceDrafts()
  clearSensitiveInputs()
  dialog.value = null
  if (autoLockTimer) window.clearTimeout(autoLockTimer)
  sessionTransition.value = 'locking'
  window.setTimeout(() => {
    session.lock()
    page.value = 'dashboard'
    sessionTransition.value = 'idle'
    void router.replace({ name: 'login' })
    if (reason === 'idle') notify('warning', '账本因长时间未操作已暂离，重新解锁可继续工作')
    if (reason === 'away') notify('success', '账本已暂离，重新解锁可继续工作')
    if (reason === 'exit') notify('success', '当前账本已安全退出，临时内容已清除')
  }, 1_120)
}

const accountForm = reactive<AccountCreateForm>({ name: '', pending: false, initial: Object.fromEntries(currencies.map((currency) => [currency, '0'])) as Record<Currency, string> })
const accountEditForm = reactive<AccountEditForm>({ id: '', name: '', pending: false })
const accountDeleteTargetId = ref('')
const accountDeleteTarget = computed(() => ledger.value?.accounts.find((account) => account.id === accountDeleteTargetId.value))
async function createAccount() {
  if (!ledger.value) return
  try {
    const initial = Object.fromEntries(currencies.map((currency) => [currency, toMinorUnits(accountForm.initial[currency], currency)])) as Record<Currency, number>
    await session.addAccount(accountForm.name, accountForm.pending, initial)
    if (!session.error) {
      accountForm.name = ''; accountForm.pending = false; currencies.forEach((currency) => accountForm.initial[currency] = '0')
      dialog.value = null
      notify('success', '账户已创建')
    }
  } catch (cause) { session.error = messageOf(cause) }
}
function openAccountEdit(id: string) {
  const account = ledger.value?.accounts.find((item) => item.id === id)
  if (!account || account.deletedAt) return
  Object.assign(accountEditForm, { id: account.id, name: account.name, pending: account.isPendingSpend })
  dialog.value = 'account-edit'
}
async function saveAccountEdit() {
  await session.updateAccount(accountEditForm.id, accountEditForm.name, accountEditForm.pending)
  if (!session.error) { dialog.value = null; notify('success', '账户信息已更新') }
}
function openAccountDelete(id: string) { accountDeleteTargetId.value = id; dialog.value = 'account-delete' }
async function confirmAccountDelete() {
  await session.deleteAccount(accountDeleteTargetId.value)
  if (!session.error) { dialog.value = null; notify('success', '账户已删除，四个币种的审计流水已生成') }
}
async function recoverAccount(id: string) { if (!ledger.value) return; await session.restoreAccount(id); if (!session.error) notify('success', '账户及原余额已恢复') }

const parentEdit = reactive({ tagId: '', name: '', parentId: '', confirmed: false })
const tagCategoryOpen = ref<TagCategory | null>('income')
const expandedTagIds = ref<string[]>([])
watch(() => ledger.value?.id, () => { expandedTagIds.value = [] })
const tagsPageElement = ref<InstanceType<typeof TagsPage>>()
function expandTagPath(id?: string) {
  tagsPageElement.value?.expandTagPath(id)
}
const tagWizardCategory = ref<TagCategory>('income')
const tagWizardName = ref('')
const tagWizardParentId = ref('')
const tagWizardDrafts = ref<PendingTag[]>([])
const tagWizardPickerTags = computed(() => [
  ...tagWizardDrafts.value.map((tag, index) => ({ id: tag.clientId, name: tag.name, parentId: tag.parentId, category: tag.category, createdAt: String(index).padStart(8, '0'), isNew: true })),
  ...(ledger.value?.tags ?? []),
])
function tagWizardParentName(parentId?: string) {
  if (!parentId) return '根标签'
  return tagPath(tagWizardPickerTags.value, parentId) || '未知父级'
}
function openTagCreateWizard(category: TagCategory = 'income', initialName = '') {
  tagWizardCategory.value = category
  tagWizardName.value = initialName.trim()
  tagWizardParentId.value = ''
  tagWizardDrafts.value = []
  dialog.value = 'tag-create'
}
function stageWizardTag() {
  const name = tagWizardName.value.trim()
  if (!name) { notify('warning', '请输入标签名称'); return }
  const normalized = normalizeSearch(name)
  if ([...(ledger.value?.tags ?? []), ...tagWizardDrafts.value].some((tag) => normalizeSearch(tag.name) === normalized)) { notify('warning', '标签名称已存在'); return }
  tagWizardDrafts.value.push({ clientId: `temp:${crypto.randomUUID()}`, name, parentId: tagWizardParentId.value || undefined, category: tagWizardCategory.value })
  tagWizardName.value = ''
  tagWizardParentId.value = ''
}
async function confirmTagWizard() {
  if (!tagWizardDrafts.value.length) { notify('warning', '请先加入至少一个标签'); return }
  const result = await session.addTags(tagWizardDrafts.value)
  if (result) { const category = tagWizardCategory.value; dialog.value = null; tagCategoryOpen.value = category; notify('success', `${tagWizardDrafts.value.length} 个标签已添加`) }
}
function removeWizardTag(index: number) {
  const target = tagWizardDrafts.value[index]
  if (target && tagWizardDrafts.value.some((tag) => tag.parentId === target.clientId)) { notify('warning', '请先移除或调整它的子标签'); return }
  tagWizardDrafts.value.splice(index, 1)
}
function openTagEdit(id: string) {
  const tag = ledger.value?.tags.find(item => item.id === id)
  if (!tag) return
  Object.assign(parentEdit, { tagId: id, name: tag.name, parentId: tag.parentId ?? '', confirmed: false })
  dialog.value = 'tag-edit'
}
function validParentChoices(id: string) {
  if (!ledger.value) return []
  const current = ledger.value.tags.find((tag) => tag.id === id)
  const sameCategory = ledger.value.tags.filter((tag) => tag.category === current?.category)
  return flattenTagHierarchy(sameCategory).map(row => row.tag).filter(tag => { try { assertCanSetParent(ledger.value!.tags, id, tag.id); return true } catch { return false } })
}
const parentImpact = computed(() => {
  if (!ledger.value || !parentEdit.tagId) return { count: 0, rows: [], error: '' }
  try {
    assertCanSetParent(ledger.value.tags, parentEdit.tagId, parentEdit.parentId || undefined)
    const tags = ledger.value.tags.map(tag => ({ ...tag, parentId: tag.id === parentEdit.tagId ? parentEdit.parentId || undefined : tag.parentId }))
    const closure = (tx: Transaction) => expandTagAncestors(tags, directTags(tx).filter(id => id !== '__system__'))
    const count = ledger.value.tagReferences.filter(tx => JSON.stringify(closure(tx)) !== JSON.stringify(tx.selectedTagIds)).length
    const amounts = new Map<string, { tagId: string; currency: Currency; amount: number }>()
    for (const tx of ledger.value.normalTransactions) {
      if (tx.kind !== 'expense' || !tx.sourceMoney) continue
      const next = closure(tx)
      for (const id of new Set([...next, ...tx.selectedTagIds])) {
        const delta = Number(next.includes(id)) - Number(tx.selectedTagIds.includes(id))
        if (!delta) continue
        const key = id + tx.sourceMoney.currency, row = amounts.get(key) ?? { tagId: id, currency: tx.sourceMoney.currency, amount: 0 }
        row.amount += delta * tx.sourceMoney.minorUnits
        amounts.set(key, row)
      }
    }
    return { count, rows: [...amounts.values()].filter(row => row.amount), error: '' }
  } catch (error) { return { count: 0, rows: [], error: messageOf(error) } }
})
const tagParentChanged = computed(() => (ledger.value?.tags.find(tag => tag.id === parentEdit.tagId)?.parentId ?? '') !== parentEdit.parentId)
watch(() => parentEdit.parentId, () => { parentEdit.confirmed = false })
async function saveTagEdit() {
  if ((tagParentChanged.value && !parentEdit.confirmed) || parentImpact.value.error) return
  const relationshipChanged = tagParentChanged.value
  const parentId = parentEdit.parentId || undefined
  const result = await session.updateTag(parentEdit.tagId, parentEdit.name, parentId)
  if (result) { expandTagPath(parentId); dialog.value = null; notify('success', relationshipChanged ? '标签已修改，祖先标签已重新计算' : '标签名称已修改') }
}
const tagDeleteTargetId = ref('')
const childDisposition = reactive({ mode: '' as '' | 'promote' | 'move', parentId: '' })
const tagDeleteChildren = computed(() => ledger.value?.tags.filter(tag => tag.parentId === tagDeleteTargetId.value) ?? [])
const tagDeleteTarget = computed(() => ledger.value?.tags.find((tag) => tag.id === tagDeleteTargetId.value))
const tagDeleteReferences = computed(() => (ledger.value?.tagReferences ?? []).filter(transaction => directTags(transaction).includes(tagDeleteTargetId.value)))
const tagResolutionDrafts = reactive<Record<string, { action: 'remove' | 'replace'; replacementTagId: string; replacementTagName: string }>>({})
const bulkSelectedTransactionIds = ref<string[]>([])
const bulkReplacementTagId = ref('')
const bulkReplacementTagName = ref('')
function openTagDelete(id: string) {
  tagDeleteTargetId.value = id
  Object.assign(childDisposition, { mode: '', parentId: '' })
  bulkSelectedTransactionIds.value = []
  bulkReplacementTagId.value = ''
  bulkReplacementTagName.value = ''
  for (const key of Object.keys(tagResolutionDrafts)) delete tagResolutionDrafts[key]
  if (tagDeleteReferences.value.length) dialog.value = 'tag-delete-warning'
  else dialog.value = 'tag-delete-confirm'
}
function beginTagResolution() {
  for (const transaction of tagDeleteReferences.value) tagResolutionDrafts[transaction.id] = {
    action: transaction.primaryTagId === tagDeleteTargetId.value ? 'replace' : 'remove', replacementTagId: '', replacementTagName: '',
  }
  dialog.value = 'tag-delete-resolve'
}
function applyBulkTagReplacement() {
  if (!bulkSelectedTransactionIds.value.length) { notify('warning', '请先选择需要批量替换的账目'); return }
  if (!bulkReplacementTagId.value && !bulkReplacementTagName.value.trim()) { notify('warning', '请选择或输入替换标签'); return }
  for (const transactionId of bulkSelectedTransactionIds.value) Object.assign(tagResolutionDrafts[transactionId]!, {
    action: 'replace', replacementTagId: bulkReplacementTagId.value, replacementTagName: bulkReplacementTagName.value,
  })
  notify('success', `已为 ${bulkSelectedTransactionIds.value.length} 条账目设置替换方案`)
}
const tagResolutionsComplete = computed(() => tagDeleteReferences.value.every((transaction) => {
  const resolution = tagResolutionDrafts[transaction.id]
  if (!resolution) return false
  if (resolution.action === 'remove') return transaction.primaryTagId !== tagDeleteTargetId.value && directTags(transaction).length > 1
  return Boolean(resolution.replacementTagId || resolution.replacementTagName.trim())
}))
async function confirmTagDelete() {
  if (tagDeleteChildren.value.length && !childDisposition.mode) return
  const children = childDisposition.mode ? { mode: childDisposition.mode, parentId: childDisposition.parentId || undefined } : undefined
  if (!tagDeleteReferences.value.length) await session.deleteTag(tagDeleteTargetId.value, children)
  else {
    const resolutions: TagDeletionResolution[] = tagDeleteReferences.value.map((transaction) => ({ transactionId: transaction.id, ...tagResolutionDrafts[transaction.id]! }))
    await session.resolveDeleteTag(tagDeleteTargetId.value, resolutions, children)
  }
  if (!session.error) { dialog.value = null; notify('success', '标签及其引用处理已完成') }
}

const emptyDraft = (): DraftForm => ({ kind: 'expense', sourceAccountId: '', sourceAmount: '', sourceCurrency: 'CNY', destinationAccountId: '', destinationAmount: '', destinationCurrency: 'CNY', selectedTagIds: [], primaryTagId: '', note: '', occurredAtLocal: localDateTime() })
const draftForm = reactive<DraftForm>(emptyDraft())
const pendingDrafts = ref<TransactionDraft[]>([])
const pendingTags = ref<PendingTag[]>([])
const hasCurrentTransactionInput = computed(() => draftForm.sourceAmount !== '' || draftForm.destinationAmount !== '' || draftForm.note !== ''
  || draftForm.sourceAccountId !== '' || draftForm.destinationAccountId !== '' || draftForm.selectedTagIds.length > 0)
const hasUnsavedTransactionInput = computed(() => pendingDrafts.value.length > 0 || hasCurrentTransactionInput.value)
const showDeleted = ref(false)
const transactionFilterDefaults: TransactionFilters = {
  bookedFrom: '', bookedTo: '', kind: 'all', accountId: '', currency: '', minAmount: '', maxAmount: '',
  tagId: '', tagMode: 'included', note: '', createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '', sort: 'updated-desc',
}
const transactionFilters = reactive<TransactionFilters>({ ...transactionFilterDefaults })
const transactionFiltersExpanded = ref(false)
type TransactionFilterKey = keyof typeof transactionFilterDefaults
const detailTransactionFilterKeys = (Object.keys(transactionFilterDefaults) as TransactionFilterKey[]).filter((key) => key !== 'sort')
function transactionFilterActive(key: TransactionFilterKey) { return transactionFilters[key] !== transactionFilterDefaults[key] }
const activeTransactionFilterCount = computed(() => detailTransactionFilterKeys.filter(transactionFilterActive).length)
const transactionPage = ref(1)
const TRANSACTIONS_PER_PAGE = 20
function transactionMoney(tx: Transaction) { return tx.kind === 'income' ? tx.destinationMoney : tx.sourceMoney }
function transactionRootId(tx: Transaction) { return tx.recordRole === 'replacement' ? tx.targetTransactionId ?? tx.id : tx.id }
const exchangeImplicitTags = computed(() => [...new Set(normalTransactions.value.flatMap(transaction => transactionStatisticalFlows(transaction).flatMap(flow => flow.tagIds)).filter(isImplicitTagId))].map(id => ({ id, name: implicitTagName(id)! })))
const filteredTransactionRows = computed(() => {
  const rows = (showDeleted.value ? deletedTransactions.value : normalTransactions.value).filter((tx) => {
    const statisticalFlows = transactionStatisticalFlows(tx)
    const requestedFlowKind = transactionFilters.kind === 'income' || transactionFilters.kind === 'expense' ? transactionFilters.kind : undefined
    const matchingFlows = statisticalFlows.filter(flow => (!requestedFlowKind || flow.kind === requestedFlowKind) && (!transactionFilters.currency || flow.money.currency === transactionFilters.currency))
    const money = matchingFlows[0]?.money ?? transactionMoney(tx)
    const major = money ? money.minorUnits / 10 ** currencyRules[money.currency].fractionDigits : 0
    if (transactionFilters.bookedFrom && tx.bookedAt < transactionFilters.bookedFrom) return false
    if (transactionFilters.bookedTo && tx.bookedAt > transactionFilters.bookedTo) return false
    if (transactionFilters.kind === 'transfer' && tx.kind !== 'transfer') return false
    if (requestedFlowKind && !statisticalFlows.some(flow => flow.kind === requestedFlowKind)) return false
    if (transactionFilters.accountId && tx.sourceAccountId !== transactionFilters.accountId && tx.destinationAccountId !== transactionFilters.accountId) return false
    if (transactionFilters.currency && requestedFlowKind && !matchingFlows.length) return false
    if (transactionFilters.currency && !requestedFlowKind && !statisticalFlows.some(flow => flow.money.currency === transactionFilters.currency) && tx.sourceMoney?.currency !== transactionFilters.currency && tx.destinationMoney?.currency !== transactionFilters.currency) return false
    if (transactionFilters.minAmount !== '' && major < Number(transactionFilters.minAmount)) return false
    if (transactionFilters.maxAmount !== '' && major > Number(transactionFilters.maxAmount)) return false
    if (transactionFilters.tagId) {
      if (isImplicitTagId(transactionFilters.tagId)) {
        const matchesImplicitTag = matchingFlows.some(flow => transactionFilters.tagMode === 'primary' || transactionFilters.tagMode === 'primary-root' ? flow.primaryTagId === transactionFilters.tagId : flow.tagIds.includes(transactionFilters.tagId))
        if (!matchesImplicitTag) return false
      } else {
        const ids = transactionFilters.tagMode === 'primary' ? [tx.primaryTagId] : transactionFilters.tagMode === 'primary-root' ? [tx.primaryTagId ? rootTagId(ledger.value!.tags, tx.primaryTagId) : undefined] : transactionFilters.tagMode === 'direct' ? directTags(tx) : tx.selectedTagIds
        if (!ids.includes(transactionFilters.tagId)) return false
      }
    }
    if (transactionFilters.note && !normalizeSearch(tx.note).includes(normalizeSearch(transactionFilters.note))) return false
    if (transactionFilters.createdFrom && tx.createdAt.slice(0, 10) < transactionFilters.createdFrom) return false
    if (transactionFilters.createdTo && tx.createdAt.slice(0, 10) > transactionFilters.createdTo) return false
    if (transactionFilters.updatedFrom && tx.updatedAt.slice(0, 10) < transactionFilters.updatedFrom) return false
    if (transactionFilters.updatedTo && tx.updatedAt.slice(0, 10) > transactionFilters.updatedTo) return false
    return true
  })
  return rows.sort((a, b) => {
    if (transactionFilters.sort === 'updated-asc') return compareModification(a, b, 1)
    if (transactionFilters.sort === 'booked-desc') return compareOccurrence(a, b, -1)
    if (transactionFilters.sort === 'booked-asc') return compareOccurrence(a, b, 1)
    if (transactionFilters.sort === 'amount-desc') return (transactionMoney(b)?.minorUnits ?? 0) - (transactionMoney(a)?.minorUnits ?? 0)
    if (transactionFilters.sort === 'amount-asc') return (transactionMoney(a)?.minorUnits ?? 0) - (transactionMoney(b)?.minorUnits ?? 0)
    return compareModification(a, b, -1)
  })
})
const transactionPageCount = computed(() => Math.max(1, Math.ceil(filteredTransactionRows.value.length / TRANSACTIONS_PER_PAGE)))
const paginatedTransactions = computed(() => filteredTransactionRows.value.slice((transactionPage.value - 1) * TRANSACTIONS_PER_PAGE, transactionPage.value * TRANSACTIONS_PER_PAGE))
watch([showDeleted, () => JSON.stringify(transactionFilters)], () => { transactionPage.value = 1 })
function clearTransactionFilters() {
  const sort = transactionFilters.sort
  Object.assign(transactionFilters, transactionFilterDefaults, { sort })
}
function drillToTransactions(filters: { currency?: Currency; kind?: string; accountId?: string; tagId?: string; tagMode?: string; bookedFrom?: string; bookedTo?: string }) {
  clearTransactionFilters()
  if (filters.currency) transactionFilters.currency = filters.currency
  if (filters.kind) transactionFilters.kind = filters.kind
  if (filters.accountId) transactionFilters.accountId = filters.accountId
  if (filters.tagId) transactionFilters.tagId = filters.tagId
  if (filters.tagMode) transactionFilters.tagMode = filters.tagMode
  if (filters.bookedFrom) transactionFilters.bookedFrom = filters.bookedFrom
  if (filters.bookedTo) transactionFilters.bookedTo = filters.bookedTo
  showDeleted.value = false
  page.value = 'transactions'
}
const transactionEditTargetId = ref('')
const transactionTagIds = ref<string[]>([])
const transactionPrimaryTagId = ref('')
const correctionForm = reactive<DraftForm>(emptyDraft())
const transactionEditTarget = computed(() => normalTransactions.value.find((transaction) => transaction.id === transactionEditTargetId.value))
const transactionEditTags = computed(() => ledger.value?.tags.filter((tag) => tag.category === transactionEditTarget.value?.kind) ?? [])
const correctionTags = computed(() => ledger.value?.tags.filter((tag) => tag.category === correctionForm.kind) ?? [])
const auditTargetId = ref('')
const auditChain = computed(() => ledger.value?.auditChains[auditTargetId.value] ?? [])
function openTransactionTags(tx: Transaction) {
  transactionEditTargetId.value = tx.id
  transactionTagIds.value = [...directTags(tx)]
  transactionPrimaryTagId.value = tx.primaryTagId ?? ''
  dialog.value = 'transaction-tags'
}
async function saveTransactionTags() {
  await session.updateTransactionTags(transactionEditTargetId.value, transactionTagIds.value, transactionPrimaryTagId.value)
  if (!session.error) { dialog.value = null; notify('success', '账目标签已更新，未产生资金流水') }
}
function inputAmount(tx: Transaction, side: 'source' | 'destination') {
  const money = side === 'source' ? tx.sourceMoney : tx.destinationMoney
  return money ? String(money.minorUnits / 10 ** currencyRules[money.currency].fractionDigits) : ''
}
function openTransactionCorrection(tx: Transaction) {
  transactionEditTargetId.value = tx.id
  Object.assign(correctionForm, {
    kind: tx.kind, sourceAccountId: tx.sourceAccountId ?? '', sourceAmount: inputAmount(tx, 'source'), sourceCurrency: tx.sourceMoney?.currency ?? 'CNY',
    destinationAccountId: tx.destinationAccountId ?? '', destinationAmount: inputAmount(tx, 'destination'), destinationCurrency: tx.destinationMoney?.currency ?? 'CNY',
    selectedTagIds: [...directTags(tx)], primaryTagId: tx.primaryTagId ?? '', note: tx.note, occurredAtLocal: tx.occurredAt?.slice(0, 19) ?? `${tx.bookedAt}T12:00:00`,
  })
  dialog.value = 'transaction-correct'
}
async function saveTransactionCorrection() {
  try {
    const occurredAt = occurredAtFromLocal(correctionForm.occurredAtLocal)
    const draft: TransactionDraft = { kind: correctionForm.kind, bookedAt: correctionForm.occurredAtLocal.slice(0, 10), occurredAt, note: correctionForm.note }
    if (correctionForm.kind !== 'income') { draft.sourceAccountId = correctionForm.sourceAccountId; draft.sourceMoney = { currency: correctionForm.sourceCurrency, minorUnits: toMinorUnits(correctionForm.sourceAmount, correctionForm.sourceCurrency) } }
    if (correctionForm.kind !== 'expense') { draft.destinationAccountId = correctionForm.destinationAccountId; draft.destinationMoney = { currency: correctionForm.destinationCurrency, minorUnits: toMinorUnits(correctionForm.destinationAmount, correctionForm.destinationCurrency) } }
    if (correctionForm.kind !== 'transfer') { draft.selectedTagIds = [...correctionForm.selectedTagIds]; draft.primaryTagId = correctionForm.primaryTagId }
    await session.correctTransaction(transactionEditTargetId.value, draft)
    if (!session.error) { dialog.value = null; notify('success', '资金数据已通过原子更正组更新') }
  } catch (cause) { session.error = messageOf(cause) }
}
function openAuditChain(tx: Transaction) { auditTargetId.value = transactionRootId(tx); dialog.value = 'audit-chain' }
function auditRole(role: Transaction['recordRole']) { return ({ normal: '原始记录', reversal: '反向记录', replacement: '更正后记录', restoration: '恢复记录', 'system-account-open': '开户记录', 'system-account-close': '销户记录' } as Record<Transaction['recordRole'], string>)[role] }
const transactionOrderRows = ref<Transaction[]>([])
const transactionOrderDragIndex = ref<number | null>(null)
const transactionOrderConflictGroups = computed(() => {
  const groups = new Map<string, Transaction[]>()
  // Deleted and active rows share the same global modification timeline. Include
  // both so a collision group is always complete when it is persisted.
  for (const transaction of [...normalTransactions.value, ...deletedTransactions.value]) {
    const second = transaction.updatedAt.slice(0, 19)
    groups.set(second, [...(groups.get(second) ?? []), transaction])
  }
  return [...groups.entries()].filter(([, rows]) => rows.length > 1).sort(([a], [b]) => b.localeCompare(a))
})
function openTransactionOrderWizard() {
  // Only the ordering metadata is edited in this wizard. A shallow copy also
  // avoids passing Vue's reactive proxies to structuredClone.
  transactionOrderRows.value = transactionOrderConflictGroups.value.flatMap(([, rows]) => [...rows].sort((a, b) => compareModification(a, b, -1)).map((row) => ({ ...row })))
  transactionOrderDragIndex.value = null
  dialog.value = 'transaction-order'
}
function moveTransactionOrderRow(index: number, target: number) {
  const rows = transactionOrderRows.value
  if (!rows[index] || !rows[target] || rows[index]!.updatedAt.slice(0, 19) !== rows[target]!.updatedAt.slice(0, 19)) return
  const second = rows[index]!.updatedAt.slice(0, 19)
  const timestampSlots = rows.filter((row) => row.updatedAt.slice(0, 19) === second).map((row) => row.updatedAt)
  moveListItem(rows, index, target)
  rows.filter((row) => row.updatedAt.slice(0, 19) === second).forEach((row, position) => { row.updatedAt = timestampSlots[position]!; row.updatedOrder = position })
}
function startTransactionOrderDrag(event: DragEvent, index: number) {
  transactionOrderDragIndex.value = index
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function dropTransactionOrderRow(index: number) {
  if (transactionOrderDragIndex.value !== null) moveTransactionOrderRow(transactionOrderDragIndex.value, index)
  transactionOrderDragIndex.value = null
}
async function saveTransactionOrder() {
  const grouped = new Map<string, string[]>()
  for (const row of transactionOrderRows.value) {
    const second = row.updatedAt.slice(0, 19)
    grouped.set(second, [...(grouped.get(second) ?? []), row.id])
  }
  const result = await session.reorderTransactionUpdates([...grouped.values()])
  if (result) { dialog.value = null; notify('success', '同秒账目的修改顺序已更新') }
}
const tagPickerOpen = ref(false)
const tagPickerSearch = ref('')
const pendingParentId = ref('')
const tagPickerSelectedIds = ref<string[]>([])
const tagPickerPrimaryId = ref('')
const tagPickerSessionCreatedIds = ref<string[]>([])
function normalizeSearch(value: string) { return value.trim().normalize('NFKC').toLocaleLowerCase() }
const draftTagCategory = computed<TagCategory>(() => draftForm.kind === 'income' ? 'income' : 'expense')
const allPickerTags = computed(() => [
  ...pendingTags.value.map((tag) => ({ id: tag.clientId, name: tag.name, parentId: tag.parentId, category: tag.category, isNew: true })),
  ...(ledger.value?.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name, parentId: tag.parentId, category: tag.category, createdAt: tag.createdAt, isNew: false })),
])
const pickerTags = computed(() => allPickerTags.value.filter((tag) => tag.category === draftTagCategory.value))
watch(() => draftForm.kind, (kind, previous) => {
  if (kind === previous) return
  draftForm.selectedTagIds = []
  draftForm.primaryTagId = ''
  tagPickerSelectedIds.value = []
  tagPickerPrimaryId.value = ''
  pendingParentId.value = ''
  tagPickerOpen.value = false
})
const impliedExchangeRate = computed(() => {
  if (draftForm.kind !== 'transfer' || draftForm.sourceCurrency === draftForm.destinationCurrency) return ''
  const source = Number(draftForm.sourceAmount)
  const destination = Number(draftForm.destinationAmount)
  if (!(source > 0) || !Number.isFinite(destination)) return ''
  return `1 ${draftForm.sourceCurrency} ≈ ${(destination / source).toLocaleString('zh-CN', { maximumFractionDigits: 8 })} ${draftForm.destinationCurrency}`
})
function openTagPicker() {
  tagPickerSelectedIds.value = [...draftForm.selectedTagIds]
  tagPickerPrimaryId.value = draftForm.primaryTagId
  tagPickerSearch.value = ''
  pendingParentId.value = ''
  tagPickerSessionCreatedIds.value = []
  tagPickerOpen.value = true
}
function cleanUnusedPendingTags() {
  const used = new Set([
    ...draftForm.selectedTagIds,
    ...pendingDrafts.value.flatMap((draft) => draft.selectedTagIds ?? []),
    ...(tagPickerOpen.value ? tagPickerSelectedIds.value : []),
  ])
  const expanded = new Set(expandTagAncestors(allPickerTags.value, [...used]))
  pendingTags.value = pendingTags.value.filter((tag) => expanded.has(tag.clientId))
}
function selectOrCreateTagFromSearch() {
  const cleanName = tagPickerSearch.value.trim()
  if (!cleanName) return
  let tag = pickerTags.value.find((item) => normalizeSearch(item.name) === normalizeSearch(cleanName))
  if (!tag) {
    if (allPickerTags.value.some((item) => normalizeSearch(item.name) === normalizeSearch(cleanName))) { notify('warning', '另一标签类别中已存在同名标签'); return }
    const pending: PendingTag = { clientId: `temp:${crypto.randomUUID()}`, name: cleanName, parentId: pendingParentId.value || undefined, category: draftTagCategory.value }
    pendingTags.value.push(pending)
    tagPickerSessionCreatedIds.value.push(pending.clientId)
    tag = { id: pending.clientId, name: pending.name, parentId: pending.parentId, category: pending.category, isNew: true }
  }
  if (!tagPickerSelectedIds.value.includes(tag.id)) tagPickerSelectedIds.value.push(tag.id)
  if (!tagPickerPrimaryId.value) tagPickerPrimaryId.value = tag.id
  tagPickerSearch.value = ''
}
function cancelTagPicker() {
  pendingTags.value = pendingTags.value.filter((tag) => !tagPickerSessionCreatedIds.value.includes(tag.clientId))
  tagPickerOpen.value = false
}
function confirmTagPicker() {
  if (!tagPickerSelectedIds.value.length || !tagPickerPrimaryId.value) { notify('warning', '账目至少需要一个标签和主标签'); return }
  draftForm.selectedTagIds = [...tagPickerSelectedIds.value]
  draftForm.primaryTagId = tagPickerPrimaryId.value
  tagPickerOpen.value = false
  cleanUnusedPendingTags()
}
function syncTransferAmount(changed: 'source' | 'destination') {
  if (draftForm.kind !== 'transfer' || draftForm.sourceCurrency !== draftForm.destinationCurrency) return
  if (changed === 'source') draftForm.destinationAmount = draftForm.sourceAmount
  else draftForm.sourceAmount = draftForm.destinationAmount
}
const pendingDraftDragIndex = ref<number | null>(null)
function copyPendingDraft(index: number) {
  const copied = JSON.parse(JSON.stringify(pendingDrafts.value[index]!)) as TransactionDraft
  copied.stagedAt = new Date().toISOString()
  copied.queueId = crypto.randomUUID()
  pendingDrafts.value.push(copied)
}
function movePendingDraft(index: number, target: number) {
  if (!pendingDrafts.value[index] || !pendingDrafts.value[target]) return
  const timeSlots = pendingDrafts.value.map((draft) => draft.stagedAt ?? new Date().toISOString())
  moveListItem(pendingDrafts.value, index, target)
  pendingDrafts.value.forEach((draft, position) => { draft.stagedAt = timeSlots[position] })
}
function startPendingDraftDrag(event: DragEvent, index: number) {
  pendingDraftDragIndex.value = index
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function dropPendingDraft(index: number) {
  if (pendingDraftDragIndex.value !== null) movePendingDraft(pendingDraftDragIndex.value, index)
  pendingDraftDragIndex.value = null
}
function removePendingDraft(index: number) { pendingDrafts.value.splice(index, 1); cleanUnusedPendingTags() }
function currentTransactionDraft(stagedAt?: string): TransactionDraft {
  const occurredAt = occurredAtFromLocal(draftForm.occurredAtLocal)
  const draft: TransactionDraft = { kind: draftForm.kind, bookedAt: draftForm.occurredAtLocal.slice(0, 10), occurredAt, stagedAt, queueId: stagedAt ? crypto.randomUUID() : undefined, note: draftForm.note }
  if (draftForm.kind !== 'income') { draft.sourceAccountId = draftForm.sourceAccountId; draft.sourceMoney = { currency: draftForm.sourceCurrency, minorUnits: toMinorUnits(draftForm.sourceAmount, draftForm.sourceCurrency) } }
  if (draftForm.kind !== 'expense') { draft.destinationAccountId = draftForm.destinationAccountId; draft.destinationMoney = { currency: draftForm.destinationCurrency, minorUnits: toMinorUnits(draftForm.destinationAmount, draftForm.destinationCurrency) } }
  if (draftForm.kind !== 'transfer') {
    if (!draftForm.selectedTagIds.length || !draftForm.primaryTagId) throw new Error('请先确认至少一个标签和主标签')
    draft.selectedTagIds = [...draftForm.selectedTagIds]; draft.primaryTagId = draftForm.primaryTagId
  }
  return draft
}
function addPendingDraft() {
  try {
    pendingDrafts.value.push(currentTransactionDraft(new Date().toISOString()))
    Object.assign(draftForm, emptyDraft())
    cleanUnusedPendingTags()
    session.error = ''
  } catch (cause) { session.error = messageOf(cause) }
}
async function commitDrafts() { if (!ledger.value) return; await session.addTransactions(pendingDrafts.value, pendingTags.value); if (!session.error) { resetTransactionEntry(); dialog.value = null; notify('success', '批量账目已原子提交') } }
async function commitAllDrafts() {
  if (!ledger.value) return
  try {
    const drafts = [...pendingDrafts.value]
    if (hasCurrentTransactionInput.value) drafts.push(currentTransactionDraft(new Date().toISOString()))
    if (!drafts.length) throw new Error('当前没有可以提交的账目')
    const result = await session.addTransactions(drafts, pendingTags.value)
    if (result) { resetTransactionEntry(); dialog.value = null; notify('success', `${drafts.length} 条账目已直接原子提交`) }
  } catch (cause) { session.error = messageOf(cause) }
}
const transactionDeleteTargetId = ref('')
const transactionDeleteTarget = computed(() => normalTransactions.value.find(transaction => transaction.id === transactionDeleteTargetId.value))
function openTransactionDelete(id: string) { transactionDeleteTargetId.value = id; dialog.value = 'transaction-delete' }
async function confirmTransactionDelete() {
  if (!ledger.value || !transactionDeleteTargetId.value) return
  const result = await session.reverseTransaction(transactionDeleteTargetId.value)
  if (result) { transactionDeleteTargetId.value = ''; dialog.value = null; notify('success', '账目已冲销') }
}
async function recoverTransaction(id: string) { if (!ledger.value) return; await session.restoreTransaction(id); if (!session.error) notify('success', '账目已通过恢复记录还原') }

function accountName(id?: string) { return ledger.value?.accounts.find((account) => account.id === id)?.name ?? '—' }
function tagNameOf(id?: string) { return id ? implicitTagName(id) ?? (tagPath(ledger.value?.tags ?? [], id) || '已删除标签') : '—' }
function parentNameOf(id?: string) { return id ? tagNameOf(id) : '根标签' }
function transactionTitle(tx: (typeof normalTransactions.value)[number]) { return tx.kind === 'income' ? `收入至 ${accountName(tx.destinationAccountId)}` : tx.kind === 'expense' ? `从 ${accountName(tx.sourceAccountId)} 支出` : `${accountName(tx.sourceAccountId)} → ${accountName(tx.destinationAccountId)}` }
function transactionAmount(tx: (typeof normalTransactions.value)[number]) { return tx.kind === 'income' ? tx.destinationMoney ? formatMoney(tx.destinationMoney) : '' : tx.sourceMoney ? formatMoney(tx.sourceMoney) : '' }
function exchangeTagSummary(tx: Transaction) {
  const flows = transactionStatisticalFlows(tx)
  if (tx.kind !== 'transfer' || flows.length !== 2) return ''
  return `主标签：换汇 · ${flows.map(flow => `${flow.money.currency}：${flow.label}`).join(' · ')}`
}
const dashboardTransactions = computed(() => recentTransactions.value.map((transaction) => ({
  id: transaction.id,
  kind: transaction.kind,
  title: transactionTitle(transaction),
  detail: `${displayOccurredAt(transaction)} · ${transaction.note || (exchangeTagSummary(transaction) ? '换汇' : tagNameOf(transaction.primaryTagId))}`,
  exchangeSummary: exchangeTagSummary(transaction),
  amount: transactionAmount(transaction),
})))
function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : '操作失败' }

function openTransactionEntry() {
  session.error = ''
  dialog.value = 'transaction-entry'
}
function resetTransactionEntry() {
  Object.assign(draftForm, emptyDraft())
  pendingDrafts.value = []
  pendingTags.value = []
  tagPickerOpen.value = false
}

function clearWorkspaceDrafts() {
  suspendedWorkspace.value = undefined
  resetTransactionEntry()
  tagPickerOpen.value = false
  bulkSelectedTransactionIds.value = []
  bulkReplacementTagId.value = ''
  bulkReplacementTagName.value = ''
  for (const key of Object.keys(tagResolutionDrafts)) delete tagResolutionDrafts[key]
  Object.assign(accountEditForm, { id: '', name: '', pending: false })
  accountForm.name = ''
  accountForm.pending = false
  currencies.forEach((currency) => { accountForm.initial[currency] = '0' })
  tagWizardName.value = ''
  tagWizardParentId.value = ''
  tagWizardDrafts.value = []
  pendingParentId.value = ''
  Object.assign(parentEdit, { tagId: '', name: '', parentId: '', confirmed: false })
  Object.assign(childDisposition, { mode: '', parentId: '' })
  accountDeleteTargetId.value = ''
  tagDeleteTargetId.value = ''
  transactionDeleteTargetId.value = ''
  renameForm.name = ''
  renameTargetId.value = undefined
  previewPrimaryHue.value = currentPrimaryHue.value
  previewSecondaryHue.value = currentSecondaryHue.value
  previewColorTone.value = currentColorTone.value
  secret.value = ''
  dialog.value = null
}
function clearSensitiveInputs() {
  secret.value = ''
  createForm.secret = ''
  createForm.confirmation = ''
  renameForm.secret = ''
  deleteForm.secret = ''
}
function discardTransactionEntry() {
  resetTransactionEntry()
  dialog.value = null
  session.error = ''
}

const renameForm = reactive({ name: '', secret: '' })
function openRenameDialog() {
  renameTargetId.value = undefined
  renameOriginalName.value = ledger.value?.name ?? ''
  renameForm.name = renameOriginalName.value; renameForm.secret = ''; session.error = ''; dialog.value = 'rename-name'
}
function openLoginRename(entry: { ledgerId: string; displayName: string }) {
  renameTargetId.value = entry.ledgerId
  renameOriginalName.value = entry.displayName
  renameForm.name = entry.displayName; renameForm.secret = ''; session.error = ''; dialog.value = 'rename-name'
}
function continueRename() {
  if (!renameForm.name.trim()) { session.error = '新账本名称不能为空'; return }
  if (renameForm.name.trim() === renameOriginalName.value) { session.error = '请输入不同的新账本名称'; return }
  session.error = ''
  dialog.value = 'rename-secret'
}
async function renameLedger() { await session.rename(renameForm.name, renameForm.secret, renameTargetId.value); if (!session.error) { renameForm.name = ''; renameForm.secret = ''; renameTargetId.value = undefined; dialog.value = null; notify('success', '账本名称已更新') } }
function openThemeDialog() {
  previewPrimaryHue.value = currentPrimaryHue.value
  previewSecondaryHue.value = currentSecondaryHue.value
  previewColorTone.value = currentColorTone.value
  themeChannel.value = 'primary'
  session.error = ''
  dialog.value = 'theme'
}
async function saveTheme() {
  if (!ledger.value) return
  await session.setAppearance({ primaryHue: previewPrimaryHue.value, secondaryHue: previewSecondaryHue.value, colorTone: previewColorTone.value })
  if (!session.error) { dialog.value = null; notify('success', '主题颜色已保存到账本') }
}
async function saveAutoLockSeconds() {
  const seconds = Number(autoLockSecondsInput.value)
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 86_400) {
    notify('warning', '自动暂离时间需要是 30 到 86400 之间的整数秒')
    return
  }
  await session.setAutoLockSeconds(seconds)
  if (!session.error) {
    resetAutoLock()
    notify('success', '自动暂离时间已保存到账本')
  }
}
function openPassphraseDialog() { Object.assign(passphraseForm, { oldSecret: '', newSecret: '', confirmation: '' }); session.error = ''; dialog.value = 'change-passphrase' }
async function changePassphrase() {
  if (passphraseForm.newSecret !== passphraseForm.confirmation) { session.error = '两次输入的新口令不一致'; return }
  if (passphraseForm.newSecret.length < 8) { session.error = '新访问口令至少需要 8 个字符'; return }
  await session.changePassphrase(passphraseForm.oldSecret, passphraseForm.newSecret)
  if (!session.error) { dialog.value = null; Object.assign(passphraseForm, { oldSecret: '', newSecret: '', confirmation: '' }); notify('success', '访问口令已更新，账本数据密钥保持独立') }
}
function openSecurityMigration() {
  securityForm.secret = ''
  securityForm.kdf = ledger.value?.security.kdf ?? 'PBKDF2-SHA-256'
  securityForm.encryption = ledger.value?.security.encryption ?? 'AES-256-GCM'
  session.error = ''
  dialog.value = 'security-migration'
}
async function migrateSecurity() {
  await session.migrateSecurity(securityForm.secret, securityForm.kdf, securityForm.encryption)
  if (!session.error) { dialog.value = null; securityForm.secret = ''; notify('success', '加密参数已使用全新数据密钥原子迁移') }
}
function openRecoveryDialog() { recoverySecret.value = ''; session.error = ''; dialog.value = 'restore-recovery' }
async function restoreRecovery() {
  const result = await session.restoreRecovery(recoverySecret.value)
  if (result && !session.error) { dialog.value = null; recoverySecret.value = ''; notify('success', '已恢复上一版密文；恢复前版本仍可再次回退') }
}
function themeColor(channel: ThemeChannel, hue?: number): string {
  const value = normalizeHue(hue ?? (channel === 'primary' ? currentPrimaryHue.value : currentSecondaryHue.value))
  return previewThemeColor(value, activeColorTone.value)
}
function adjustHue(delta: number) { selectedHue.value += delta }
function updateHueFromPointer(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  selectedHue.value = Math.round(Math.atan2(event.clientX - centerX, centerY - event.clientY) / Math.PI * 180)
}
function startHueDrag(event: PointerEvent) {
  draggingHue.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  updateHueFromPointer(event)
}
function moveHueDrag(event: PointerEvent) { if (draggingHue.value) updateHueFromPointer(event) }
function stopHueDrag() { draggingHue.value = false }
async function setColorTone(colorTone: ColorTone) {
  if (!ledger.value || currentColorTone.value === colorTone) return
  await session.setAppearance({ primaryHue: currentPrimaryHue.value, secondaryHue: currentSecondaryHue.value, colorTone })
  if (!session.error) notify('success', colorTone === 'dark' ? '已切换为暗色调' : '已切换为亮色调')
}
function toggleColorTone(event: Event) {
  const colorTone: ColorTone = (event.currentTarget as HTMLInputElement).checked ? 'dark' : 'light'
  void setColorTone(colorTone)
}
</script>

<template>
  <LoginPage :show="showLogin" :transition="sessionTransition" :missing-capabilities="missingCapabilities" :indexes="filteredIndexes" v-model:search="search" @create="openCreateDialog" @unlock="openUnlock" @rename="openLoginRename" @delete="openDeleteDialog" @import="dialog = 'import'; secret = ''" />

  <div v-if="session.isUnlocked" class="app-shell block min-h-screen mobile:grid mobile:grid-cols-[230px_minmax(0,1fr)]" :class="{ 'app-entering': sessionTransition === 'unlocking', 'app-leaving': sessionTransition === 'locking' }">
    <AppSidebar :current-page="page" :ledger-name="ledger?.name" @navigate="page = $event" @add="openTransactionEntry" @lock="lock" />
    <section class="app-content min-w-0 px-4 pt-[1.2rem] pb-[calc(var(--rw-mobile-navigation-clearance)+env(safe-area-inset-bottom))] mobile:px-[clamp(1.1rem,4vw,4.5rem)] mobile:pt-[1.8rem] mobile:pb-16">
      <AppTopbar :page="page" />
      <Transition name="page-fade" mode="out-in">
      <div :key="page" class="page-view">
      <template v-if="page === 'dashboard'"><DashboardPage :accounts="activeAccounts" :balances="balances" :totals="totals" :transactions="dashboardTransactions" @add="openTransactionEntry" @navigate="page = $event" @drill="drillToTransactions" /></template>

      <template v-if="page === 'accounts'"><AccountsPage :accounts="ledger?.accounts ?? []" :balances="balances" @add="dialog = 'account-create'" @edit="openAccountEdit" @delete="openAccountDelete" @recover="recoverAccount" /></template>

      <template v-if="page === 'tags'"><TagsPage ref="tagsPageElement" :tags="ledger?.tags ?? []" :hierarchy-changes="ledger?.hierarchyChanges ?? []" v-model:open-category="tagCategoryOpen" v-model:expanded-ids="expandedTagIds" @add="openTagCreateWizard" @edit="openTagEdit" @delete="openTagDelete" /></template>

      <template v-if="page === 'transactions'"><TransactionsPage :filters="transactionFilters" :filters-expanded="transactionFiltersExpanded" :active-filter-count="activeTransactionFilterCount" :accounts="ledger?.accounts ?? []" :tags="ledger?.tags ?? []" :implicit-tags="exchangeImplicitTags" :order-conflict-count="transactionOrderConflictGroups.length" :show-deleted="showDeleted" :deleted-count="deletedTransactions.length" :rows="paginatedTransactions" :page="transactionPage" :page-count="transactionPageCount" :filter-active="transactionFilterActive" :title-of="transactionTitle" :amount-of="transactionAmount" :occurred-at-of="displayOccurredAt" :tag-name-of="tagNameOf" :exchange-summary-of="exchangeTagSummary" @update:filters-expanded="transactionFiltersExpanded = $event" @update:show-deleted="showDeleted = $event" @update:page="transactionPage = $event" @clear="clearTransactionFilters" @order="openTransactionOrderWizard" @add="openTransactionEntry" @audit="openAuditChain" @tags="openTransactionTags" @correct="openTransactionCorrection" @delete="openTransactionDelete" @recover="recoverTransaction" /></template>

      <template v-if="page === 'analytics' && ledger"><AnalyticsPage :ledger="ledger" :primary-hue="currentPrimaryHue" :secondary-hue="currentSecondaryHue" @drill="drillToTransactions" /></template>

      <template v-if="page === 'settings'"><SettingsPage :section="settingsSection" :ledger-name="ledger?.name" :has-migration-backup="Boolean(ledger?.hasMigrationBackup)" :has-recovery="Boolean(ledger?.hasRecovery)" :security-label="`${ledger?.security.kdf} + ${ledger?.security.encryption}`" :auto-lock-seconds="autoLockSecondsInput" :saved-auto-lock-seconds="currentAutoLockSeconds" :busy="session.busy" :color-tone="currentColorTone" :primary-hue="currentPrimaryHue" :secondary-hue="currentSecondaryHue" :primary-preview="themeColor('primary')" :secondary-preview="themeColor('secondary')" @update:section="settingsSection = $event" @update:auto-lock-seconds="autoLockSecondsInput = $event" @export="session.exportCurrent" @export-migration="session.exportMigrationBackup" @recover="openRecoveryDialog" @rename="openRenameDialog" @save-timeout="saveAutoLockSeconds" @passphrase="openPassphraseDialog" @security="openSecurityMigration" @delete="openDeleteDialog(ledger!.id, ledger!.name)" @tone="toggleColorTone" @theme="openThemeDialog" /></template>
      </div>
      </Transition>
    </section>
  </div>

  <AppModal :open="Boolean(dialog)" :content-key="dialog ?? undefined" :aria-label="dialog === 'transaction-delete' ? '删除这笔账目？' : dialog === 'transaction-order' ? '修改顺序调整向导' : dialog === 'tag-create' ? '批量添加标签' : undefined" :theme="dialog === 'theme'" :size="dialog === 'account-create' || dialog === 'transaction-entry' || dialog === 'transaction-correct' ? 'transaction' : dialog === 'tag-create' || dialog === 'tag-delete-resolve' || dialog === 'audit-chain' || dialog === 'transaction-order' ? 'resolution' : 'default'" @close="closeDialog">
      <template v-if="dialog === 'create'"><span class="eyebrow">NEW LEDGER</span><h2>创建本地加密账本</h2><label>账本名称<input name="create-form-name" v-model="createForm.name" autofocus /></label><label>访问口令<input name="create-form-secret" v-model="createForm.secret" type="password" /></label><label>确认口令<input name="create-form-confirmation" v-model="createForm.confirmation" type="password" @keyup.enter="createNewLedger" /></label><button class="ghost full advanced-trigger" :aria-expanded="createAdvanced" @click="createAdvanced = !createAdvanced">高级设置 <span class="disclosure-triangle" :class="{ expanded: createAdvanced }" aria-hidden="true"></span></button><div class="collapse-shell" :class="{ open: createAdvanced }" :inert="!createAdvanced"><div class="collapse-content"><label>密钥派生算法<select name="create-form-kdf" v-model="createForm.kdf"><option value="PBKDF2-SHA-256">PBKDF2 · SHA-256</option><option value="PBKDF2-SHA-512">PBKDF2 · SHA-512</option></select></label><label>加密算法<select name="create-form-encryption" v-model="createForm.encryption"><option value="AES-256-GCM">AES-256-GCM</option></select></label></div></div><button class="primary full" :disabled="session.busy" @click="createNewLedger">{{ session.busy ? '正在加密…' : '创建并进入' }}</button></template>
      <template v-else-if="dialog === 'unlock'"><span class="eyebrow">UNLOCK</span><h2>解锁账本</h2><label>访问口令<input name="secret" v-model="secret" type="password" autofocus @keyup.enter="unlock" /></label><button class="primary full" :disabled="session.busy" @click="unlock">{{ session.busy ? '正在解锁…' : '解锁账本' }}</button></template>
      <template v-else-if="dialog === 'import'"><span class="eyebrow">IMPORT</span><h2>导入加密账本</h2><label class="file-drop-zone" :class="{ dragging: importDragging }" @dragenter.prevent="importDragging = true" @dragover.prevent="importDragging = true" @dragleave.prevent="importDragging = false" @drop.prevent="dropImportFile"><input name="ledger-import-file" class="file-input" type="file" accept=".rwbl" @change="selectImportFile(($event.target as HTMLInputElement).files?.[0])" /><span class="file-icon">⇧</span><strong>{{ importFile?.name || '拖拽 .rwbl 文件到这里' }}</strong><small>{{ importFile ? '点击可重新选择文件' : '或者点击浏览本机文件' }}</small></label><label>文件访问口令<input name="secret" v-model="secret" type="password" /></label><button class="primary full" :disabled="session.busy" @click="importLedger">验证并导入</button></template>
      <template v-else-if="dialog === 'import-conflict'"><span class="eyebrow">IMPORT CONFLICT</span><h2>账本已存在</h2><p class="modal-copy">“{{ importInfo?.displayName }}”{{ importInfo?.conflict === 'id' ? '与本机账本具有相同 ID。可作为独立副本导入，或用文件内容替换本机账本。替换前会自动下载并保留现有密文备份。' : '与本机账本同名。请作为独立副本导入。' }}</p><div class="modal-actions"><button class="ghost" @click="dialog = 'import'">返回</button><button class="primary" @click="completeImport('copy')">导入为副本</button><button v-if="importInfo?.conflict === 'id'" class="danger" @click="completeImport('replace')">备份并替换</button></div></template>
      <template v-else-if="dialog === 'change-passphrase'"><span class="eyebrow">CHANGE PASSPHRASE</span><h2>修改访问口令</h2><label>当前访问口令<input name="passphrase-form-old-secret" v-model="passphraseForm.oldSecret" type="password" autocomplete="current-password" autofocus /></label><label>新访问口令<input name="passphrase-form-new-secret" v-model="passphraseForm.newSecret" type="password" autocomplete="new-password" /></label><label>确认新口令<input name="passphrase-form-confirmation" v-model="passphraseForm.confirmation" type="password" autocomplete="new-password" @keyup.enter="changePassphrase" /></label><button class="primary full" :disabled="session.busy" @click="changePassphrase">重新封装数据密钥</button></template>
      <template v-else-if="dialog === 'security-migration'"><span class="eyebrow">ATOMIC MIGRATION</span><h2>修改加密方式</h2><p class="modal-copy">迁移会先生成并验证完整的新容器，成功后才覆盖当前版本；旧密文会进入上一版本恢复区。</p><label>KDF<select name="security-form-kdf" v-model="securityForm.kdf"><option value="PBKDF2-SHA-256">PBKDF2 · SHA-256 · 600,000 次</option><option value="PBKDF2-SHA-512">PBKDF2 · SHA-512 · 400,000 次</option></select></label><label>加密算法<select name="security-form-encryption" v-model="securityForm.encryption"><option value="AES-256-GCM">AES-256-GCM</option></select></label><label>当前访问口令<input name="security-form-secret" v-model="securityForm.secret" type="password" autocomplete="current-password" @keyup.enter="migrateSecurity" /></label><button class="primary full" :disabled="session.busy" @click="migrateSecurity">验证并原子迁移</button></template>
      <template v-else-if="dialog === 'restore-recovery'"><span class="eyebrow">RECOVERY</span><h2>恢复上一版密文</h2><p class="modal-copy">恢复会交换当前版本与上一版本，因此仍可再次回退。请输入上一版本对应的访问口令。</p><label>上一版本访问口令<input name="recovery-secret" v-model="recoverySecret" type="password" autofocus @keyup.enter="restoreRecovery" /></label><button class="primary full" :disabled="session.busy" @click="restoreRecovery">验证并恢复</button></template>
      <template v-else-if="dialog === 'rename-name'"><span class="eyebrow">RENAME · 1 / 2</span><h2>修改账本名称</h2><p class="modal-copy">输入新的账本名称。下一步将验证当前访问口令。</p><label>新账本名称<input name="rename-form-name" v-model="renameForm.name" autofocus @keyup.enter="continueRename" /></label><button class="primary full" @click="continueRename">修改</button></template>
      <template v-else-if="dialog === 'rename-secret'"><span class="eyebrow">RENAME · 2 / 2</span><h2>确认修改</h2><div class="rename-preview"><small>账本将重命名为</small><strong>{{ renameForm.name }}</strong></div><label>当前访问口令<input name="rename-form-secret" v-model="renameForm.secret" type="password" autofocus @keyup.enter="renameLedger" /></label><div class="modal-actions"><button class="ghost" @click="dialog = 'rename-name'">返回</button><button class="primary" :disabled="session.busy" @click="renameLedger">{{ session.busy ? '正在保存…' : '确认修改' }}</button></div></template>
      <template v-else-if="dialog === 'delete'"><LedgerDeleteDialog :form="deleteForm" :busy="session.busy" @backup="backupDeleteTarget" @confirm="deleteLedgerConfirmed" /></template>
      <template v-else-if="dialog === 'account-create' || dialog === 'account-edit' || dialog === 'account-delete'"><AccountFormDialog :mode="dialog === 'account-create' ? 'create' : dialog === 'account-edit' ? 'edit' : 'delete'" :create-form="accountForm" :edit-form="accountEditForm" :delete-target="accountDeleteTarget" :balances="balances" :busy="session.busy" @close="closeDialog" @create="createAccount" @save="saveAccountEdit" @delete="confirmAccountDelete" /></template>
      <template v-else-if="dialog === 'tag-create'"><TagWizardDialog :tags="tagWizardPickerTags" :drafts="tagWizardDrafts" :name="tagWizardName" :parent-id="tagWizardParentId" :category="tagWizardCategory" :busy="session.busy" :parent-name="tagWizardParentName" @update:name="tagWizardName = $event" @update:parent-id="tagWizardParentId = $event" @update:category="tagWizardCategory = $event" @stage="stageWizardTag" @remove="removeWizardTag" @close="closeDialog" @confirm="confirmTagWizard" /></template>
      <template v-else-if="dialog === 'tag-edit'">
        <span class="eyebrow">EDIT TAG</span><h2>修改标签</h2>
        <label>标签名称<input name="tag-edit-name" v-model="parentEdit.name" maxlength="80" autofocus /></label>
        <label>新的父标签<select name="parent-edit-id" v-model="parentEdit.parentId"><option value="">根标签（无父级）</option><option v-for="tag in validParentChoices(parentEdit.tagId)" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select></label>
        <p class="modal-copy">重命名不会改变历史账目引用；显示名称即使规范化后与原名称相同，也可以保存。</p>
        <template v-if="tagParentChanged"><p class="modal-copy">父级改变后，将重新计算 {{ parentImpact.count }} 条记录（包括历史和已删除记录）的祖先标签。直接选择、主标签、记账日期、资金流水均不改变。</p><div class="hierarchy-warning"><strong>包含标签统计变化（全部有效支出）</strong><p v-if="!parentImpact.rows.length">统计金额不变；主标签精确统计始终不变。</p><p v-for="row in parentImpact.rows" :key="row.tagId + row.currency">{{ tagNameOf(row.tagId) }}：{{ row.amount > 0 ? '+' : '' }}{{ formatMinorUnits(row.amount, row.currency) }}</p><p v-if="parentImpact.error">{{ parentImpact.error }}</p></div><label class="delete-confirm"><input name="parent-edit-confirmed" type="checkbox" v-model="parentEdit.confirmed" />我已确认父级变更影响</label></template>
        <div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="session.busy || !parentEdit.name.trim() || (tagParentChanged && !parentEdit.confirmed) || Boolean(parentImpact.error)" @click="saveTagEdit">保存修改</button></div>
      </template>
      <template v-else-if="dialog === 'tag-delete-warning'"><span class="eyebrow">TAG IN USE</span><h2>“{{ tagDeleteTarget?.name }}”仍被使用</h2><p class="modal-copy">该标签被 {{ tagDeleteReferences.length }} 条记录直接引用（包括历史及已删除记录），无法直接删除。继续后需要逐条移除或批量替换，所有调整会在最终确认时一次性写入。</p><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" @click="beginTagResolution">继续处理</button></div></template>
      <template v-else-if="dialog === 'tag-delete-resolve'"><span class="eyebrow">RESOLVE REFERENCES</span><h2>处理“{{ tagDeleteTarget?.name }}”的关联账目</h2><section class="bulk-replace"><strong>批量替换</strong><div class="resolution-controls"><select name="bulk-replacement-tag-id" v-model="bulkReplacementTagId"><option value="">选择已有标签</option><option v-for="tag in ledger?.tags.filter(item => item.id !== tagDeleteTargetId && item.category === tagDeleteTarget?.category)" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select><input name="bulk-replacement-tag-name" v-model="bulkReplacementTagName" :disabled="Boolean(bulkReplacementTagId)" placeholder="或输入新标签" /><button class="ghost" @click="applyBulkTagReplacement">应用到已选</button></div></section><div class="reference-list"><article v-for="tx in tagDeleteReferences" :key="tx.id"><input name="bulk-selected-transaction-ids" v-model="bulkSelectedTransactionIds" type="checkbox" :value="tx.id" :aria-label="`选择 ${transactionTitle(tx)}`" /><div><strong>{{ transactionTitle(tx) }}</strong><small>{{ tx.bookedAt }} · {{ transactionAmount(tx) }} · {{ auditRole(tx.recordRole) }}</small></div><select name="tag-resolution-drafts-tx-id-action" v-model="tagResolutionDrafts[tx.id]!.action" :disabled="tx.primaryTagId === tagDeleteTargetId"><option value="remove">直接移除</option><option value="replace">替换为</option></select><template v-if="tagResolutionDrafts[tx.id]!.action === 'replace'"><select name="tag-resolution-drafts-tx-id-replacement-tag-id" v-model="tagResolutionDrafts[tx.id]!.replacementTagId"><option value="">选择已有标签</option><option v-for="tag in ledger?.tags.filter(item => item.id !== tagDeleteTargetId && item.category === tagDeleteTarget?.category)" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select><input name="tag-resolution-drafts-tx-id-replacement-tag-name" v-model="tagResolutionDrafts[tx.id]!.replacementTagName" :disabled="Boolean(tagResolutionDrafts[tx.id]!.replacementTagId)" placeholder="或新建标签" /></template><span v-else class="resolution-ok">将移除</span></article></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="!tagResolutionsComplete" @click="dialog = 'tag-delete-confirm'">预览完成，继续</button></div></template>
      <template v-else-if="dialog === 'tag-delete-confirm'"><span class="eyebrow">FINAL CONFIRMATION</span><h2>确认删除“{{ tagDeleteTarget?.name }}”</h2><p class="modal-copy">{{ tagDeleteReferences.length ? `将原子更新 ${tagDeleteReferences.length} 条关联账目，然后删除标签。` : '该标签没有直接账目引用；如有子标签，请指定它们的去向。' }}</p><div v-if="tagDeleteChildren.length" class="hierarchy-warning"><p>保留 {{ tagDeleteChildren.map(tag => tag.name).join('、') }} 及所有后代，不级联删除。</p><label>子标签去向<select name="child-disposition-mode" v-model="childDisposition.mode"><option value="" disabled>请选择</option><option value="promote">提升到原父级（{{ parentNameOf(tagDeleteTarget?.parentId) }}）</option><option value="move">移动到其他父级</option></select></label><label v-if="childDisposition.mode === 'move'">目标父级<select name="child-disposition-parent" v-model="childDisposition.parentId"><option value="">根标签（无父级）</option><option v-for="tag in validParentChoices(tagDeleteTargetId)" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select></label></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="danger" :disabled="session.busy || (tagDeleteChildren.length > 0 && !childDisposition.mode)" @click="confirmTagDelete">确认删除</button></div></template>
      <template v-else-if="dialog === 'transaction-delete'"><span class="eyebrow">DELETE TRANSACTION</span><h2>删除这笔账目？</h2><p class="modal-copy">系统不会移除原始记录，而会新增一条资金流向相反的冲销记录，并将两条记录关联。</p><div v-if="transactionDeleteTarget" class="rename-preview"><small>{{ transactionDeleteTarget.bookedAt }} · {{ transactionTitle(transactionDeleteTarget) }}</small><strong>{{ transactionAmount(transactionDeleteTarget) }}</strong></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="danger" :disabled="session.busy" @click="confirmTransactionDelete">确认删除账目</button></div></template>
      <template v-else-if="dialog === 'transaction-tags'"><span class="eyebrow">EDIT TAGS</span><h2>修改账目标签</h2><p class="modal-copy">单击切换选中状态，双击设为主标签。本操作只更新标签，不新增资金流水。</p><TagSelection :tags="transactionEditTags" v-model:selected="transactionTagIds" v-model:primary="transactionPrimaryTagId" /><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="session.busy || !transactionTagIds.length || !transactionPrimaryTagId" @click="saveTransactionTags">保存标签</button></div></template>
      <template v-else-if="dialog === 'transaction-correct'"><span class="eyebrow">CORRECTION GROUP</span><h2>更正账目资金数据</h2><p class="modal-copy">保存后将原子追加“反向原值＋更正后新值”两条同组记录；原始发生时间保持为 {{ correctionForm.occurredAtLocal.replace('T', ' ') }}。</p><div class="form-grid correction-form"><label>类型<select name="correction-form-kind" v-model="correctionForm.kind" @change="correctionForm.selectedTagIds=[]; correctionForm.primaryTagId=''"><option value="expense">支出</option><option value="income">收入</option><option value="transfer">转移</option></select></label><label>原始发生时间<input name="correction-form-occurred-at" v-model="correctionForm.occurredAtLocal" type="datetime-local" step="1" disabled /></label><div v-if="correctionForm.kind!=='income'" class="picker-field entry-source-account"><span>支出账户</span><AccountPicker v-model="correctionForm.sourceAccountId" :accounts="activeAccounts" placeholder="选择支出账户" search-placeholder="搜索支出账户" /></div><label v-if="correctionForm.kind!=='income'">支出金额<div class="money-input"><input name="correction-form-source-amount" v-model="correctionForm.sourceAmount" type="number" min="0" /><select name="correction-form-source-currency" v-model="correctionForm.sourceCurrency"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></div></label><div v-if="correctionForm.kind!=='expense'" class="picker-field entry-destination-account"><span>收入账户</span><AccountPicker v-model="correctionForm.destinationAccountId" :accounts="activeAccounts" placeholder="选择收入账户" search-placeholder="搜索收入账户" /></div><label v-if="correctionForm.kind!=='expense'">收入金额<div class="money-input"><input name="correction-form-destination-amount" v-model="correctionForm.destinationAmount" type="number" min="0" /><select name="correction-form-destination-currency" v-model="correctionForm.destinationCurrency"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></div></label><label class="wide">备注<input name="correction-form-note" v-model="correctionForm.note" maxlength="240" /></label></div><div v-if="correctionForm.kind!=='transfer'" class="tag-picker"><span>{{ correctionForm.kind === 'income' ? '收入标签' : '支出标签' }}</span><TagSelection :tags="correctionTags" v-model:selected="correctionForm.selectedTagIds" v-model:primary="correctionForm.primaryTagId" /></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="session.busy" @click="saveTransactionCorrection">保存更正</button></div></template>
      <template v-else-if="dialog === 'transaction-order'"><span class="eyebrow">MODIFICATION ORDER</span><h2>修改顺序调整向导</h2><p class="modal-copy">仅列出修改时间落在同一秒的账目。拖动左侧握柄调整从新到旧的顺序；资金、发生时间和审计链不会改变。</p><TransitionGroup name="reorder" tag="div" class="migration-time-list transaction-order-list"><article v-for="(row,index) in transactionOrderRows" :key="row.id" data-reorder-scope="transaction-order" :data-reorder-index="index" :class="{ dragging: transactionOrderDragIndex === index, 'group-start': index === 0 || transactionOrderRows[index - 1]?.updatedAt.slice(0,19) !== row.updatedAt.slice(0,19) }" @dragover.prevent @drop="dropTransactionOrderRow(index)"><span class="drag-handle" draggable="true" role="button" tabindex="0" :aria-label="`拖动排序 ${transactionTitle(row)}`" @dragstart="startTransactionOrderDrag($event,index)" @dragend="transactionOrderDragIndex = null" @pointerdown="startPointerReorder($event,'transaction-order',index)" @pointermove="movePointerReorder" @pointerup="finishPointerReorder" @pointercancel="finishPointerReorder" @keydown.up.prevent="moveTransactionOrderRow(index,index - 1)" @keydown.down.prevent="moveTransactionOrderRow(index,index + 1)"><span class="drag-grip" aria-hidden="true"></span></span><div><small class="order-group-label">同秒组 · {{ row.updatedAt.replace('T',' ').slice(0,19) }}</small><strong>{{ transactionTitle(row) }}</strong><small>{{ transactionAmount(row) }} · {{ row.note || tagNameOf(row.primaryTagId) }}</small></div><span class="order-position">{{ transactionOrderRows.filter(item => item.updatedAt.slice(0,19) === row.updatedAt.slice(0,19)).findIndex(item => item.id === row.id) + 1 }}</span></article></TransitionGroup><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="session.busy" @click="saveTransactionOrder">保存顺序</button></div></template>
      <template v-else-if="dialog === 'audit-chain'"><span class="eyebrow">AUDIT TRAIL</span><h2>完整审计记录链</h2><p class="modal-copy">按提交修订从新到旧排列。更正、冲销和恢复记录始终继承原始业务发生时间。</p><div class="audit-chain"><article v-for="entry in auditChain" :key="entry.id"><span class="pill">{{ auditRole(entry.recordRole) }}</span><div><strong>{{ transactionTitle(entry) }}</strong><small>发生时间 {{ displayOccurredAt(entry) }} · 记录时间 {{ new Date(entry.createdAt).toLocaleString('zh-CN') }}</small><small v-if="entry.operationGroupId">更正组 {{ entry.operationGroupId.slice(0,8) }}</small></div><b>{{ transactionAmount(entry) }}</b></article></div><button class="ghost full" @click="closeDialog">关闭</button></template>
      <template v-else-if="dialog === 'theme'"><ThemeDialog :primary-hue="previewPrimaryHue" :secondary-hue="previewSecondaryHue" :selected-hue="selectedHue" :channel="themeChannel" :color-tone="activeColorTone" :compass-dial-url="compassDialUrl" :busy="session.busy" :theme-color="themeColor" @update:selected-hue="selectedHue = $event" @update:channel="themeChannel = $event" @adjust="adjustHue" @pointer-start="startHueDrag" @pointer-move="moveHueDrag" @pointer-stop="stopHueDrag" @close="closeDialog" @save="saveTheme" /></template>
      <template v-else-if="dialog === 'transaction-entry'">
        <TransactionEntryDialog :form="draftForm" :accounts="activeAccounts" :picker-tags="pickerTags" :pending-drafts="pendingDrafts" :pending-drag-index="pendingDraftDragIndex" :implied-exchange-rate="impliedExchangeRate" :busy="session.busy" :has-unsaved-input="hasUnsavedTransactionInput" :occurred-at-of="displayOccurredAt" @sync="syncTransferAmount" @open-picker="openTagPicker" @add-pending="addPendingDraft" @commit-pending="commitDrafts" @commit-all="commitAllDrafts" @drop="dropPendingDraft" @drag-start="startPendingDraftDrag" @drag-end="pendingDraftDragIndex = null" @pointer-start="startPendingPointer" @pointer-move="movePointerReorder" @pointer-finish="finishPointerReorder" @move="movePendingDraft" @copy="copyPendingDraft" @remove="removePendingDraft">
          <template #picker><PickerDialog :open="tagPickerOpen" title="选择标签" @close="cancelTagPicker"><div class="collapse-content"><section class="tag-picker-panel"><div class="inline-form"><input name="tag-picker-search" v-model="tagPickerSearch" placeholder="筛选标签，回车选择或新建" @keyup.enter="selectOrCreateTagFromSearch" /><button class="ghost" @click="selectOrCreateTagFromSearch">选择 / 新建</button></div><TagParentPicker :tags="pickerTags" v-model:parent-id="pendingParentId" v-model:category="draftTagCategory" category-disabled /><TagSelection :tags="pickerTags" :search="tagPickerSearch" v-model:selected="tagPickerSelectedIds" v-model:primary="tagPickerPrimaryId" /><div class="modal-actions"><button class="ghost" @click="cancelTagPicker">取消</button><button class="primary" @click="confirmTagPicker">确认</button></div></section></div></PickerDialog></template>
        </TransactionEntryDialog>
      </template>
      <template v-else-if="dialog === 'discard-entry'"><span class="eyebrow">UNSAVED CHANGES</span><h2>放弃未保存的账目？</h2><p class="modal-copy">当前填写内容和待提交列表都将被清空。</p><div class="modal-actions"><button class="ghost" @click="dialog = 'transaction-entry'">继续编辑</button><button class="danger" @click="discardTransactionEntry">放弃修改</button></div></template>
  </AppModal>
  <OccurrenceMigrationDialog :open="Boolean(session.migration)" :info="session.migration?.migrationInfo" :rows="migrationTimeRows" :drag-index="migrationDragIndex" :format-money="formatMoney" @close="cancelOccurrenceMigration" @generate="generateMigrationTimes" @drop="dropMigrationRow" @drag-start="startMigrationDrag" @drag-end="migrationDragIndex = null" @pointer-start="startMigrationPointer" @pointer-move="movePointerReorder" @pointer-finish="finishPointerReorder" @nudge="nudgeMigrationRow" @export="session.exportMigrationPreview" @confirm="confirmOccurrenceMigration" />
  <TransitionGroup name="toast" tag="div" class="toast-stack" aria-live="polite" aria-atomic="false">
    <article v-if="pwaUpdateReady" key="pwa-update" class="toast-message toast-warning pwa-update-message">
      <span class="toast-symbol">↻</span><p><strong>新版本已准备就绪</strong><small>立即载入以使用最新版本。</small></p><button class="pwa-update-button" :disabled="pwaUpdateInstalling" @click="loadPwaUpdate">{{ pwaUpdateInstalling ? '正在载入…' : '立即载入' }}</button>
    </article>
    <article v-for="toast in toasts.slice(pwaUpdateReady ? -4 : -5)" :key="toast.id" class="toast-message" :class="`toast-${toast.type}`">
      <span class="toast-symbol">{{ toast.type === 'success' ? '✓' : toast.type === 'warning' ? '!' : '×' }}</span><p>{{ toast.message }}</p><button :aria-label="`关闭提示：${toast.message}`" @click="dismissToast(toast.id)">×</button>
    </article>
  </TransitionGroup>
</template>
