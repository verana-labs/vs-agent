import { tryParseDid } from '@credo-ts/core'

// Both method specs %3A-encode the port inside the host segment, colon-separate the path and, for
// did:webvh, put the SCID ahead of the host.
export function getDidWebHttpsBaseUrl(did: string): string | undefined {
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

  let host: string
  try {
    host = decodeURIComponent(encodedHost)
  } catch {
    return undefined
  }

  const path = pathSegments.length ? `/${pathSegments.join('/')}` : ''
  let url: URL
  try {
    url = new URL(`https://${host}${path}`)
  } catch {
    return undefined
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) return undefined
  if (url.pathname !== (path || '/')) return undefined

  return `https://${url.host}${path}`
}
