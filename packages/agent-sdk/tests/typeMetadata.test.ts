import { TypeMetadataFormatSchema } from '@sd-jwt/sd-jwt-vc'
import { describe, expect, it } from 'vitest'

import {
  composeTypeMetadata,
  derivePublicDidLocation,
  getDidWebHttpsBaseUrl,
  typeMetadataUrl,
} from '../src/utils/typeMetadata'

const SCHEMA_REF = 'vpr:verana:vna-testnet-1:cs:144'
const JSC_ID = 'https://ecosystem.example/vt/schemas-144-jsc.json'
const VCT = typeMetadataUrl('https://ecosystem.example', 144)

const jsonSchema = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'EmployeeCredential',
    description: 'Proves employment',
    properties: {
      credentialSubject: { properties: { name: { type: 'string' }, since: { type: 'string' } } },
    },
    ...overrides,
  })

describe('typeMetadataUrl', () => {
  it('composes the fixed [VSA-PUB-VT-5] path from the base URL and the on-chain schema id', () => {
    expect(VCT).toBe('https://ecosystem.example/vt/vct/144')
  })
})

describe('composeTypeMetadata', () => {
  const build = (schema = jsonSchema()) =>
    composeTypeMetadata({
      vct: VCT,
      jsonSchema: schema,
      credentialSchemaRef: SCHEMA_REF,
      jsonSchemaCredentialId: JSC_ID,
    })

  it('carries vct, the schema title, its claims and the VTJSC id', () => {
    expect(JSON.parse(build())).toEqual({
      vct: VCT,
      name: 'EmployeeCredential',
      description: 'Proves employment',
      claims: [
        { path: ['name'], sd: 'always' },
        { path: ['since'], sd: 'always' },
      ],
      relatedJsonSchemaCredentialId: JSC_ID,
    })
  })

  it('names the type after the on-chain schema id when the schema carries no title', () => {
    const document = JSON.parse(build(jsonSchema({ title: undefined, description: undefined })))
    expect(document.name).toBe(SCHEMA_REF)
    expect(document).not.toHaveProperty('description')
  })

  it('validates as SD-JWT VC Type Metadata and keeps the extension property', () => {
    const parsed = TypeMetadataFormatSchema.parse(JSON.parse(build()))
    expect(parsed.vct).toBe(VCT)
    expect(parsed.claims?.map(claim => claim.path)).toEqual([['name'], ['since']])
    expect((parsed as Record<string, unknown>).relatedJsonSchemaCredentialId).toBe(JSC_ID)
  })
})

describe('getDidWebHttpsBaseUrl', () => {
  it('decodes the %3A-encoded port and joins the colon-separated path segments', () => {
    expect(getDidWebHttpsBaseUrl('did:web:example.com%3A3000:dids:issuer')).toBe(
      'https://example.com:3000/dids/issuer',
    )
  })

  it('skips the SCID segment of a did:webvh', () => {
    expect(getDidWebHttpsBaseUrl('did:webvh:QmFixtureScid:example.com:dids:issuer')).toBe(
      'https://example.com/dids/issuer',
    )
    expect(getDidWebHttpsBaseUrl('did:webvh:QmFixtureScid:example.com')).toBe('https://example.com')
  })

  it('returns undefined for a method it cannot map to https', () => {
    expect(getDidWebHttpsBaseUrl('did:key:z6MkfixtureKey')).toBeUndefined()
    expect(getDidWebHttpsBaseUrl('did:peer:2.Ez6fixture')).toBeUndefined()
  })
})

describe('derivePublicDidLocation', () => {
  it.each([
    {
      name: 'bare domain resolves under /.well-known',
      baseUrl: 'https://w3c-ccg.github.io',
      expected: {
        host: 'w3c-ccg.github.io',
        port: undefined,
        pathSegments: [],
        domain: 'w3c-ccg.github.io',
        location: 'w3c-ccg.github.io',
        path: undefined,
        hasPath: false,
        normalizedBaseUrl: 'https://w3c-ccg.github.io',
      },
    },
    {
      name: 'domain with path uses colon-separated segments',
      baseUrl: 'https://w3c-ccg.github.io/user/alice',
      expected: {
        host: 'w3c-ccg.github.io',
        port: undefined,
        pathSegments: ['user', 'alice'],
        domain: 'w3c-ccg.github.io',
        location: 'w3c-ccg.github.io:user:alice',
        path: 'user/alice',
        hasPath: true,
        normalizedBaseUrl: 'https://w3c-ccg.github.io/user/alice',
      },
    },
    {
      name: 'domain with port and no path stays under /.well-known',
      baseUrl: 'https://agent.example.com:8443',
      expected: {
        host: 'agent.example.com',
        port: '8443',
        pathSegments: [],
        domain: 'agent.example.com%3A8443',
        location: 'agent.example.com%3A8443',
        path: undefined,
        hasPath: false,
        normalizedBaseUrl: 'https://agent.example.com:8443',
      },
    },
    {
      name: 'domain with port and path encodes the port as %3A',
      baseUrl: 'https://example.com:3000/user/alice',
      expected: {
        host: 'example.com',
        port: '3000',
        pathSegments: ['user', 'alice'],
        domain: 'example.com%3A3000',
        location: 'example.com%3A3000:user:alice',
        path: 'user/alice',
        hasPath: true,
        normalizedBaseUrl: 'https://example.com:3000/user/alice',
      },
    },
  ])('$name', ({ baseUrl, expected }) => {
    expect(derivePublicDidLocation(baseUrl)).toEqual(expected)
  })

  it('strips a trailing slash from the normalized base URL', () => {
    expect(derivePublicDidLocation('https://example.com/').normalizedBaseUrl).toBe('https://example.com')
    expect(derivePublicDidLocation('https://example.com/dids/issuer/').normalizedBaseUrl).toBe(
      'https://example.com/dids/issuer',
    )
  })

  it.each([
    { name: 'unparseable URL', baseUrl: 'not a url', message: /not a valid URL/ },
    { name: 'non-http scheme', baseUrl: 'ftp://example.com', message: /must use http or https/ },
    { name: 'userinfo with password', baseUrl: 'https://user:pass@example.com', message: /userinfo/ },
    { name: 'userinfo without password', baseUrl: 'https://user@example.com', message: /userinfo/ },
    { name: 'query', baseUrl: 'https://example.com?x=1', message: /query or fragment/ },
    { name: 'fragment', baseUrl: 'https://example.com#top', message: /query or fragment/ },
  ])('rejects $name', ({ baseUrl, message }) => {
    expect(() => derivePublicDidLocation(baseUrl)).toThrow(message)
  })

  it.each([
    'https://example.com',
    'https://example.com:3000/dids/issuer',
  ])('round-trips %s through the DID location and back', baseUrl => {
    const { location, normalizedBaseUrl } = derivePublicDidLocation(baseUrl)

    expect(getDidWebHttpsBaseUrl(`did:web:${location}`)).toBe(normalizedBaseUrl)
    expect(getDidWebHttpsBaseUrl(`did:webvh:QmFixtureScid:${location}`)).toBe(normalizedBaseUrl)
  })
})
