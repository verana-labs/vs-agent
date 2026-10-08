import { parseDid } from '@credo-ts/core'

import { getLegacyDidWeb } from '../did/legacyDidWeb'

import { readJsonSchema } from './util'

// [VSA-PUB-VT-6]: neither the VTJSC nor its JSON schema names a language
export const DISPLAY_LOCALE = 'en'

/** The URL of the SD-JWT VC Type Metadata of a `CredentialSchema`, per [VSA-PUB-VT-5]. */
export function typeMetadataUrl(publicApiBaseUrl: string, credentialSchemaId: string | number): string {
  return `${publicApiBaseUrl}/vt/vct/${credentialSchemaId}`
}

/**
 * The https base URL a `did:web` or `did:webvh` maps to, per the DID-to-HTTPS transformation of both
 * method specs, dropping the SCID of a `did:webvh`. It is the reverse of
 * {@link derivePublicDidLocation}, and it gives {@link typeMetadataUrl} the base of an Ecosystem
 * whose DID is all the VPR holds. Returns undefined for any other method.
 */
export function getDidWebHttpsBaseUrl(did: string): string | undefined {
  const didWeb = getLegacyDidWeb(did)
  if (!didWeb) return undefined
  const [authority, ...path] = parseDid(didWeb).id.split(':').map(decodeURIComponent)
  return `https://${[authority, ...path].join('/')}`
}

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

export interface TypeMetadataInput {
  /** The URL the document is served at; the document carries it as `vct`. */
  vct: string
  /** The JSON Schema of the `CredentialSchema` entry, as the VPR holds it. */
  jsonSchema: string | object
  /** The reference of the VTJSC to its on-chain `CredentialSchema` entry; the `name` without a title. */
  credentialSchemaRef: string
  /** The `id` of the VTJSC of the schema. */
  jsonSchemaCredentialId: string
}

/**
 * Composes the SD-JWT VC Type Metadata of a `CredentialSchema`, serialized, per [VSA-PUB-VT-5] and
 * [VT-CRED-SDJWT-3]. The result is what the agent serves at `vct`, byte for byte: every issuer the
 * Ecosystem accredits carries its integrity digest as `vct#integrity`, so the caller stores it once
 * and never composes it again for the same schema.
 */
export function composeTypeMetadata(input: TypeMetadataInput): string {
  const { title, description, attrNames, attrTitles } = readJsonSchema(input.jsonSchema)
  const name = typeof title === 'string' && title.trim() ? title : input.credentialSchemaRef
  const describedBy = description ? { description } : {}

  return JSON.stringify({
    vct: input.vct,
    name,
    ...describedBy,
    display: [{ locale: DISPLAY_LOCALE, name, ...describedBy }],
    // every claim of an SD-JWT VTC is selectively disclosable, so the type says so to every issuer
    claims: attrNames.map(attr => ({
      path: [attr],
      display: [{ locale: DISPLAY_LOCALE, label: attrTitles.get(attr) ?? attr }],
      sd: 'always',
    })),
    relatedJsonSchemaCredentialId: input.jsonSchemaCredentialId,
  })
}
