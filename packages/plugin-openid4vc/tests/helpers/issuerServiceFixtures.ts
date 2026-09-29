import type { IssuerService } from '../../src/services/IssuerService'
import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../../src/types'
import type { Mock } from 'vitest'

import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'
import { vi } from 'vitest'

import { digestOfBytes } from '@verana-labs/vs-agent-sdk'

export const AGENT_DID = 'did:web:agent.example'
export const EMPLOYEE_VCT = 'https://agent.example/oid4vc/vct/employee'

export const PUBLIC_JWK = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'f83OJ3D2xF4vJZFGh7LbqoFh8z3eYMSO5Rohb7EBM0Y',
  y: 'x_FEzRu9C79d3eRWUSYufNWJckU1iK4R0jP4lJv-Eow',
}
export const HOLDER_JWK = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'o0pHM_e14uztQfxTPY-bq8VlY4gK73YqkWQZyDTLQNQ',
  y: 'OeoQ8PF6k3JwXnKcHk4x1v3wFOhMB1d3Z5GZln0FrcA',
}

export const EMPLOYEE_JSON_SCHEMA = JSON.stringify({
  title: 'Employee credential',
  type: 'object',
  properties: {
    credentialSubject: {
      type: 'object',
      properties: { name: { type: 'string' }, role: { type: 'string' } },
      required: ['name'],
    },
  },
})

export const TYPE_METADATA = JSON.stringify({ vct: EMPLOYEE_VCT })
export const TYPE_METADATA_INTEGRITY = digestOfBytes(TYPE_METADATA)

export const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
export const issuerSink = vi.fn()
export const issuanceSessionRepository = { findByQuery: vi.fn(), update: vi.fn() }
export const anonCredsTrust = { assertOwnAuthorization: vi.fn() }

export const issuerOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {},
  credentialConfigurations: [
    {
      id: 'employee',
      format: 'dc+sd-jwt',
      vct: EMPLOYEE_VCT,
      name: 'Employee credential',
      description: 'Proof of employment',
      vtjscId: 'https://agent.example/vt/employee.json',
      credentialSchemaId: 1,
      jsonSchema: EMPLOYEE_JSON_SCHEMA,
      claims: ['name', 'role'],
      disclosureFrame: ['name', 'role'],
    },
  ],
})

export const contractorConfiguration: OpenId4VcCredentialConfiguration = {
  id: 'contractor',
  format: 'dc+sd-jwt',
  vct: 'https://agent.example/oid4vc/vct/contractor',
  name: 'Contractor credential',
  vtjscId: 'https://agent.example/vt/contractor.json',
  credentialSchemaId: 2,
  jsonSchema: EMPLOYEE_JSON_SCHEMA,
  claims: ['name'],
  disclosureFrame: ['name'],
}

export function issuerApi() {
  return {
    getIssuerByIssuerId: vi.fn(),
    createIssuer: vi.fn(),
    updateIssuerMetadata: vi.fn(),
    createCredentialOffer: vi.fn(),
    getIssuanceSessionById: vi.fn(),
    deleteIssuanceSessionById: vi.fn(),
  }
}

export function issuanceSession(overrides: Record<string, unknown> = {}) {
  const tags: Record<string, unknown> = { jsonSchemaCredentialId: 'employee' }
  return {
    id: 'session-1',
    issuerId: 'issuer',
    state: 'OfferCreated',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: undefined,
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    errorMessage: undefined,
    credentialOfferPayload: { credential_configuration_ids: ['employee'] },
    getTag: (name: string) => tags[name],
    setTag: (name: string, value: unknown) => {
      tags[name] = value
    },
    ...overrides,
  }
}

export function jwsService() {
  return { createJwsCompact: vi.fn().mockResolvedValue('re-signed.metadata.jwt') }
}

export function issuerAgent(
  api = issuerApi(),
  did: string | undefined = AGENT_DID,
  jws = jwsService(),
  ecsClaims?: { service?: Record<string, string | undefined> },
  overrides: Record<string, unknown> = {},
) {
  return {
    did,
    ecsClaims,
    anonCredsTrust,
    config: { logger },
    dids: { resolve: () => undefined },
    genericRecords: { findById: async () => null, save: () => undefined, update: () => undefined },
    kms: {},
    x509: {},
    context: {
      dependencyManager: {
        resolve: (token: unknown) => {
          if (token === OpenId4VcIssuanceSessionRepository) return issuanceSessionRepository
          return jws
        },
      },
    },
    modules: { openId4Vc: { issuer: api } },
    ...overrides,
  }
}

export const leafCertificate = {
  sanUriNames: [AGENT_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
  rawCertificate: Buffer.from('leaf-certificate'),
  toString: () => 'leaf-certificate',
}
export const rootCertificate = {
  subject: 'CN=Example Root',
  issuer: 'CN=Example Root',
  toString: () => 'root-certificate',
}

export function issuerSigningHandle() {
  return {
    certificate: leafCertificate,
    chain: [leafCertificate, rootCertificate],
    keyId: 'issuer-key',
    development: false,
  }
}

export function servedTypeMetadata(body: string | Uint8Array = TYPE_METADATA): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

/** Installs a global fetch stub for the Type Metadata reads; call `vi.unstubAllGlobals` afterwards. */
export function stubTypeMetadataFetch(): Mock {
  const fetchTypeMetadata = vi.fn().mockImplementation(async () => servedTypeMetadata())
  vi.stubGlobal('fetch', fetchTypeMetadata)
  return fetchTypeMetadata
}

export async function stampedIntegrity(service: IssuerService, request: unknown): Promise<unknown> {
  const mapped = await service.mapCredentialRequest(request as never)
  if (mapped.type !== 'credentials') throw new Error('expected credentials')
  const credential = mapped.credentials[0]
  if (!credential || !('payload' in credential)) throw new Error('expected SD-JWT credentials')
  return credential.payload['vct#integrity']
}

export const credentialRequest = (claims: Record<string, unknown> = { name: 'Ada' }) => ({
  credentialConfigurationId: 'employee',
  issuanceSession: { issuanceMetadata: { claims, ttlSeconds: 3_600 } },
  holderBinding: { bindingMethod: 'jwk', proofType: 'jwt', keys: [{ method: 'jwk', jwk: HOLDER_JWK }] },
})
