const ATTEMPTS = 4
const BASE_DELAY_MS = 500
const TRANSPORT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
])

export function isTransportFailure(error: unknown): boolean {
  const cause = (error as { cause?: { status?: unknown; code?: unknown } } | undefined)?.cause
  if (typeof cause?.status === 'number') return cause.status >= 500
  return typeof cause?.code === 'string' && TRANSPORT_ERROR_CODES.has(cause.code)
}

export async function withTransportRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call()
    } catch (error) {
      if (attempt >= ATTEMPTS || !isTransportFailure(error)) throw error
      await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS * 2 ** (attempt - 1)))
    }
  }
}
