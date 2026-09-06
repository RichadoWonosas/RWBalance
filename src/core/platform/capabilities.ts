export interface PlatformCapabilities {
  worker: boolean
  webCrypto: boolean
  webAssembly: boolean
  indexedDb: boolean
  compression: boolean
}

export function detectPlatformCapabilities(): PlatformCapabilities {
  return {
    worker: typeof Worker !== 'undefined',
    webCrypto: typeof crypto !== 'undefined' && Boolean(crypto.subtle) && typeof crypto.randomUUID === 'function',
    webAssembly: typeof WebAssembly !== 'undefined',
    indexedDb: typeof indexedDB !== 'undefined',
    compression: typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined',
  }
}

export function blockingCapabilityMessages(value: PlatformCapabilities): string[] {
  const messages: string[] = []
  if (!value.worker) messages.push('Web Worker')
  if (!value.webCrypto) messages.push('Web Crypto')
  if (!value.indexedDb) messages.push('IndexedDB')
  if (!value.compression) messages.push('CompressionStream')
  return messages
}
