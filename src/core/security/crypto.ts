import type { Ledger } from '../domain/types'
import { decodeAppearance, defaultTheme, encodeAppearance, normalizeHue } from '../domain/theme'

export type KdfId = 'PBKDF2-SHA-256' | 'PBKDF2-SHA-512'
export type EncryptionId = 'AES-256-GCM'
export type CompressionId = 'deflate' | 'identity'
export type SerializationId = 'json-v1'
export interface SecurityAlgorithms { kdf: KdfId; encryption: EncryptionId; compression: CompressionId; serialization: SerializationId }

interface LegacyEncryptedLedgerContainer {
  format: 'rwbalance-ledger'; version: 1; ledgerId: string
  kdf: { id: 'PBKDF2-SHA-256'; salt: string; iterations: number }
  encryption: { id: 'AES-256-GCM'; iv: string }
  appearance?: string; ciphertext: string
}
export interface CurrentEncryptedLedgerContainer {
  format: 'rwbalance-ledger'; version: 2; ledgerId: string
  kdf: { id: KdfId; salt: string; iterations: number }
  encryption: { id: EncryptionId; bodyIv: string; keyIv: string; wrappedKey: string }
  compression: { id: CompressionId }; serialization: { id: SerializationId }
  appearance: string; ciphertext: string
}
export type EncryptedLedgerContainer = LegacyEncryptedLedgerContainer | CurrentEncryptedLedgerContainer
export interface OpenLedgerResult { ledger: Ledger; dataKey: Uint8Array<ArrayBuffer>; algorithms: SecurityAlgorithms; container: EncryptedLedgerContainer }

