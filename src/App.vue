<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currencyRules, formatMinorUnits, formatMoney, toMinorUnits } from './core/domain/money'
import { currencies, type Currency, type Transaction, type TransactionDraft, type TransactionKind } from './core/domain/types'
import { directTags, type PendingTag, type TagDeletionResolution } from './core/domain/ledger'
import { defaultTheme, normalizeHue, profileForHue, lightThemeColor, hslColor, previewThemeColor, type ColorTone, type ThemeChannel } from './core/domain/theme'
import { useLedgerStore } from './modules/ledger/session'
import { appPages, type AppPage } from './app/router'
import { vBackdropDismiss } from './app/backdrop-dismiss'
import { rememberedAppearance, rememberAppearance, selectLedgerAppearance } from './app/appearance-memory'
import { applyPwaUpdate, pwaUpdateInstalling, pwaUpdateReady } from './app/pwa'
import ThemeCompassHand from './components/ThemeCompassHand.vue'
import PickerDialog from './components/PickerDialog.vue'
import TagSelection from './components/TagSelection.vue'
import { assertCanSetParent, expandTagAncestors, flattenTagHierarchy, rootTagId, tagPath } from './core/domain/tag-hierarchy'
import { implicitTagName, isImplicitTagId, transactionStatisticalFlows } from './core/domain/statistics'
import AccountPicker from './components/AccountPicker.vue'
import AnalyticsPage from './components/AnalyticsPage.vue'
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
type SessionTransition = 'idle' | 'unlocking' | 'locking'
const sessionTransition = ref<SessionTransition>('idle')
const showLogin = computed(() => !session.isUnlocked || sessionTransition.value !== 'idle')
const search = ref('')
type Dialog = 'tag-edit' | 'account-create' | 'create' | 'unlock' | 'import' | 'import-conflict' | 'rename-name' | 'rename-secret' | 'delete' | 'theme' | 'transaction-entry' | 'discard-entry' | 'account-edit' | 'account-delete' | 'tag-delete-warning' | 'tag-delete-resolve' | 'tag-delete-confirm' | 'transaction-delete' | 'transaction-tags' | 'transaction-correct' | 'audit-chain' | 'change-passphrase' | 'security-migration' | 'restore-recovery'
const dialog = ref<Dialog | null>(null)
const modalElement = ref<HTMLElement>()
let focusBeforeDialog: HTMLElement | null = null
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
watch(dialog, async (current, previous) => {
  if (current && !previous) focusBeforeDialog = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (current) {
    await nextTick()
    const first = modalElement.value?.querySelector<HTMLElement>('[autofocus],input:not([disabled]),select:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])')
    first?.focus()
  } else if (previous) {
    focusBeforeDialog?.focus()
    focusBeforeDialog = null
  }
})
function trapModalFocus(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return }
  if (event.key !== 'Tab' || !modalElement.value) return
  const focusable = [...modalElement.value.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((item) => item.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]!; const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
const previewPrimaryHue = ref<number>(defaultTheme.primaryHue)
const previewSecondaryHue = ref<number>(defaultTheme.secondaryHue)
const previewColorTone = ref<ColorTone>(defaultTheme.colorTone)
const themeChannel = ref<ThemeChannel>('primary')
const huePalette = Array.from({ length: 24 }, (_, index) => index * 15)
const draggingHue = ref(false)
const renameTargetId = ref<string>()
const renameOriginalName = ref('')
const deleteForm = reactive({ ledgerId: '', name: '', secret: '', confirmed: false })

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
  root.setProperty('--theme-primary-saturation-scale', String(primaryProfile.saturation))
  root.setProperty('--theme-primary-lightness-scale', String(primaryProfile.lightness))
  root.setProperty('--theme-secondary-saturation-scale', String(secondaryProfile.saturation))
  root.setProperty('--theme-secondary-lightness-scale', String(secondaryProfile.lightness))
  root.setProperty('--theme-primary-hue', `${activePrimaryHue.value}`)
  root.setProperty('--theme-primary-saturation', `${Math.round(72 * primaryProfile.saturation)}%`)
  root.setProperty('--theme-primary-lightness', `${Math.round(48 * primaryProfile.lightness)}%`)
  root.setProperty('--theme-secondary-hue', `${activeSecondaryHue.value}`)
  root.setProperty('--theme-secondary-saturation', `${Math.round(78 * secondaryProfile.saturation)}%`)
  root.setProperty('--theme-secondary-lightness', `${Math.round(53 * secondaryProfile.lightness)}%`)
  root.setProperty('--color-light-banner', hslColor(lightThemeColor(activePrimaryHue.value, 'banner')))
  if (activeColorTone.value === 'light') {
    const primary = lightThemeColor(activePrimaryHue.value, 'action')
    const secondary = lightThemeColor(activeSecondaryHue.value, 'action')
    root.setProperty('--theme-primary-saturation', `${primary.saturation}%`)
    root.setProperty('--theme-primary-lightness', `${primary.lightness}%`)
    root.setProperty('--theme-secondary-saturation', `${secondary.saturation}%`)
    root.setProperty('--theme-secondary-lightness', `${secondary.lightness}%`)
  }
})
const balances = computed(() => ledger.value?.balances ?? {})
const activeAccounts = computed(() => ledger.value?.accounts.filter((account) => !account.deletedAt) ?? [])
const normalTransactions = computed(() => ledger.value?.normalTransactions ?? [])
const deletedTransactions = computed(() => ledger.value?.deletedTransactions ?? [])
const recentTransactions = computed(() => normalTransactions.value.slice(0, 6))
const totals = computed(() => ledger.value?.totals ?? Object.fromEntries(currencies.map((currency) => [currency, { income: 0, expense: 0 }])) as Record<Currency, { income: number; expense: number }>)
function categoryBalance(pending: boolean, currency: Currency) { return activeAccounts.value.filter((account) => account.isPendingSpend === pending).reduce((sum, account) => sum + (balances.value[account.id]?.[currency] ?? 0), 0) }

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

const accountForm = reactive({ name: '', pending: false, initial: Object.fromEntries(currencies.map((currency) => [currency, '0'])) as Record<Currency, string> })
const accountSearch = ref('')
const accountStatusFilter = ref<'all' | 'active' | 'deleted'>('all')
const accountCategoryFilter = ref<'all' | 'saving' | 'pending'>('all')
const accountEditForm = reactive({ id: '', name: '', pending: false })
const accountDeleteTargetId = ref('')
const filteredAccounts = computed(() => (ledger.value?.accounts ?? []).filter((account) => {
  const matchesName = normalizeSearch(account.name).includes(normalizeSearch(accountSearch.value))
  const matchesStatus = accountStatusFilter.value === 'all' || (accountStatusFilter.value === 'deleted' ? Boolean(account.deletedAt) : !account.deletedAt)
  const matchesCategory = accountCategoryFilter.value === 'all' || (accountCategoryFilter.value === 'pending' ? account.isPendingSpend : !account.isPendingSpend)
  return matchesName && matchesStatus && matchesCategory
}))
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

