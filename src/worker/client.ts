import type { LedgerWorkerCommand, LedgerWorkerRequest, LedgerWorkerResponse, LedgerWorkerResult } from './protocol'

export interface LedgerWorkerClient {
  request(command: LedgerWorkerCommand): Promise<LedgerWorkerResult>
  terminate(): void
}

export function createLedgerWorkerClient(): LedgerWorkerClient {
  const worker = new Worker(new URL('./ledger.worker.ts', import.meta.url), { type: 'module', name: 'rw-balance-ledger' })
  const pending = new Map<number, { resolve: (result: LedgerWorkerResult) => void; reject: (error: Error) => void }>()
  let nextId = 1

  worker.onmessage = (event: MessageEvent<LedgerWorkerResponse>) => {
    const response = event.data
    const handler = pending.get(response.id)
    if (!handler) return
    pending.delete(response.id)
    if (response.ok) handler.resolve(response.result)
    else handler.reject(new Error(response.error))
  }
  worker.onerror = () => {
    for (const handler of pending.values()) handler.reject(new Error('账本数据 Worker 运行失败'))
    pending.clear()
  }

  return {
    request(command) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, command } satisfies LedgerWorkerRequest)
      })
    },
    terminate() {
      worker.terminate()
      for (const handler of pending.values()) handler.reject(new Error('账本会话已锁定'))
      pending.clear()
    },
  }
}