export const securityRegistry = {
  kdf: {
    'PBKDF2-SHA-256': { label: 'PBKDF2 · SHA-256', hash: 'SHA-256', iterations: 600_000 },
    'PBKDF2-SHA-512': { label: 'PBKDF2 · SHA-512', hash: 'SHA-512', iterations: 400_000 },
  },
  encryption: { 'AES-256-GCM': { label: 'AES-256-GCM' } },
  compression: { deflate: { label: 'Deflate' }, identity: { label: '不压缩（兼容模式）' } },
  serialization: { 'json-v1': { label: 'JSON v1' } },
} as const
export const defaultSecurityAlgorithms: SecurityAlgorithms = { kdf: 'PBKDF2-SHA-256', encryption: 'AES-256-GCM', compression: 'deflate', serialization: 'json-v1' }
export const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary) }
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> { const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes }
function algorithmsOf(container: EncryptedLedgerContainer): SecurityAlgorithms {
  if (container.version === 1) return { ...defaultSecurityAlgorithms }
  return { kdf: container.kdf.id, encryption: container.encryption.id, compression: container.compression.id, serialization: container.serialization.id }
}
function assertSupported(algorithms: SecurityAlgorithms): void {
  if (!securityRegistry.kdf[algorithms.kdf] || !securityRegistry.encryption[algorithms.encryption] || !securityRegistry.compression[algorithms.compression] || !securityRegistry.serialization[algorithms.serialization]) throw new Error('账本使用了当前版本不支持的算法')
}
async function deriveKek(passphrase: string, id: KdfId, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: securityRegistry.kdf[id].hash, salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
async function importDataKey(key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> { return crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']) }
async function compress(value: Uint8Array<ArrayBuffer>, id: CompressionId): Promise<Uint8Array<ArrayBuffer>> {
  if (id === 'identity') return value
  if (!('CompressionStream' in globalThis)) throw new Error('当前浏览器不支持 Deflate 压缩')
  return new Uint8Array(await new Response(new Blob([value.buffer]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
}
async function decompress(value: Uint8Array<ArrayBuffer>, id: CompressionId): Promise<Uint8Array<ArrayBuffer>> {
  if (id === 'identity') { if (value.byteLength > MAX_DECOMPRESSED_BYTES) throw new Error('账本解压后体积超过 64 MiB 安全上限'); return value }
  if (!('DecompressionStream' in globalThis)) throw new Error('当前浏览器不支持 Deflate 解压')
  const reader = new Blob([value.buffer]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  const chunks: Uint8Array[] = []; let total = 0
  while (true) { const { done, value: chunk } = await reader.read(); if (done) break; total += chunk.byteLength; if (total > MAX_DECOMPRESSED_BYTES) { await reader.cancel(); throw new Error('账本解压后体积超过 64 MiB 安全上限') }; chunks.push(chunk) }
  const result = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
}
function withoutAppearance(ledger: Ledger): Ledger { const { primaryHue: _p, secondaryHue: _s, colorTone: _c, theme: _t, ...settings } = ledger.settings; return { ...ledger, settings } }
function restoreAppearance(ledger: Ledger, value?: string): Ledger {
  const appearance = value === undefined ? { primaryHue: normalizeHue(ledger.settings.primaryHue, defaultTheme.primaryHue), secondaryHue: normalizeHue(ledger.settings.secondaryHue, defaultTheme.secondaryHue), colorTone: ledger.settings.colorTone === 'dark' ? 'dark' as const : 'light' as const } : decodeAppearance(value)
  ledger.settings = { ...ledger.settings, ...appearance }; return ledger
}
function bodyAad(container: Pick<CurrentEncryptedLedgerContainer, 'ledgerId' | 'appearance' | 'encryption' | 'compression' | 'serialization'>): Uint8Array<ArrayBuffer> { return encoder.encode(`rwbalance:2:body:${container.ledgerId}:${container.appearance}:${container.encryption.id}:${container.compression.id}:${container.serialization.id}`) }
function wrapAad(ledgerId: string, kdfId: KdfId, encryptionId: EncryptionId): Uint8Array<ArrayBuffer> { return encoder.encode(`rwbalance:2:key:${ledgerId}:${kdfId}:${encryptionId}`) }
async function wrapDataKey(dataKey: Uint8Array<ArrayBuffer>, passphrase: string, ledgerId: string, algorithms: SecurityAlgorithms) {
  const salt = crypto.getRandomValues(new Uint8Array(16)); const keyIv = crypto.getRandomValues(new Uint8Array(12)); const parameters = securityRegistry.kdf[algorithms.kdf]
  const kek = await deriveKek(passphrase, algorithms.kdf, salt, parameters.iterations)
  const wrappedKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: keyIv, additionalData: wrapAad(ledgerId, algorithms.kdf, algorithms.encryption) }, kek, dataKey)
  return { salt, keyIv, wrappedKey: new Uint8Array(wrappedKey), iterations: parameters.iterations }
}
async function createCurrentContainer(ledger: Ledger, passphrase: string, algorithms: SecurityAlgorithms, suppliedDataKey?: Uint8Array<ArrayBuffer>): Promise<CurrentEncryptedLedgerContainer> {
  if (!passphrase) throw new Error('访问口令不能为空'); assertSupported(algorithms)
  const dataKey = suppliedDataKey ?? crypto.getRandomValues(new Uint8Array(32)); const bodyIv = crypto.getRandomValues(new Uint8Array(12)); const appearance = encodeAppearance(ledger.settings)
  const wrapped = await wrapDataKey(dataKey, passphrase, ledger.id, algorithms)
  const header = { ledgerId: ledger.id, appearance, encryption: { id: algorithms.encryption, bodyIv: bytesToBase64(bodyIv), keyIv: bytesToBase64(wrapped.keyIv), wrappedKey: bytesToBase64(wrapped.wrappedKey) }, compression: { id: algorithms.compression }, serialization: { id: algorithms.serialization } } satisfies Pick<CurrentEncryptedLedgerContainer, 'ledgerId' | 'appearance' | 'encryption' | 'compression' | 'serialization'>
  const plaintext = await compress(encoder.encode(JSON.stringify(withoutAppearance(ledger))), algorithms.compression)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bodyIv, additionalData: bodyAad(header) }, await importDataKey(dataKey), plaintext)
  return { format: 'rwbalance-ledger', version: 2, ...header, kdf: { id: algorithms.kdf, salt: bytesToBase64(wrapped.salt), iterations: wrapped.iterations }, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

export async function encryptLedger(ledger: Ledger, passphrase: string, options: { algorithms?: SecurityAlgorithms; dataKey?: Uint8Array<ArrayBuffer> } = {}): Promise<EncryptedLedgerContainer> { return createCurrentContainer(ledger, passphrase, options.algorithms ?? defaultSecurityAlgorithms, options.dataKey) }
async function openLegacy(container: LegacyEncryptedLedgerContainer, passphrase: string): Promise<OpenLedgerResult> {
  const key = await deriveKek(passphrase, 'PBKDF2-SHA-256', base64ToBytes(container.kdf.salt), container.kdf.iterations)
  const aad = container.appearance === undefined ? `rwbalance:1:${container.ledgerId}` : `rwbalance:1:${container.ledgerId}:${container.appearance}`
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(container.encryption.iv), additionalData: encoder.encode(aad) }, key, base64ToBytes(container.ciphertext))
  const ledger = JSON.parse(decoder.decode(await decompress(new Uint8Array(plaintext), 'deflate'))) as Ledger
  if (ledger.schemaVersion !== 1 && ledger.schemaVersion !== 2 && ledger.schemaVersion !== 3) throw new Error('不支持此账本数据版本，请更新客户端')
  if (ledger.id !== container.ledgerId) throw new Error('invalid')
  return { ledger: restoreAppearance(ledger, container.appearance), dataKey: crypto.getRandomValues(new Uint8Array(32)), algorithms: { ...defaultSecurityAlgorithms }, container }
}
async function openCurrent(container: CurrentEncryptedLedgerContainer, passphrase: string): Promise<OpenLedgerResult> {
  const algorithms = algorithmsOf(container); assertSupported(algorithms)
  const kek = await deriveKek(passphrase, container.kdf.id, base64ToBytes(container.kdf.salt), container.kdf.iterations)
  const rawDataKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(container.encryption.keyIv), additionalData: wrapAad(container.ledgerId, container.kdf.id, container.encryption.id) }, kek, base64ToBytes(container.encryption.wrappedKey))
  const dataKey = new Uint8Array(rawDataKey)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(container.encryption.bodyIv), additionalData: bodyAad(container) }, await importDataKey(dataKey), base64ToBytes(container.ciphertext))
  const ledger = JSON.parse(decoder.decode(await decompress(new Uint8Array(plaintext), container.compression.id))) as Ledger
  if (ledger.schemaVersion !== 1 && ledger.schemaVersion !== 2 && ledger.schemaVersion !== 3) throw new Error('不支持此账本数据版本，请更新客户端')
  if (ledger.id !== container.ledgerId) throw new Error('invalid')
  return { ledger: restoreAppearance(ledger, container.appearance), dataKey, algorithms, container }
}
export async function openLedger(container: EncryptedLedgerContainer, passphrase: string): Promise<OpenLedgerResult> {
  try { return container.version === 1 ? await openLegacy(container, passphrase) : await openCurrent(container, passphrase) }
  catch (cause) { if (cause instanceof Error && (cause.message.includes('64 MiB') || cause.message.includes('不支持'))) throw cause; throw new Error('口令错误、账本损坏或格式不受支持') }
}
export async function decryptLedger(container: EncryptedLedgerContainer, passphrase: string): Promise<Ledger> { return (await openLedger(container, passphrase)).ledger }
export async function rewrapContainer(container: EncryptedLedgerContainer, oldPassphrase: string, newPassphrase: string, kdf: KdfId): Promise<CurrentEncryptedLedgerContainer> {
  if (newPassphrase.length < 8) throw new Error('新访问口令至少需要 8 个字符')
  const opened = await openLedger(container, oldPassphrase)
  if (container.version === 1) return createCurrentContainer(opened.ledger, newPassphrase, { ...opened.algorithms, kdf }, opened.dataKey)
  const algorithms = { ...opened.algorithms, kdf }; const wrapped = await wrapDataKey(opened.dataKey, newPassphrase, container.ledgerId, algorithms)
  return { ...container, kdf: { id: kdf, salt: bytesToBase64(wrapped.salt), iterations: wrapped.iterations }, encryption: { ...container.encryption, keyIv: bytesToBase64(wrapped.keyIv), wrappedKey: bytesToBase64(wrapped.wrappedKey) } }
}
export function parseContainer(value: string): EncryptedLedgerContainer {
  let parsed: unknown; try { parsed = JSON.parse(value) } catch { throw new Error('不是有效的 RW Balance 账本文件') }
  if (!parsed || typeof parsed !== 'object') throw new Error('不是有效的 RW Balance 账本文件')
  const candidate = parsed as Partial<EncryptedLedgerContainer>
  if (candidate.format !== 'rwbalance-ledger' || (candidate.version !== 1 && candidate.version !== 2) || !candidate.ledgerId || !candidate.ciphertext) throw new Error('不是有效的 RW Balance 账本文件')
  if (candidate.version === 2) { const current = candidate as CurrentEncryptedLedgerContainer; if (!current.kdf?.id || !current.encryption?.wrappedKey || !current.encryption?.bodyIv || !current.encryption?.keyIv || !current.compression?.id || !current.serialization?.id || !current.appearance) throw new Error('不是有效的 RW Balance 账本文件'); assertSupported(algorithmsOf(current)) }
  return candidate as EncryptedLedgerContainer
}
export function containerAlgorithms(container: EncryptedLedgerContainer): SecurityAlgorithms { return algorithmsOf(container) }
