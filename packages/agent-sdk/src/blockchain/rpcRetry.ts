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
const RESPONSE_TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])
const RESPONSE_TIMEOUT_NAMES = new Set(['AbortError', 'TimeoutError'])

type Failure = { name?: unknown; cause?: { status?: unknown; code?: unknown } }

function isResponseTimeout(error: unknown): boolean {
  const { name, cause } = (error ?? {}) as Failure
  if (typeof name === 'string' && RESPONSE_TIMEOUT_NAMES.has(name)) return true
  return typeof cause?.code === 'string' && RESPONSE_TIMEOUT_CODES.has(cause.code)
}

export function isTransportFailure(error: unknown): boolean {
  if (isResponseTimeout(error)) return true
  const cause = ((error ?? {}) as Failure).cause
  if (typeof cause?.status === 'number') return cause.status >= 500
  return typeof cause?.code === 'string' && TRANSPORT_ERROR_CODES.has(cause.code)
}

export async function withTransportRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call()
    } catch (error) {
      if (attempt >= ATTEMPTS || isResponseTimeout(error) || !isTransportFailure(error)) throw error
      await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS * 2 ** (attempt - 1)))
    }
  }
}
