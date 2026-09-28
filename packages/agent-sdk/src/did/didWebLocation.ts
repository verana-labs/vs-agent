import { tryParseDid } from '@credo-ts/core'

export interface DidWebLocation {
  host: string
  path: string
}

// URL's parser strips C0 controls and whitespace and drops an empty port, so unless they are rejected
// before it runs, distinct DIDs collapse onto one https base.
const FORBIDDEN_IN_HOSTNAME = /[\s#/:?@[\\\]^|%]/

// Both method specs %3A-encode the port inside the host segment, colon-separate the path and, for
// did:webvh, put the SCID ahead of the host.
export function getDidWebLocation(did: string): DidWebLocation | undefined {
  const parsed = tryParseDid(did)
  if (!parsed || parsed.did !== did) return undefined

  const components = parsed.id.split(':')
  const segments =
    parsed.method === 'web'
      ? components
      : parsed.method === 'webvh' && components[0]
        ? components.slice(1)
        : []

  const [encodedHost, ...pathSegments] = segments
  if (!encodedHost || pathSegments.some(segment => segment.length === 0)) return undefined

  let decodedHost: string
  try {
    decodedHost = decodeURIComponent(encodedHost)
  } catch {
    return undefined
  }

  const portSeparator = decodedHost.lastIndexOf(':')
  const hostname = portSeparator === -1 ? decodedHost : decodedHost.slice(0, portSeparator)
  const port = portSeparator === -1 ? undefined : decodedHost.slice(portSeparator + 1)
  if (!hostname || hasControlCharacter(hostname) || FORBIDDEN_IN_HOSTNAME.test(hostname)) return undefined
  if (port !== undefined && !/^[0-9]+$/.test(port)) return undefined

  const path = pathSegments.length ? `/${pathSegments.join('/')}` : ''
  let url: URL
  try {
    url = new URL(`https://${hostname}${port === undefined ? '' : `:${port}`}${path}`)
  } catch {
    return undefined
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) return undefined
  if (url.pathname !== (path || '/')) return undefined

  return { host: url.host, path }
}

export function getDidWebHttpsBaseUrl(did: string): string | undefined {
  const location = getDidWebLocation(did)
  return location ? `https://${location.host}${location.path}` : undefined
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}