const tagName = ref('')
const tagParentId = ref('')
const parentEdit = reactive({ tagId: '', name: '', parentId: '', confirmed: false })
const tagSearch = ref('')
const tagSearchActive = computed(() => Boolean(normalizeSearch(tagSearch.value)))
const expandedTagIds = ref<string[]>([])
watch(() => ledger.value?.id, () => { expandedTagIds.value = [] })
function expandTagPath(id?: string) {
  if (!ledger.value || !id) return
  expandedTagIds.value = [...new Set([...expandedTagIds.value, ...expandTagAncestors(ledger.value.tags, [id])])]
}
const tagTreeRows = computed(() => {
  if (!ledger.value) return []
  const all = flattenTagHierarchy(ledger.value.tags)
  const query = normalizeSearch(tagSearch.value)
  let searched: Set<string> | undefined
  if (query) {
    searched = new Set<string>()
    for (const row of all) if (normalizeSearch(tagPath(ledger.value.tags, row.tag.id)).includes(query)) {
      for (const id of expandTagAncestors(ledger.value.tags, [row.tag.id])) searched.add(id)
    }
  }
  return all.map(row => {
    let visible = !searched || searched.has(row.tag.id)
    let parentId = row.tag.parentId
    while (visible && !query && parentId) {
      if (!expandedTagIds.value.includes(parentId)) visible = false
      parentId = ledger.value!.tags.find(tag => tag.id === parentId)?.parentId
    }
    return { ...row, visible }
  })
})
const hasVisibleTagTreeRows = computed(() => tagTreeRows.value.some(row => row.visible))
function toggleTagBranch(id: string) {
  if (tagSearchActive.value) return
  expandedTagIds.value = expandedTagIds.value.includes(id) ? expandedTagIds.value.filter(value => value !== id) : [...expandedTagIds.value, id]
}
async function createTag() {
  if (!ledger.value) return
  const parentId = tagParentId.value || undefined
  const result = await session.addTag(tagName.value, parentId)
  if (result) { expandTagPath(parentId); tagName.value = ''; tagParentId.value = ''; notify('success', '标签已创建') }
}
function openTagEdit(id: string) {
  const tag = ledger.value?.tags.find(item => item.id === id)
  if (!tag) return
  Object.assign(parentEdit, { tagId: id, name: tag.name, parentId: tag.parentId ?? '', confirmed: false })
  dialog.value = 'tag-edit'
}
function validParentChoices(id: string) {
  if (!ledger.value) return []
  return flattenTagHierarchy(ledger.value.tags).map(row => row.tag).filter(tag => { try { assertCanSetParent(ledger.value!.tags, id, tag.id); return true } catch { return false } })
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

interface DraftForm { kind: TransactionKind; sourceAccountId: string; sourceAmount: string; sourceCurrency: Currency; destinationAccountId: string; destinationAmount: string; destinationCurrency: Currency; selectedTagIds: string[]; primaryTagId: string; note: string; bookedAt: string }
const emptyDraft = (): DraftForm => ({ kind: 'expense', sourceAccountId: '', sourceAmount: '', sourceCurrency: 'CNY', destinationAccountId: '', destinationAmount: '', destinationCurrency: 'CNY', selectedTagIds: [], primaryTagId: '', note: '', bookedAt: new Date().toISOString().slice(0, 10) })
const draftForm = reactive<DraftForm>(emptyDraft())
const pendingDrafts = ref<TransactionDraft[]>([])
const pendingTags = ref<PendingTag[]>([])
const hasCurrentTransactionInput = computed(() => draftForm.sourceAmount !== '' || draftForm.destinationAmount !== '' || draftForm.note !== ''
  || draftForm.sourceAccountId !== '' || draftForm.destinationAccountId !== '' || draftForm.selectedTagIds.length > 0)
const hasUnsavedTransactionInput = computed(() => pendingDrafts.value.length > 0 || hasCurrentTransactionInput.value)
const showDeleted = ref(false)
const transactionFilters = reactive({
  bookedFrom: '', bookedTo: '', kind: 'all', accountId: '', currency: '', minAmount: '', maxAmount: '',
  tagId: '', tagMode: 'included', note: '', createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '', sort: 'updated-desc',
})
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
    if (transactionFilters.sort === 'updated-asc') return a.updatedAt.localeCompare(b.updatedAt)
    if (transactionFilters.sort === 'booked-desc') return b.bookedAt.localeCompare(a.bookedAt)
    if (transactionFilters.sort === 'booked-asc') return a.bookedAt.localeCompare(b.bookedAt)
    if (transactionFilters.sort === 'amount-desc') return (transactionMoney(b)?.minorUnits ?? 0) - (transactionMoney(a)?.minorUnits ?? 0)
    if (transactionFilters.sort === 'amount-asc') return (transactionMoney(a)?.minorUnits ?? 0) - (transactionMoney(b)?.minorUnits ?? 0)
    return b.updatedAt.localeCompare(a.updatedAt)
  })
})
const transactionPageCount = computed(() => Math.max(1, Math.ceil(filteredTransactionRows.value.length / TRANSACTIONS_PER_PAGE)))
const paginatedTransactions = computed(() => filteredTransactionRows.value.slice((transactionPage.value - 1) * TRANSACTIONS_PER_PAGE, transactionPage.value * TRANSACTIONS_PER_PAGE))
watch([showDeleted, () => JSON.stringify(transactionFilters)], () => { transactionPage.value = 1 })
function clearTransactionFilters() {
  Object.assign(transactionFilters, { bookedFrom: '', bookedTo: '', kind: 'all', accountId: '', currency: '', minAmount: '', maxAmount: '', tagId: '', tagMode: 'included', note: '', createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '', sort: 'updated-desc' })
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
    selectedTagIds: [...directTags(tx)], primaryTagId: tx.primaryTagId ?? '', note: tx.note, bookedAt: tx.bookedAt,
  })
  dialog.value = 'transaction-correct'
}
async function saveTransactionCorrection() {
  try {
    const draft: TransactionDraft = { kind: correctionForm.kind, bookedAt: correctionForm.bookedAt, note: correctionForm.note }
    if (correctionForm.kind !== 'income') { draft.sourceAccountId = correctionForm.sourceAccountId; draft.sourceMoney = { currency: correctionForm.sourceCurrency, minorUnits: toMinorUnits(correctionForm.sourceAmount, correctionForm.sourceCurrency) } }
    if (correctionForm.kind !== 'expense') { draft.destinationAccountId = correctionForm.destinationAccountId; draft.destinationMoney = { currency: correctionForm.destinationCurrency, minorUnits: toMinorUnits(correctionForm.destinationAmount, correctionForm.destinationCurrency) } }
    if (correctionForm.kind === 'expense') { draft.selectedTagIds = [...correctionForm.selectedTagIds]; draft.primaryTagId = correctionForm.primaryTagId }
    await session.correctTransaction(transactionEditTargetId.value, draft)
    if (!session.error) { dialog.value = null; notify('success', '资金数据已通过原子更正组更新') }
  } catch (cause) { session.error = messageOf(cause) }
}
function openAuditChain(tx: Transaction) { auditTargetId.value = transactionRootId(tx); dialog.value = 'audit-chain' }
function auditRole(role: Transaction['recordRole']) { return ({ normal: '原始记录', reversal: '反向记录', replacement: '更正后记录', restoration: '恢复记录', 'system-account-open': '开户记录', 'system-account-close': '销户记录' } as Record<Transaction['recordRole'], string>)[role] }
const tagPickerOpen = ref(false)
const tagPickerSearch = ref('')
const pendingParentId = ref('')
const tagPickerSelectedIds = ref<string[]>([])
const tagPickerPrimaryId = ref('')
const tagPickerSessionCreatedIds = ref<string[]>([])
function normalizeSearch(value: string) { return value.trim().normalize('NFKC').toLocaleLowerCase() }
const pickerTags = computed(() => [
  ...(ledger.value?.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name, parentId: tag.parentId, isNew: false })),
  ...pendingTags.value.map((tag) => ({ id: tag.clientId, name: tag.name, parentId: tag.parentId, isNew: true })),
])
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
  const expanded = new Set(expandTagAncestors(pickerTags.value, [...used]))
  pendingTags.value = pendingTags.value.filter((tag) => expanded.has(tag.clientId))
}
function selectOrCreateTagFromSearch() {
  const cleanName = tagPickerSearch.value.trim()
  if (!cleanName) return
  let tag = pickerTags.value.find((item) => normalizeSearch(item.name) === normalizeSearch(cleanName))
  if (!tag) {
    const pending = { clientId: `temp:${crypto.randomUUID()}`, name: cleanName, parentId: pendingParentId.value || undefined }
    pendingTags.value.push(pending)
    tagPickerSessionCreatedIds.value.push(pending.clientId)
    tag = { id: pending.clientId, name: pending.name, parentId: pending.parentId, isNew: true }
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
  if (!tagPickerSelectedIds.value.length || !tagPickerPrimaryId.value) { notify('warning', '支出账目至少需要一个标签和主标签'); return }
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
function copyPendingDraft(index: number) { pendingDrafts.value.push(JSON.parse(JSON.stringify(pendingDrafts.value[index]!)) as TransactionDraft) }
function removePendingDraft(index: number) { pendingDrafts.value.splice(index, 1); cleanUnusedPendingTags() }
function currentTransactionDraft(): TransactionDraft {
  const draft: TransactionDraft = { kind: draftForm.kind, bookedAt: draftForm.bookedAt, note: draftForm.note }
  if (draftForm.kind !== 'income') { draft.sourceAccountId = draftForm.sourceAccountId; draft.sourceMoney = { currency: draftForm.sourceCurrency, minorUnits: toMinorUnits(draftForm.sourceAmount, draftForm.sourceCurrency) } }
  if (draftForm.kind !== 'expense') { draft.destinationAccountId = draftForm.destinationAccountId; draft.destinationMoney = { currency: draftForm.destinationCurrency, minorUnits: toMinorUnits(draftForm.destinationAmount, draftForm.destinationCurrency) } }
  if (draftForm.kind === 'expense') {
    if (!draftForm.selectedTagIds.length || !draftForm.primaryTagId) throw new Error('请先确认至少一个标签和主标签')
    draft.selectedTagIds = [...draftForm.selectedTagIds]; draft.primaryTagId = draftForm.primaryTagId
  }
  return draft
}
function addPendingDraft() {
  try {
    pendingDrafts.value.push(currentTransactionDraft())
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
    if (hasCurrentTransactionInput.value) drafts.push(currentTransactionDraft())
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
  tagName.value = ''
  tagParentId.value = ''
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
  <main v-if="showLogin" class="login-shell" :class="{ 'login-transition-layer': sessionTransition !== 'idle', 'is-unlocking': sessionTransition === 'unlocking', 'is-locking': sessionTransition === 'locking' }">
    <section class="login-hero">
      <span class="eyebrow">LOCAL · PRIVATE · YOURS</span>
      <h1>把每一笔<br class="desktop-title-break">资金，<br><em>讲成清楚的故事。</em></h1>
      <p>数据只保存在这台设备。账本加密后进入 IndexedDB，无需账户、网络或云端。</p>
    </section>
    <section class="ledger-panel">
      <div v-if="missingCapabilities.length" class="capability-warning" role="alert"><strong>此浏览器无法安全运行 RW Balance</strong><span>缺少：{{ missingCapabilities.join('、') }}。请升级浏览器后再使用。</span></div>
      <div class="panel-title"><div><span class="eyebrow">YOUR LEDGERS</span><h2>选择一个账本</h2></div><button class="primary" @click="openCreateDialog">＋ 新建账本</button></div>
      <label class="search"><span class="search-icon" aria-hidden="true"></span><input name="search" v-model="search" placeholder="搜索本机账本" /></label>
      <div v-if="filteredIndexes.length" class="ledger-list">
        <article v-for="entry in filteredIndexes" :key="entry.ledgerId" class="ledger-card" @click="openUnlock(entry.ledgerId)">
          <strong>{{ entry.displayName }}</strong>
          <div class="ledger-card-actions"><button class="ghost small" @click.stop="openLoginRename(entry)">修改名称</button><button class="ghost small danger-text" @click.stop="openDeleteDialog(entry.ledgerId, entry.displayName)">删除</button></div>
        </article>
      </div>
      <div v-else class="empty"><span>◇</span><p>{{ search ? '没有匹配的账本' : '还没有账本，从新建一个开始。' }}</p></div>
      <button class="link-button" @click="dialog = 'import'; secret = ''">从加密文件导入账本</button>
    </section>
  </main>

  <div v-if="session.isUnlocked" class="app-shell" :class="{ 'app-entering': sessionTransition === 'unlocking', 'app-leaving': sessionTransition === 'locking' }">
    <aside class="sidebar">
      <div class="brand"><span>RW</span><div>Balance<small>{{ ledger?.name }}</small></div></div>
      <nav>
        <button v-for="item in ([['dashboard','总览'],['accounts','账户'],['tags','标签'],['transactions','账目'],['analytics','统计'],['settings','设置']] as const)" :key="item[0]" :class="{ active: page === item[0] }" @click="page = item[0]"><span>{{ { dashboard:'⌂', accounts:'◫', tags:'◇', transactions:'≡', analytics:'⌁', settings:'⚙' }[item[0]] }}</span>{{ item[1] }}</button>
      </nav>
      <button class="sidebar-add-button" @click="openTransactionEntry">＋ 新增账目</button>
      <div class="session-actions"><button class="switch-ledger-button" @click="lock('away')">◷ 暂离</button><button class="lock-button" @click="lock('exit')">⇥ 退出</button></div>
    </aside>
    <section class="content">
      <header class="topbar"><div><span class="eyebrow">{{ page.toUpperCase() }}</span><h2>{{ { dashboard:'资金总览', accounts:'账户管理', tags:'标签管理', transactions:'账目记录', analytics:'收支统计', settings:'账本设置' }[page] }}</h2></div><div class="status"><span class="status-dot"></span>本地已解锁</div></header>
      <Transition name="page-fade" mode="out-in">
      <div :key="page" class="page-view">
      <template v-if="page === 'dashboard'">
        <section class="welcome"><div><span class="eyebrow">最近 30 天</span><h3>你好，这是你的资金快照。</h3><p>所有币种独立统计，不做未经确认的汇率折算。</p></div><button class="primary record-button" @click="openTransactionEntry">＋ 记录一笔</button></section>
        <div class="currency-grid">
          <article v-for="currency in currencies" :key="currency" class="metric-card"><span>{{ currency }}</span><strong>{{ formatMinorUnits(Object.values(balances).reduce((sum, item) => sum + (item[currency] ?? 0), 0), currency) }}</strong><div><button class="metric-link income-text" @click="drillToTransactions({ currency,kind:'income' })">收入 {{ formatMinorUnits(totals[currency].income, currency) }}</button><button class="metric-link expense-text" @click="drillToTransactions({ currency,kind:'expense' })">支出 {{ formatMinorUnits(totals[currency].expense, currency) }}</button></div></article>
        </div>
        <div class="dashboard-detail-grid"><section class="surface"><div class="section-title"><div><span class="eyebrow">BY ACCOUNT</span><h3>账户余额概览</h3></div><button class="link-button" @click="page='accounts'">管理账户 →</button></div><div class="dashboard-account-list"><button v-for="account in activeAccounts" :key="account.id" @click="drillToTransactions({ accountId:account.id })"><strong>{{ account.name }}</strong><span v-for="currency in currencies.filter(item => (balances[account.id]?.[item] ?? 0) !== 0)" :key="currency">{{ formatMinorUnits(balances[account.id]?.[currency] ?? 0,currency) }}</span><small v-if="currencies.every(item => (balances[account.id]?.[item] ?? 0) === 0)">余额为 0</small></button></div></section><section class="surface"><span class="eyebrow">PURPOSE</span><h3>储蓄与待支出</h3><div class="category-balance-list"><div v-for="currency in currencies" :key="currency"><strong>{{ currency }}</strong><span>储蓄 {{ formatMinorUnits(categoryBalance(false,currency),currency) }}</span><span>待支出 {{ formatMinorUnits(categoryBalance(true,currency),currency) }}</span></div></div><button class="primary full" @click="page='analytics'">打开完整统计</button></section></div>
        <section class="surface"><div class="section-title"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>最近账目</h3></div><button class="link-button" @click="page = 'transactions'">查看全部 →</button></div><div v-if="recentTransactions.length" class="transaction-list"><article v-for="tx in recentTransactions" :key="tx.id"><div class="tx-icon" :class="tx.kind">{{ tx.kind === 'income' ? '↙' : tx.kind === 'expense' ? '↗' : '↔' }}</div><div><strong>{{ transactionTitle(tx) }}</strong><small>{{ tx.bookedAt }} · {{ tx.note || (exchangeTagSummary(tx) ? '换汇' : tagNameOf(tx.primaryTagId)) }}</small><small v-if="exchangeTagSummary(tx)" class="implicit-tag-summary">{{ exchangeTagSummary(tx) }}</small></div><b>{{ transactionAmount(tx) }}</b></article></div><div v-else class="empty compact">还没有账目</div></section>
      </template>

      <template v-if="page === 'accounts'">
        <div class="section-title"><h3>我的账户</h3><button class="primary" @click="dialog = 'account-create'">＋ 添加账户</button></div>
        <section class="surface filter-toolbar"><label class="search"><span class="search-icon" aria-hidden="true"></span><input name="account-search" v-model="accountSearch" placeholder="搜索账户名称" /></label><label>状态<select name="account-status-filter" v-model="accountStatusFilter"><option value="all">全部</option><option value="active">正常</option><option value="deleted">已删除</option></select></label><label>余额分类<select name="account-category-filter" v-model="accountCategoryFilter"><option value="all">全部</option><option value="saving">储蓄</option><option value="pending">待支出</option></select></label></section>
        <div class="account-grid"><article v-for="account in filteredAccounts" :key="account.id" class="account-card" :class="{ muted: account.deletedAt }"><div class="section-title"><div><small>{{ account.isPendingSpend ? '待支出' : '储蓄' }}</small><h3>{{ account.name }}</h3></div><span class="pill">{{ account.deletedAt ? '已删除' : '正常' }}</span></div><div class="balance-lines"><div v-for="currency in currencies.filter(c => (balances[account.id]?.[c] ?? 0) !== 0)" :key="currency"><span>{{ currency }}</span><strong>{{ formatMinorUnits(balances[account.id]?.[currency] ?? 0, currency) }}</strong></div><small v-if="currencies.every(c => (balances[account.id]?.[c] ?? 0) === 0)">所有币种余额为 0</small></div><div v-if="!account.deletedAt" class="card-actions"><button class="ghost" @click="openAccountEdit(account.id)">编辑</button><button class="danger ghost" @click="openAccountDelete(account.id)">删除</button></div><button v-else class="ghost full" @click="recoverAccount(account.id)">恢复账户</button></article></div>
        <div v-if="!filteredAccounts.length" class="empty compact">没有符合筛选条件的账户</div>
      </template>

      <template v-if="page === 'tags'">
        <div class="tag-stat-grid"><section v-for="mode in (['primary','included'] as const)" :key="mode" class="surface"><span class="eyebrow">LAST 30 DAYS</span><h3>{{ mode === 'primary' ? '主标签支出 Top 3' : '任意包含标签 Top 3' }}</h3><div class="tag-stat-currencies"><div v-for="currency in currencies" :key="currency"><strong>{{ currency }}</strong><ol><li v-for="stat in ledger?.tagStats[mode][currency]" :key="stat.tagId"><span>{{ tagNameOf(stat.tagId) }}</span><b>{{ formatMinorUnits(stat.minorUnits, currency) }}</b></li><li v-if="!ledger?.tagStats[mode][currency].length">暂无支出</li></ol></div></div></section></div>
        <section class="surface">
          <div class="section-title"><div><span class="eyebrow">CATEGORIES</span><h3>标注钱花去了哪里</h3></div></div>
          <div class="inline-form tag-create-form"><input name="tag-name" v-model="tagName" placeholder="输入新标签名称" @keyup.enter="createTag" /><select name="tag-parent-id" aria-label="新标签的父标签" v-model="tagParentId"><option value="">根标签（无父级）</option><option v-for="tag in ledger?.tags" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select><button class="primary" :disabled="session.busy" @click="createTag">添加</button></div>
          <label class="search tag-search"><span class="search-icon" aria-hidden="true"></span><input name="tag-search" v-model="tagSearch" placeholder="筛选标签或父级" /></label>
          <div class="tag-management-list"><div v-for="row in tagTreeRows" :key="row.tag.id" class="tag-tree-collapse" :class="{ open: row.visible }" :inert="!row.visible"><div class="tag-tree-collapse-content"><article :class="{ expandable: row.hasChildren && !tagSearchActive }" :style="{ '--tag-depth': row.depth }" @click="row.hasChildren && toggleTagBranch(row.tag.id)"><div class="tag-tree-main"><button v-if="row.hasChildren" type="button" class="tag-tree-toggle" :disabled="tagSearchActive" :aria-label="`${expandedTagIds.includes(row.tag.id) || tagSearchActive ? '折叠' : '展开'} ${row.tag.name} 的子标签`" :aria-expanded="expandedTagIds.includes(row.tag.id) || tagSearchActive" @click.stop="toggleTagBranch(row.tag.id)"><span class="disclosure-triangle" :class="{ expanded: expandedTagIds.includes(row.tag.id) || tagSearchActive }" aria-hidden="true"></span></button><span v-else class="tag-tree-spacer"></span><span class="tag-path">{{ row.tag.name }}</span></div><div class="actions"><button class="ghost small" :aria-label="'修改标签 ' + row.tag.name" @click.stop="openTagEdit(row.tag.id)">修改</button><button class="ghost small danger-text" :aria-label="'删除标签 ' + row.tag.name" @click.stop="openTagDelete(row.tag.id)">删除</button></div></article></div></div></div>
          <div v-if="!hasVisibleTagTreeRows" class="empty compact">没有符合筛选条件的标签</div>
          <details v-if="ledger?.hierarchyChanges.length" class="hierarchy-history"><summary>层级变更记录（{{ ledger.hierarchyChanges.length }}）</summary><ol><li v-for="(change, index) in [...ledger.hierarchyChanges].reverse()" :key="index">{{ new Date(change.changedAt).toLocaleString('zh-CN') }} · {{ tagNameOf(change.tagId) }} · {{ change.action === 'delete' ? '删除标签' : parentNameOf(change.previousParentId) + ' → ' + parentNameOf(change.parentId) }} · 影响 {{ change.affectedTransactions }} 条记录</li></ol></details>
        </section>
      </template>

      <template v-if="page === 'transactions'">
        <section class="surface transaction-filter-panel"><div class="section-title"><div><span class="eyebrow">COMBINED FILTERS</span><h3>组合筛选</h3></div><button class="ghost small" @click="clearTransactionFilters">清空筛选</button></div><div class="transaction-filter-grid"><label>记账开始<input name="transaction-filters-booked-from" v-model="transactionFilters.bookedFrom" type="date" /></label><label>记账结束<input name="transaction-filters-booked-to" v-model="transactionFilters.bookedTo" type="date" /></label><label>类型<select name="transaction-filters-kind" v-model="transactionFilters.kind"><option value="all">全部</option><option value="income">收入（含换汇）</option><option value="expense">支出（含换汇）</option><option value="transfer">转移</option></select></label><label>账户<select name="transaction-filters-account-id" v-model="transactionFilters.accountId"><option value="">全部账户</option><option v-for="account in ledger?.accounts" :key="account.id" :value="account.id">{{ account.name }}</option></select></label><label>币种<select name="transaction-filters-currency" v-model="transactionFilters.currency"><option value="">全部币种</option><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></label><label>最小金额<input name="transaction-filters-min-amount" v-model="transactionFilters.minAmount" type="number" min="0" /></label><label>最大金额<input name="transaction-filters-max-amount" v-model="transactionFilters.maxAmount" type="number" min="0" /></label><label>标签<select name="transaction-filters-tag-id" v-model="transactionFilters.tagId"><option value="">全部标签</option><optgroup v-if="exchangeImplicitTags.length" label="换汇隐含标签"><option v-for="tag in exchangeImplicitTags" :key="tag.id" :value="tag.id">{{ tag.name }}</option></optgroup><optgroup label="普通标签"><option v-for="tag in ledger?.tags" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></optgroup></select></label><label>标签口径<select name="transaction-filters-tag-mode" v-model="transactionFilters.tagMode"><option value="included">包含子标签</option><option value="direct">仅直接选择</option><option value="primary">仅主标签（精确）</option><option value="primary-root">主标签按根级汇总</option></select></label><label>备注关键词<input name="transaction-filters-note" v-model="transactionFilters.note" placeholder="搜索备注" /></label><label>创建开始<input name="transaction-filters-created-from" v-model="transactionFilters.createdFrom" type="date" /></label><label>创建结束<input name="transaction-filters-created-to" v-model="transactionFilters.createdTo" type="date" /></label><label>修改开始<input name="transaction-filters-updated-from" v-model="transactionFilters.updatedFrom" type="date" /></label><label>修改结束<input name="transaction-filters-updated-to" v-model="transactionFilters.updatedTo" type="date" /></label><label>排序<select name="transaction-filters-sort" v-model="transactionFilters.sort"><option value="updated-desc">最近修改优先</option><option value="updated-asc">最早修改优先</option><option value="booked-desc">记账日期从新到旧</option><option value="booked-asc">记账日期从旧到新</option><option value="amount-desc">金额从高到低</option><option value="amount-asc">金额从低到高</option></select></label></div></section>
        <section class="surface"><div class="section-title"><div><span class="eyebrow">HISTORY</span><h3>{{ showDeleted ? '已删除账目' : '有效账目' }} · {{ filteredTransactionRows.length }} 条</h3></div><div class="actions"><button class="primary" @click="openTransactionEntry">＋ 新增账目</button><button class="ghost" @click="showDeleted = !showDeleted">{{ showDeleted ? '查看有效账目' : `已删除 (${deletedTransactions.length})` }}</button></div></div><div class="transaction-list"><article v-for="tx in paginatedTransactions" :key="tx.id"><div class="tx-icon" :class="tx.kind">{{ tx.kind === 'income' ? '↙' : tx.kind === 'expense' ? '↗' : '↔' }}</div><div><strong>{{ transactionTitle(tx) }}</strong><small>{{ tx.bookedAt }} · {{ tx.note || tagNameOf(tx.primaryTagId) }}</small><small v-if="tx.selectedTagIds.length">直接：{{ directTags(tx).map(tagNameOf).join('、') }}<template v-if="tx.selectedTagIds.some(id => !directTags(tx).includes(id))"> · 继承：{{ tx.selectedTagIds.filter(id => !directTags(tx).includes(id)).map(tagNameOf).join('、') }}</template></small><small v-if="exchangeTagSummary(tx)" class="implicit-tag-summary">{{ exchangeTagSummary(tx) }}</small><small v-if="tx.recordRole === 'replacement'">已更正 · 原记账日期保持不变</small></div><b>{{ transactionAmount(tx) }}</b><div class="transaction-row-actions"><button class="ghost small" @click="openAuditChain(tx)">历史</button><button v-if="!showDeleted && tx.kind === 'expense'" class="ghost small" @click="openTransactionTags(tx)">标签</button><button v-if="!showDeleted" class="ghost small" @click="openTransactionCorrection(tx)">更正</button><button v-if="!showDeleted" class="ghost small danger-text" :aria-label="'删除账目 ' + transactionTitle(tx)" @click="openTransactionDelete(tx.id)">删除</button><button v-else class="ghost small" @click="recoverTransaction(tx.id)">恢复</button></div></article><div v-if="!filteredTransactionRows.length" class="empty compact">没有符合筛选条件的记录</div></div><div v-if="transactionPageCount > 1" class="pagination"><button class="ghost small" :disabled="transactionPage <= 1" @click="transactionPage--">上一页</button><span>第 {{ transactionPage }} / {{ transactionPageCount }} 页</span><button class="ghost small" :disabled="transactionPage >= transactionPageCount" @click="transactionPage++">下一页</button></div></section>
      </template>

      <template v-if="page === 'analytics' && ledger"><AnalyticsPage :ledger="ledger" :primary-hue="currentPrimaryHue" :secondary-hue="currentSecondaryHue" @drill="drillToTransactions" /></template>

      <template v-if="page === 'settings'">
        <section v-if="ledger?.hasMigrationBackup" class="surface settings settings-row"><div><h3>升级前备份</h3><p>独立保存的 v1 密文不会被后续编辑覆盖。使用旧版客户端前，请先导出此备份；升级后的新记录不包含在其中。</p></div><button class="ghost" @click="session.exportMigrationBackup">导出 v1 升级前备份</button></section>
        <section class="surface settings settings-row"><div><span class="eyebrow">LEDGER IDENTITY</span><h3>账本名称</h3><p>当前名称：{{ ledger?.name }}。修改时会在最后一步要求访问口令确认。</p></div><button class="primary" @click="openRenameDialog">修改账本名称</button></section>
        <section class="surface settings settings-row"><div><span class="eyebrow">COLOR TONE</span><h3>亮色调 / 暗色调</h3><p>改变页面的明暗基底，不改变已选择的主题色相。</p></div><div class="tone-switch-control"><span :class="{ active: currentColorTone === 'light' }">亮色调</span><label class="tone-switch"><input name="color-tone" type="checkbox" aria-label="切换亮暗色调" :checked="currentColorTone === 'dark'" :disabled="session.busy" @change="toggleColorTone"><span class="tone-switch-track"><span class="tone-switch-thumb"></span></span></label><span :class="{ active: currentColorTone === 'dark' }">暗色调</span></div></section>
        <section class="surface settings settings-row"><div><span class="eyebrow">APPEARANCE</span><h3>主题颜色</h3><p>主色与副色均可选择任意色相；设置以紧凑的公开元数据随账本保存，并受到完整性认证。</p></div><button class="theme-entry" @click="openThemeDialog"><span class="theme-entry-colors"><i :style="{ '--preview-color': themeColor('primary') }"></i><i :style="{ '--preview-color': themeColor('secondary') }"></i></span><span>主色 {{ currentPrimaryHue }}° · 副色 {{ currentSecondaryHue }}°</span><span class="disclosure-triangle side" aria-hidden="true"></span></button></section>
        <section class="surface settings settings-row"><div><span class="eyebrow">AUTO AWAY</span><h3>自动暂离</h3><p>无操作达到设定时间后清除解密会话，但保留当前页面和未提交草稿，重新解锁同一账本即可继续。</p></div><div class="timeout-setting"><label>等待秒数<input name="auto-lock-seconds-input" v-model.number="autoLockSecondsInput" type="number" min="30" max="86400" step="1" @keyup.enter="saveAutoLockSeconds" /></label><button class="primary" :disabled="session.busy || autoLockSecondsInput === currentAutoLockSeconds" @click="saveAutoLockSeconds">保存</button></div></section>
        <section class="surface settings settings-row"><div><span class="eyebrow">ACCESS PASSPHRASE</span><h3>修改访问口令</h3><p>验证当前口令后，可为账本设置新的访问口令。</p></div><button class="primary" @click="openPassphraseDialog">修改访问口令</button></section>
        <section class="surface settings settings-row"><div><span class="eyebrow">CRYPTO REGISTRY</span><h3>加密方式</h3><p>当前：{{ ledger?.security.kdf }} + {{ ledger?.security.encryption }}。更改后会生成全新数据密钥并原子替换容器。</p></div><button class="ghost" @click="openSecurityMigration">修改加密方式</button></section>
        <section class="surface settings settings-row"><div><span class="eyebrow">RECOVERY</span><h3>恢复上一版密文</h3><p>每次覆盖写入前都会在 IndexedDB 中保留一个上一版本。恢复时需要该版本对应的访问口令。</p></div><button class="ghost" :disabled="!ledger?.hasRecovery" @click="openRecoveryDialog">{{ ledger?.hasRecovery ? '恢复上一版本' : '暂无上一版本' }}</button></section>
        <section class="surface settings"><span class="eyebrow">ENCRYPTED BACKUP</span><h3>导出完整加密账本</h3><p>导出文件仅包含经过 Deflate 压缩、AES-256-GCM 加密后的容器，不生成明文中间文件。</p><button class="ghost" @click="session.exportCurrent">导出 .rwbl 文件</button></section>
        <section class="surface settings danger-zone"><span class="eyebrow">DANGER ZONE</span><h3>删除当前账本</h3><p>删除会永久移除本机索引和加密容器。确认前可以一键导出完整密文备份。</p><button class="danger ghost" @click="openDeleteDialog(ledger!.id, ledger!.name)">删除账本</button></section>
      </template>
      </div>
      </Transition>
    </section>
  </div>

  <Transition name="modal-motion">
  <div v-if="dialog" class="modal-backdrop" v-backdrop-dismiss="closeDialog">
    <section ref="modalElement" class="modal" role="dialog" aria-modal="true" :aria-label="dialog === 'transaction-delete' ? '删除这笔账目？' : undefined" tabindex="-1" :class="{ 'theme-modal': dialog === 'theme', 'transaction-entry-modal': dialog === 'account-create' || dialog === 'transaction-entry' || dialog === 'transaction-correct', 'tag-resolution-modal': dialog === 'tag-delete-resolve' || dialog === 'audit-chain' }" @keydown="trapModalFocus"><button class="modal-close" aria-label="关闭对话框" @click="closeDialog">×</button>
      <Transition name="dialog-step" mode="out-in"><div :key="dialog" class="dialog-step">
      <template v-if="dialog === 'create'"><span class="eyebrow">NEW LEDGER</span><h2>创建本地加密账本</h2><label>账本名称<input name="create-form-name" v-model="createForm.name" autofocus /></label><label>访问口令<input name="create-form-secret" v-model="createForm.secret" type="password" /></label><label>确认口令<input name="create-form-confirmation" v-model="createForm.confirmation" type="password" @keyup.enter="createNewLedger" /></label><button class="ghost full advanced-trigger" :aria-expanded="createAdvanced" @click="createAdvanced = !createAdvanced">高级设置 <span class="disclosure-triangle" :class="{ expanded: createAdvanced }" aria-hidden="true"></span></button><div class="collapse-shell" :class="{ open: createAdvanced }" :inert="!createAdvanced"><div class="collapse-content"><label>密钥派生算法<select name="create-form-kdf" v-model="createForm.kdf"><option value="PBKDF2-SHA-256">PBKDF2 · SHA-256</option><option value="PBKDF2-SHA-512">PBKDF2 · SHA-512</option></select></label><label>加密算法<select name="create-form-encryption" v-model="createForm.encryption"><option value="AES-256-GCM">AES-256-GCM</option></select></label></div></div><button class="primary full" :disabled="session.busy" @click="createNewLedger">{{ session.busy ? '正在加密…' : '创建并进入' }}</button></template>
      <template v-else-if="dialog === 'unlock'"><span class="eyebrow">UNLOCK</span><h2>解锁账本</h2><label>访问口令<input name="secret" v-model="secret" type="password" autofocus @keyup.enter="unlock" /></label><button class="primary full" :disabled="session.busy" @click="unlock">{{ session.busy ? '正在解锁…' : '解锁账本' }}</button></template>
      <template v-else-if="dialog === 'import'"><span class="eyebrow">IMPORT</span><h2>导入加密账本</h2><label class="file-drop-zone" :class="{ dragging: importDragging }" @dragenter.prevent="importDragging = true" @dragover.prevent="importDragging = true" @dragleave.prevent="importDragging = false" @drop.prevent="dropImportFile"><input name="ledger-import-file" class="file-input" type="file" accept=".rwbl" @change="selectImportFile(($event.target as HTMLInputElement).files?.[0])" /><span class="file-icon">⇧</span><strong>{{ importFile?.name || '拖拽 .rwbl 文件到这里' }}</strong><small>{{ importFile ? '点击可重新选择文件' : '或者点击浏览本机文件' }}</small></label><label>文件访问口令<input name="secret" v-model="secret" type="password" /></label><button class="primary full" :disabled="session.busy" @click="importLedger">验证并导入</button></template>
      <template v-else-if="dialog === 'import-conflict'"><span class="eyebrow">IMPORT CONFLICT</span><h2>账本已存在</h2><p class="modal-copy">“{{ importInfo?.displayName }}”{{ importInfo?.conflict === 'id' ? '与本机账本具有相同 ID。可作为独立副本导入，或用文件内容替换本机账本。替换前会自动下载并保留现有密文备份。' : '与本机账本同名。请作为独立副本导入。' }}</p><div class="modal-actions"><button class="ghost" @click="dialog = 'import'">返回</button><button class="primary" @click="completeImport('copy')">导入为副本</button><button v-if="importInfo?.conflict === 'id'" class="danger" @click="completeImport('replace')">备份并替换</button></div></template>
      <template v-else-if="dialog === 'change-passphrase'"><span class="eyebrow">CHANGE PASSPHRASE</span><h2>修改访问口令</h2><label>当前访问口令<input name="passphrase-form-old-secret" v-model="passphraseForm.oldSecret" type="password" autocomplete="current-password" autofocus /></label><label>新访问口令<input name="passphrase-form-new-secret" v-model="passphraseForm.newSecret" type="password" autocomplete="new-password" /></label><label>确认新口令<input name="passphrase-form-confirmation" v-model="passphraseForm.confirmation" type="password" autocomplete="new-password" @keyup.enter="changePassphrase" /></label><button class="primary full" :disabled="session.busy" @click="changePassphrase">重新封装数据密钥</button></template>
      <template v-else-if="dialog === 'security-migration'"><span class="eyebrow">ATOMIC MIGRATION</span><h2>修改加密方式</h2><p class="modal-copy">迁移会先生成并验证完整的新容器，成功后才覆盖当前版本；旧密文会进入上一版本恢复区。</p><label>KDF<select name="security-form-kdf" v-model="securityForm.kdf"><option value="PBKDF2-SHA-256">PBKDF2 · SHA-256 · 600,000 次</option><option value="PBKDF2-SHA-512">PBKDF2 · SHA-512 · 400,000 次</option></select></label><label>加密算法<select name="security-form-encryption" v-model="securityForm.encryption"><option value="AES-256-GCM">AES-256-GCM</option></select></label><label>当前访问口令<input name="security-form-secret" v-model="securityForm.secret" type="password" autocomplete="current-password" @keyup.enter="migrateSecurity" /></label><button class="primary full" :disabled="session.busy" @click="migrateSecurity">验证并原子迁移</button></template>
      <template v-else-if="dialog === 'restore-recovery'"><span class="eyebrow">RECOVERY</span><h2>恢复上一版密文</h2><p class="modal-copy">恢复会交换当前版本与上一版本，因此仍可再次回退。请输入上一版本对应的访问口令。</p><label>上一版本访问口令<input name="recovery-secret" v-model="recoverySecret" type="password" autofocus @keyup.enter="restoreRecovery" /></label><button class="primary full" :disabled="session.busy" @click="restoreRecovery">验证并恢复</button></template>
      <template v-else-if="dialog === 'rename-name'"><span class="eyebrow">RENAME · 1 / 2</span><h2>修改账本名称</h2><p class="modal-copy">输入新的账本名称。下一步将验证当前访问口令。</p><label>新账本名称<input name="rename-form-name" v-model="renameForm.name" autofocus @keyup.enter="continueRename" /></label><button class="primary full" @click="continueRename">修改</button></template>
      <template v-else-if="dialog === 'rename-secret'"><span class="eyebrow">RENAME · 2 / 2</span><h2>确认修改</h2><div class="rename-preview"><small>账本将重命名为</small><strong>{{ renameForm.name }}</strong></div><label>当前访问口令<input name="rename-form-secret" v-model="renameForm.secret" type="password" autofocus @keyup.enter="renameLedger" /></label><div class="modal-actions"><button class="ghost" @click="dialog = 'rename-name'">返回</button><button class="primary" :disabled="session.busy" @click="renameLedger">{{ session.busy ? '正在保存…' : '确认修改' }}</button></div></template>
      <template v-else-if="dialog === 'delete'"><span class="eyebrow">DELETE LEDGER</span><h2>删除“{{ deleteForm.name }}”</h2><p class="modal-copy">此操作会永久删除本机账本索引和加密容器，无法从应用内恢复。你可以先下载完整的 `.rwbl` 密文备份。</p><button class="ghost full" :disabled="session.busy" @click="backupDeleteTarget">↓ 先导出密文备份</button><label>账本访问口令<input name="delete-form-secret" v-model="deleteForm.secret" type="password" autocomplete="current-password" /></label><label class="delete-confirm"><input name="delete-form-confirmed" v-model="deleteForm.confirmed" type="checkbox" />我理解删除后无法恢复</label><button class="danger full" :disabled="session.busy || !deleteForm.confirmed" @click="deleteLedgerConfirmed">{{ session.busy ? '正在验证…' : '永久删除账本' }}</button></template>
      <template v-else-if="dialog === 'account-create'"><span class="eyebrow">NEW ACCOUNT</span><h2>添加账户</h2><div class="form-grid"><label>账户名称<input name="account-form-name" v-model="accountForm.name" placeholder="例如：日常银行卡" /></label><label class="checkbox"><input name="account-form-pending" v-model="accountForm.pending" type="checkbox" />设为待支出账户</label><label v-for="currency in currencies" :key="currency">{{ currency }} 初始金额<input name="account-form-initial-currency" v-model="accountForm.initial[currency]" type="number" min="0" :max="currencyRules[currency].maxMinorUnits / 10 ** currencyRules[currency].fractionDigits" :step="10 ** -currencyRules[currency].fractionDigits" /></label></div><button class="primary" :disabled="session.busy" @click="createAccount">保存账户</button></template>
      <template v-else-if="dialog === 'account-edit'"><span class="eyebrow">EDIT ACCOUNT</span><h2>编辑账户</h2><label>账户名称<input name="account-edit-form-name" v-model="accountEditForm.name" autofocus /></label><label class="delete-confirm"><input name="account-edit-form-pending" v-model="accountEditForm.pending" type="checkbox" />设置为待支出账户</label><p class="modal-copy">修改余额分类不会产生资金账目；初始金额创建后不可直接修改。</p><button class="primary full" :disabled="session.busy" @click="saveAccountEdit">保存修改</button></template>
      <template v-else-if="dialog === 'account-delete'"><span class="eyebrow">DELETE ACCOUNT</span><h2>删除“{{ accountDeleteTarget?.name }}”</h2><p class="modal-copy">确认后账户将被逻辑删除，并为以下四个币种分别生成系统支出记录；零余额也会保留 0 金额记录。</p><div class="impact-list"><div v-for="currency in currencies" :key="currency"><span>{{ currency }}</span><strong>{{ formatMinorUnits(balances[accountDeleteTargetId]?.[currency] ?? 0, currency) }}</strong></div></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="danger" :disabled="session.busy" @click="confirmAccountDelete">确认删除账户</button></div></template>
      <template v-else-if="dialog === 'tag-edit'">
        <span class="eyebrow">EDIT TAG</span><h2>修改标签</h2>
        <label>标签名称<input name="tag-edit-name" v-model="parentEdit.name" maxlength="80" autofocus /></label>
        <label>新的父标签<select name="parent-edit-id" v-model="parentEdit.parentId"><option value="">根标签（无父级）</option><option v-for="tag in validParentChoices(parentEdit.tagId)" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select></label>
        <p class="modal-copy">重命名不会改变历史账目引用；显示名称即使规范化后与原名称相同，也可以保存。</p>
        <template v-if="tagParentChanged"><p class="modal-copy">父级改变后，将重新计算 {{ parentImpact.count }} 条记录（包括历史和已删除记录）的祖先标签。直接选择、主标签、记账日期、资金流水均不改变。</p><div class="hierarchy-warning"><strong>包含标签统计变化（全部有效支出）</strong><p v-if="!parentImpact.rows.length">统计金额不变；主标签精确统计始终不变。</p><p v-for="row in parentImpact.rows" :key="row.tagId + row.currency">{{ tagNameOf(row.tagId) }}：{{ row.amount > 0 ? '+' : '' }}{{ formatMinorUnits(row.amount, row.currency) }}</p><p v-if="parentImpact.error">{{ parentImpact.error }}</p></div><label class="delete-confirm"><input name="parent-edit-confirmed" type="checkbox" v-model="parentEdit.confirmed" />我已确认父级变更影响</label></template>
        <div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="session.busy || !parentEdit.name.trim() || (tagParentChanged && !parentEdit.confirmed) || Boolean(parentImpact.error)" @click="saveTagEdit">保存修改</button></div>
      </template>
      <template v-else-if="dialog === 'tag-delete-warning'"><span class="eyebrow">TAG IN USE</span><h2>“{{ tagDeleteTarget?.name }}”仍被使用</h2><p class="modal-copy">该标签被 {{ tagDeleteReferences.length }} 条记录直接引用（包括历史及已删除记录），无法直接删除。继续后需要逐条移除或批量替换，所有调整会在最终确认时一次性写入。</p><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" @click="beginTagResolution">继续处理</button></div></template>
      <template v-else-if="dialog === 'tag-delete-resolve'"><span class="eyebrow">RESOLVE REFERENCES</span><h2>处理“{{ tagDeleteTarget?.name }}”的关联账目</h2><section class="bulk-replace"><strong>批量替换</strong><div class="resolution-controls"><select name="bulk-replacement-tag-id" v-model="bulkReplacementTagId"><option value="">选择已有标签</option><option v-for="tag in ledger?.tags.filter(item => item.id !== tagDeleteTargetId)" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select><input name="bulk-replacement-tag-name" v-model="bulkReplacementTagName" :disabled="Boolean(bulkReplacementTagId)" placeholder="或输入新标签" /><button class="ghost" @click="applyBulkTagReplacement">应用到已选</button></div></section><div class="reference-list"><article v-for="tx in tagDeleteReferences" :key="tx.id"><input name="bulk-selected-transaction-ids" v-model="bulkSelectedTransactionIds" type="checkbox" :value="tx.id" :aria-label="`选择 ${transactionTitle(tx)}`" /><div><strong>{{ transactionTitle(tx) }}</strong><small>{{ tx.bookedAt }} · {{ transactionAmount(tx) }} · {{ auditRole(tx.recordRole) }}</small></div><select name="tag-resolution-drafts-tx-id-action" v-model="tagResolutionDrafts[tx.id]!.action" :disabled="tx.primaryTagId === tagDeleteTargetId"><option value="remove">直接移除</option><option value="replace">替换为</option></select><template v-if="tagResolutionDrafts[tx.id]!.action === 'replace'"><select name="tag-resolution-drafts-tx-id-replacement-tag-id" v-model="tagResolutionDrafts[tx.id]!.replacementTagId"><option value="">选择已有标签</option><option v-for="tag in ledger?.tags.filter(item => item.id !== tagDeleteTargetId)" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select><input name="tag-resolution-drafts-tx-id-replacement-tag-name" v-model="tagResolutionDrafts[tx.id]!.replacementTagName" :disabled="Boolean(tagResolutionDrafts[tx.id]!.replacementTagId)" placeholder="或新建标签" /></template><span v-else class="resolution-ok">将移除</span></article></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="!tagResolutionsComplete" @click="dialog = 'tag-delete-confirm'">预览完成，继续</button></div></template>
      <template v-else-if="dialog === 'tag-delete-confirm'"><span class="eyebrow">FINAL CONFIRMATION</span><h2>确认删除“{{ tagDeleteTarget?.name }}”</h2><p class="modal-copy">{{ tagDeleteReferences.length ? `将原子更新 ${tagDeleteReferences.length} 条关联账目，然后删除标签。` : '该标签没有直接账目引用；如有子标签，请指定它们的去向。' }}</p><div v-if="tagDeleteChildren.length" class="hierarchy-warning"><p>保留 {{ tagDeleteChildren.map(tag => tag.name).join('、') }} 及所有后代，不级联删除。</p><label>子标签去向<select name="child-disposition-mode" v-model="childDisposition.mode"><option value="" disabled>请选择</option><option value="promote">提升到原父级（{{ parentNameOf(tagDeleteTarget?.parentId) }}）</option><option value="move">移动到其他父级</option></select></label><label v-if="childDisposition.mode === 'move'">目标父级<select name="child-disposition-parent" v-model="childDisposition.parentId"><option value="">根标签（无父级）</option><option v-for="tag in validParentChoices(tagDeleteTargetId)" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></select></label></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="danger" :disabled="session.busy || (tagDeleteChildren.length > 0 && !childDisposition.mode)" @click="confirmTagDelete">确认删除</button></div></template>
      <template v-else-if="dialog === 'transaction-delete'"><span class="eyebrow">DELETE TRANSACTION</span><h2>删除这笔账目？</h2><p class="modal-copy">系统不会移除原始记录，而会新增一条资金流向相反的冲销记录，并将两条记录关联。</p><div v-if="transactionDeleteTarget" class="rename-preview"><small>{{ transactionDeleteTarget.bookedAt }} · {{ transactionTitle(transactionDeleteTarget) }}</small><strong>{{ transactionAmount(transactionDeleteTarget) }}</strong></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="danger" :disabled="session.busy" @click="confirmTransactionDelete">确认删除账目</button></div></template>
      <template v-else-if="dialog === 'transaction-tags'"><span class="eyebrow">EDIT TAGS</span><h2>修改账目标签</h2><p class="modal-copy">单击切换选中状态，双击设为主标签。本操作只更新标签，不新增资金流水。</p><TagSelection :tags="ledger?.tags ?? []" v-model:selected="transactionTagIds" v-model:primary="transactionPrimaryTagId" /><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="session.busy || !transactionTagIds.length || !transactionPrimaryTagId" @click="saveTransactionTags">保存标签</button></div></template>
      <template v-else-if="dialog === 'transaction-correct'"><span class="eyebrow">CORRECTION GROUP</span><h2>更正账目资金数据</h2><p class="modal-copy">保存后将原子追加“反向原值＋更正后新值”两条同组记录；首次记账日期保持为 {{ correctionForm.bookedAt }}。</p><div class="form-grid correction-form"><label>类型<select name="correction-form-kind" v-model="correctionForm.kind"><option value="expense">支出</option><option value="income">收入</option><option value="transfer">转移</option></select></label><label>首次记账日期<input name="correction-form-booked-at" v-model="correctionForm.bookedAt" type="date" disabled /></label><div v-if="correctionForm.kind!=='income'" class="picker-field entry-source-account"><span>支出账户</span><AccountPicker v-model="correctionForm.sourceAccountId" :accounts="activeAccounts" placeholder="选择支出账户" search-placeholder="搜索支出账户" /></div><label v-if="correctionForm.kind!=='income'">支出金额<div class="money-input"><input name="correction-form-source-amount" v-model="correctionForm.sourceAmount" type="number" min="0" /><select name="correction-form-source-currency" v-model="correctionForm.sourceCurrency"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></div></label><div v-if="correctionForm.kind!=='expense'" class="picker-field entry-destination-account"><span>收入账户</span><AccountPicker v-model="correctionForm.destinationAccountId" :accounts="activeAccounts" placeholder="选择收入账户" search-placeholder="搜索收入账户" /></div><label v-if="correctionForm.kind!=='expense'">收入金额<div class="money-input"><input name="correction-form-destination-amount" v-model="correctionForm.destinationAmount" type="number" min="0" /><select name="correction-form-destination-currency" v-model="correctionForm.destinationCurrency"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></div></label><label class="wide">备注<input name="correction-form-note" v-model="correctionForm.note" maxlength="240" /></label></div><div v-if="correctionForm.kind==='expense'" class="tag-picker"><span>支出标签</span><TagSelection :tags="ledger?.tags ?? []" v-model:selected="correctionForm.selectedTagIds" v-model:primary="correctionForm.primaryTagId" /></div><div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="session.busy" @click="saveTransactionCorrection">保存更正</button></div></template>
      <template v-else-if="dialog === 'audit-chain'"><span class="eyebrow">AUDIT TRAIL</span><h2>完整审计记录链</h2><p class="modal-copy">按产生时间从新到旧排列。业务日期始终显示该笔账目的首次记账日期。</p><div class="audit-chain"><article v-for="entry in auditChain" :key="entry.id"><span class="pill">{{ auditRole(entry.recordRole) }}</span><div><strong>{{ transactionTitle(entry) }}</strong><small>业务日期 {{ entry.bookedAt }} · 记录时间 {{ new Date(entry.createdAt).toLocaleString('zh-CN') }}</small><small v-if="entry.operationGroupId">更正组 {{ entry.operationGroupId.slice(0,8) }}</small></div><b>{{ transactionAmount(entry) }}</b></article></div><button class="ghost full" @click="closeDialog">关闭</button></template>
      <template v-else-if="dialog === 'theme'">
        <span class="eyebrow">THEME COMPASS</span><h2>选择主题颜色</h2>
        <p class="modal-copy">主色和副色都可在 360° 色环上自由选择。拖动指针、输入数值或使用微调按钮，界面会即时预览。</p>
        <div class="hue-channel-tabs" role="tablist" aria-label="选择要调整的颜色">
          <button :class="{ selected: themeChannel === 'primary' }" role="tab" :aria-selected="themeChannel === 'primary'" @click="themeChannel = 'primary'"><i :style="{ '--preview-color': themeColor('primary', previewPrimaryHue) }"></i><span>主题色<strong>{{ previewPrimaryHue }}°</strong></span></button>
          <button :class="{ selected: themeChannel === 'secondary' }" role="tab" :aria-selected="themeChannel === 'secondary'" @click="themeChannel = 'secondary'"><i :style="{ '--preview-color': themeColor('secondary', previewSecondaryHue) }"></i><span>副主题色<strong>{{ previewSecondaryHue }}°</strong></span></button>
        </div>
        <div class="hue-workbench">
          <div class="hue-ring" :class="`hue-ring-${activeColorTone}`" :style="{ '--selected-hue': `${selectedHue}` }" role="slider" aria-label="色相环" aria-valuemin="0" aria-valuemax="359" :aria-valuenow="selectedHue" tabindex="0" @pointerdown="startHueDrag" @pointermove="moveHueDrag" @pointerup="stopHueDrag" @pointercancel="stopHueDrag">
            <div class="hue-ring-dial">
              <div class="hue-ring-dial-base"></div>
              <img :src="compassDialUrl" alt="" />
              <div class="hue-ring-dial-color"></div>
            </div>
            <ThemeCompassHand channel="secondary" :hue="previewSecondaryHue" :selected="themeChannel === 'secondary'" />
            <ThemeCompassHand channel="primary" :hue="previewPrimaryHue" :selected="themeChannel === 'primary'" />
          </div>
          <div class="hue-options">
            <label>色相角度<input name="selected-hue" v-model.number="selectedHue" type="number" min="0" max="359" /></label>
            <div class="hue-adjustments"><button v-for="delta in [-60,-15,-1,1,15,60]" :key="delta" class="ghost" @click="adjustHue(delta)">{{ delta > 0 ? '+' : '' }}{{ delta }}</button></div>
            <div class="hue-palette" aria-label="快捷色相"><button v-for="hue in huePalette" :key="hue" :class="{ selected: selectedHue === hue }" :style="{ '--preview-color': previewThemeColor(hue, activeColorTone) }" :aria-label="`选择 ${hue} 度色相`" @click="selectedHue = hue"></button></div>
          </div>
        </div>
        <div class="modal-actions"><button class="ghost" @click="closeDialog">取消</button><button class="primary" :disabled="session.busy" @click="saveTheme">保存到当前账本</button></div>
      </template>
      <template v-else-if="dialog === 'transaction-entry'">
        <span class="eyebrow">BATCH ENTRY</span><div class="section-title"><h2>批量添加账目</h2><span class="pill">待提交 {{ pendingDrafts.length }} 笔</span></div>
        <div class="form-grid transaction-form">
          <label class="entry-type">类型<select name="draft-form-kind" v-model="draftForm.kind"><option value="expense">支出</option><option value="income">收入</option><option value="transfer">转移</option></select></label>
          <label class="entry-date">日期<input name="draft-form-booked-at" v-model="draftForm.bookedAt" type="date" /></label>
          <div v-if="draftForm.kind !== 'income'" class="picker-field"><span>支出账户</span><AccountPicker v-model="draftForm.sourceAccountId" :accounts="activeAccounts" placeholder="选择支出账户" search-placeholder="搜索支出账户" /></div>
          <label v-if="draftForm.kind !== 'income'" class="entry-source-amount">支出金额<div class="money-input"><input name="draft-form-source-amount" v-model="draftForm.sourceAmount" type="number" min="0" :max="currencyRules[draftForm.sourceCurrency].maxMinorUnits / 10 ** currencyRules[draftForm.sourceCurrency].fractionDigits" :step="10 ** -currencyRules[draftForm.sourceCurrency].fractionDigits" @input="syncTransferAmount('source')" /><select name="draft-form-source-currency" v-model="draftForm.sourceCurrency" @change="syncTransferAmount('source')"><option v-for="c in currencies" :key="c">{{ c }}</option></select></div></label>
          <div v-if="draftForm.kind !== 'expense'" class="picker-field"><span>收入账户</span><AccountPicker v-model="draftForm.destinationAccountId" :accounts="activeAccounts" placeholder="选择收入账户" search-placeholder="搜索收入账户" /></div>
          <label v-if="draftForm.kind !== 'expense'" class="entry-destination-amount">收入金额<div class="money-input"><input name="draft-form-destination-amount" v-model="draftForm.destinationAmount" type="number" min="0" :max="currencyRules[draftForm.destinationCurrency].maxMinorUnits / 10 ** currencyRules[draftForm.destinationCurrency].fractionDigits" :step="10 ** -currencyRules[draftForm.destinationCurrency].fractionDigits" @input="syncTransferAmount('destination')" /><select name="draft-form-destination-currency" v-model="draftForm.destinationCurrency" @change="syncTransferAmount('destination')"><option v-for="c in currencies" :key="c">{{ c }}</option></select></div></label>
          <label class="wide">备注<input name="draft-form-note" v-model="draftForm.note" maxlength="240" placeholder="可选" /><small>{{ draftForm.note.length }} / 240</small></label>
        </div>
        <p v-if="impliedExchangeRate" class="exchange-rate">推导汇率：{{ impliedExchangeRate }}</p>
        <div v-if="draftForm.kind === 'expense'" class="tag-picker">
          <span>已确认标签</span>
          <div class="tag-cloud"><button v-for="tagId in expandTagAncestors(pickerTags, draftForm.selectedTagIds)" :key="tagId" class="tag" :class="{ primaryTag: draftForm.primaryTagId === tagId }" @click="openTagPicker">{{ pickerTags.find(tag => tag.id === tagId)?.name }} <small v-if="!draftForm.selectedTagIds.includes(tagId)">由子标签带入</small> <b v-if="draftForm.primaryTagId === tagId">主</b></button><button class="ghost small" @click="openTagPicker">{{ draftForm.selectedTagIds.length ? '修改标签' : '选择标签' }}</button></div>
          <PickerDialog :open="tagPickerOpen && dialog === 'transaction-entry'" title="选择标签" @close="cancelTagPicker">
            <div class="collapse-content"><section class="tag-picker-panel"><div class="inline-form"><input name="tag-picker-search" v-model="tagPickerSearch" placeholder="筛选标签，回车选择或新建" @keyup.enter="selectOrCreateTagFromSearch" /><button class="ghost" @click="selectOrCreateTagFromSearch">选择 / 新建</button></div><label>新建标签的父级<select name="pending-parent-id" v-model="pendingParentId"><option value="">根标签（无父级）</option><option v-for="tag in pickerTags" :key="tag.id" :value="tag.id">{{ tagPath(pickerTags, tag.id) }}</option></select></label><TagSelection :tags="pickerTags" :search="tagPickerSearch" v-model:selected="tagPickerSelectedIds" v-model:primary="tagPickerPrimaryId" /><div class="modal-actions"><button class="ghost" @click="cancelTagPicker">取消</button><button class="primary" @click="confirmTagPicker">确认</button></div></section></div>
          </PickerDialog>
        </div>
        <div class="actions"><button class="ghost" @click="addPendingDraft">加入待提交列表</button><button class="ghost" :disabled="!pendingDrafts.length || session.busy" @click="commitDrafts">提交暂存</button><button class="primary" :disabled="(!pendingDrafts.length && !hasUnsavedTransactionInput) || session.busy" @click="commitAllDrafts">直接提交</button></div>
        <div v-if="pendingDrafts.length" class="pending-list"><div v-for="(draft, index) in pendingDrafts" :key="index"><span>{{ index + 1 }}. {{ { income:'收入', expense:'支出', transfer:'转移' }[draft.kind] }} · {{ draft.bookedAt }}</span><span class="pending-actions"><button @click="copyPendingDraft(index)">复制</button><button @click="removePendingDraft(index)">移除</button></span></div></div>
      </template>
      <template v-else-if="dialog === 'discard-entry'"><span class="eyebrow">UNSAVED CHANGES</span><h2>放弃未保存的账目？</h2><p class="modal-copy">当前填写内容和待提交列表都将被清空。</p><div class="modal-actions"><button class="ghost" @click="dialog = 'transaction-entry'">继续编辑</button><button class="danger" @click="discardTransactionEntry">放弃修改</button></div></template>
      </div></Transition>
    </section>
  </div>
  </Transition>
  <PickerDialog :open="Boolean(session.migration)" title="升级账本以支持子标签" @close="session.confirmMigration(false)">
    <p class="modal-copy">“{{ session.migration?.migrationInfo?.name }}”包含 {{ session.migration?.migrationInfo?.tags }} 个标签、{{ session.migration?.migrationInfo?.transactions }} 条记录。现有标签全部成为根标签，金额、主标签及选择顺序不变。</p>
    <p class="hierarchy-warning">升级到数据格式 v2 后，旧版客户端将无法打开。确认前不会写入任何数据；升级成功时会原子保存旧密文备份。请同时下载一份，以便回退。</p>
    <button class="ghost full" @click="session.exportMigrationPreview">导出旧版 .rwbl 备份</button>
    <div class="modal-actions"><button class="ghost" @click="session.confirmMigration(false)">取消升级</button><button class="primary" @click="session.confirmMigration(true)">确认升级</button></div>
  </PickerDialog>
  <TransitionGroup name="toast" tag="div" class="toast-stack" aria-live="polite" aria-atomic="false">
    <article v-if="pwaUpdateReady" key="pwa-update" class="toast-message toast-warning pwa-update-message">
      <span class="toast-symbol">↻</span><p><strong>新版本已准备就绪</strong><small>立即载入以使用最新版本。</small></p><button class="pwa-update-button" :disabled="pwaUpdateInstalling" @click="loadPwaUpdate">{{ pwaUpdateInstalling ? '正在载入…' : '立即载入' }}</button>
    </article>
    <article v-for="toast in toasts.slice(pwaUpdateReady ? -4 : -5)" :key="toast.id" class="toast-message" :class="`toast-${toast.type}`">
      <span class="toast-symbol">{{ toast.type === 'success' ? '✓' : toast.type === 'warning' ? '!' : '×' }}</span><p>{{ toast.message }}</p><button :aria-label="`关闭提示：${toast.message}`" @click="dismissToast(toast.id)">×</button>
    </article>
  </TransitionGroup>
</template>
