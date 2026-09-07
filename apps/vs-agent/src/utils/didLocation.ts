export interface PublicDidLocation {
  host: string
  port?: string
  pathSegments: string[]
  domain: string
  location: string
  path?: string
  hasPath: boolean
  normalizedBaseUrl: string
}

/**
 * Derives the did:web/did:webvh location from PUBLIC_API_BASE_URL, per the DID-to-HTTPS
 * transformation of both method specs: the port is %3A-encoded and path segments are
 * colon-separated in the DID (e.g. https://example.com:3000/dids/issuer ->
 * example.com%3A3000:dids:issuer).
 */
export function derivePublicDidLocation(baseUrl: string): PublicDidLocation {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error(`PUBLIC_API_BASE_URL is not a valid URL (got '${baseUrl}')`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`PUBLIC_API_BASE_URL must use http or https (got '${url.protocol.slice(0, -1)}')`)
  }
  if (url.username || url.password) {
    throw new Error('PUBLIC_API_BASE_URL must not contain userinfo')
  }
  if (url.search || url.hash) {
    throw new Error('PUBLIC_API_BASE_URL must not contain a query or fragment')
  }

  const host = url.hostname
  const port = url.port || undefined
  const pathSegments = url.pathname.split('/').filter(segment => segment.length > 0)
  const domain = port ? `${host}%3A${port}` : host

  return {
    host,
    port,
    pathSegments,
    domain,
    location: [domain, ...pathSegments].join(':'),
    path: pathSegments.length ? pathSegments.join('/') : undefined,
    hasPath: pathSegments.length > 0,
    normalizedBaseUrl: `${url.origin}${pathSegments.length ? `/${pathSegments.join('/')}` : ''}`,
  }
}
