import { createHash } from 'crypto'

const BOUNDED_TIMEOUT_MS = 5_000

/** The `sha384-` subresource integrity metadata of the given bytes. */
export function digestOfBytes(content: string | Uint8Array): string {
  return `sha384-${createHash('sha384').update(content).digest('base64')}`
}

/**
 * Reads the bytes a URL serves under the network boundary the spec puts on step 3 of the trust
 * decision: `https` only, no redirect, and an answer within five seconds. The address ban of that
 * boundary is not enforced yet (#754).
 */
export async function fetchBoundedBytes(
  url: string,
  timeoutMs: number = BOUNDED_TIMEOUT_MS,
): Promise<Uint8Array> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new Error(`${url} is not an absolute URL`)
  }
  if (target.protocol !== 'https:') {
    throw new Error(`${url} does not use https, which this boundary requires`)
  }

  const response = await fetch(target.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new Error(`${url} answered with a redirect, which this boundary does not follow`)
  }
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`)
  }

  return new Uint8Array(await response.arrayBuffer())
}

/**
 * The `sha384-` integrity metadata of the bytes a URL serves, read with {@link fetchBoundedBytes}.
 * The digest covers the bytes on the wire, never a re-encoding of the decoded document.
 */
export async function digestOfBoundedUri(url: string, timeoutMs?: number): Promise<string> {
  return digestOfBytes(await fetchBoundedBytes(url, timeoutMs))
}
