import { X509Certificate } from '@credo-ts/core'
import { webcrypto } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AdminApiErrorCode } from '@verana-labs/vs-agent-sdk'

import { createTestAgentsInput, startTestAgents, testCredentialConfiguration } from './helpers/startTestAgent'

const TTL_SECONDS = 3_600

describe('in-process OpenID4VC issuance', () => {
  let agents: Awaited<ReturnType<typeof startTestAgents>>
  let storedCredential: Awaited<
    ReturnType<Awaited<ReturnType<typeof startTestAgents>>['holder']['acceptCredentialOffer']>
  >

  beforeEach(async () => {
    agents = await startTestAgents(await createTestAgentsInput())
    const offer = await agents.issuer.service.createOffer({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      claims: { name: 'Ada Lovelace', role: 'engineer' },
      ttlSeconds: TTL_SECONDS,
    })
    storedCredential = await agents.holder.acceptCredentialOffer(offer.credentialOffer)
  }, 60_000)

  afterEach(async () => {
    await agents?.stop()
  })

  it('issues and stores a holder-bound dc+sd-jwt through the pre-authorized flow', async () => {
    expect(storedCredential.claimFormat).toBe('dc+sd-jwt')
    expect(storedCredential.prettyClaims).toMatchObject({
      vct: testCredentialConfiguration.vct,
      name: 'Ada Lovelace',
      role: 'engineer',
    })
    expect(Number(storedCredential.prettyClaims.exp) - Number(storedCredential.prettyClaims.iat)).toBe(
      TTL_SECONDS,
    )
    expect(storedCredential.prettyClaims).not.toHaveProperty('status')
    const records = await agents.holder.agent.sdJwtVc.getAll()
    expect(records).toHaveLength(1)
    expect(records[0].firstCredential.claimFormat).toBe('dc+sd-jwt')
  }, 60_000)

  it('lists, reads and deletes the issuance sessions of this issuer', async () => {
    const offer = await agents.issuer.service.createOffer({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      claims: { name: 'Grace Hopper', role: 'admiral' },
      ttlSeconds: TTL_SECONDS,
    })

    const listed = await agents.issuer.service.listIssuanceSessions()
    expect(listed.map(session => session.id)).toContain(offer.issuanceSessionId)

    const read = await agents.issuer.service.getIssuanceSession(offer.issuanceSessionId)
    expect(read).toMatchObject({
      id: offer.issuanceSessionId,
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      state: 'OfferCreated',
    })
    expect(read.expiresAt).toBeInstanceOf(Date)
    expect(read).not.toHaveProperty('credentialOffer')

    await agents.issuer.service.deleteIssuanceSession(offer.issuanceSessionId)
    await expect(agents.issuer.service.getIssuanceSession(offer.issuanceSessionId)).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
    })
  }, 60_000)

  it('serves a verifiable x5c-headed signed metadata JWT to a jwt-only client', async () => {
    const metadataUrl = `${agents.issuer.publicApiBaseUrl}/.well-known/openid-credential-issuer/oid4vci/issuer`

    const signed = await fetch(metadataUrl, { headers: { accept: 'application/jwt' } })
    const jwt = await signed.text()
    const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'))
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))

    expect(signed.status).toBe(200)
    expect(signed.headers.get('content-type')).toContain('application/jwt')
    expect(jwt).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(header).toMatchObject({ alg: 'ES256', typ: 'openidvci-issuer-metadata+jwt' })
    expect(header.x5c).toHaveLength(2)
    expect(header.x5c).not.toContain(agents.rootCertificate)
    // RFC 7515 4.1.6 requires each x5c entry to be standard padded base64 of the DER certificate.
    expect(header.x5c.every((entry: string) => /^[A-Za-z0-9+/]+={0,2}$/.test(entry))).toBe(true)
    expect(header.x5c.every((entry: string) => entry.length % 4 === 0)).toBe(true)
    expect(header.x5c.every((entry: string) => Buffer.from(entry, 'base64')[0] === 0x30)).toBe(true)
    expect(payload).toMatchObject({
      credential_issuer: `${agents.issuer.publicApiBaseUrl}/oid4vci/issuer`,
      sub: `${agents.issuer.publicApiBaseUrl}/oid4vci/issuer`,
    })
    await expect(verifyEs256(jwt, header.x5c[0])).resolves.toBe(true)
    expect(Buffer.from(encodedSignature, 'base64url')).toHaveLength(64)

    const plain = await fetch(metadataUrl, { headers: { accept: 'application/json' } })
    expect(plain.headers.get('content-type')).toContain('application/json')
    await expect(plain.json()).resolves.toMatchObject({
      credential_issuer: `${agents.issuer.publicApiBaseUrl}/oid4vci/issuer`,
    })
  }, 60_000)

  it('advertises DPoP and no client attestation without a wallet attestation root', async () => {
    const response = await fetch(
      `${agents.issuer.publicApiBaseUrl}/.well-known/oauth-authorization-server/oid4vci/issuer`,
    )
    const metadata = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(metadata.dpop_signing_alg_values_supported).toEqual(['ES256'])
    expect(metadata).not.toHaveProperty('token_endpoint_auth_methods_supported')
    expect(metadata).not.toHaveProperty('client_attestation_signing_alg_values_supported')
    expect(metadata).not.toHaveProperty('client_attestation_pop_signing_alg_values_supported')
  }, 60_000)

  it('requires no key attestation without a key attestation root', async () => {
    const response = await fetch(
      `${agents.issuer.publicApiBaseUrl}/.well-known/openid-credential-issuer/oid4vci/issuer`,
      { headers: { accept: 'application/json' } },
    )
    const proofTypes = proofTypesOf(await response.json())

    expect(Object.keys(proofTypes)).toEqual(['jwt'])
    expect(proofTypes.jwt).toEqual({ proof_signing_alg_values_supported: ['ES256'] })
  }, 60_000)

  // Every client that reads JSON is served JSON, so the signed JWT only ever reaches a client asking for it
  // alone. `application/jwt; application/json` parses as one `application/jwt` range with a parameter.
  it.each([
    'application/json, application/jwt',
    'application/jwt; application/json',
    'application/json',
  ])('serves plain metadata to a client accepting %s', async accept => {
    const response = await fetch(
      `${agents.issuer.publicApiBaseUrl}/.well-known/openid-credential-issuer/oid4vci/issuer`,
      { headers: { accept } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({
      credential_issuer: `${agents.issuer.publicApiBaseUrl}/oid4vci/issuer`,
    })
  }, 60_000)

  it('keeps holder controllers and services out of production source', async () => {
    const sourceFiles = await filesBelow(join(__dirname, '../src'))
    expect(sourceFiles).not.toContain('WalletController.ts')
    expect(sourceFiles).not.toContain('WalletService.ts')
    const publicApi = await import('../src')
    expect(publicApi).not.toHaveProperty('WalletController')
    expect(publicApi).not.toHaveProperty('WalletService')
  }, 60_000)
})

describe('OpenID4VC issuer metadata with attestation roots', () => {
  let agents: Awaited<ReturnType<typeof startTestAgents>>
  let metadataBaseUrl: string

  beforeAll(async () => {
    const input = await createTestAgentsInput()
    const root = input.certificates.root.toString('base64')
    agents = await startTestAgents({
      ...input,
      issuerTrust: { walletAttestationCertificates: [root], keyAttestationCertificates: [root] },
    })
    metadataBaseUrl = agents.issuer.publicApiBaseUrl
  }, 60_000)

  afterAll(async () => {
    await agents?.stop()
  })

  it('advertises the client attestation token endpoint auth methods credo derives', async () => {
    const response = await fetch(`${metadataBaseUrl}/.well-known/oauth-authorization-server/oid4vci/issuer`)
    const metadata = (await response.json()) as Record<string, unknown>

    expect(metadata.dpop_signing_alg_values_supported).toEqual(['ES256'])
    expect(metadata.client_attestation_signing_alg_values_supported).toEqual(['ES256'])
    expect(metadata.client_attestation_pop_signing_alg_values_supported).toEqual(['ES256'])
    expect(metadata.token_endpoint_auth_methods_supported).toContain('attest_jwt_client_auth')
  }, 60_000)

  it('requires a key attestation on the jwt proof type every wallet reads', async () => {
    const response = await fetch(`${metadataBaseUrl}/.well-known/openid-credential-issuer/oid4vci/issuer`, {
      headers: { accept: 'application/json' },
    })
    const proofTypes = proofTypesOf(await response.json())

    expect(Object.keys(proofTypes)).toEqual(['jwt'])
    expect(proofTypes.jwt).toEqual({
      proof_signing_alg_values_supported: ['ES256'],
      key_attestations_required: {},
    })
  }, 60_000)

  it('adds the attestation proof type for the single-range accept header alone', async () => {
    const response = await fetch(`${metadataBaseUrl}/.well-known/openid-credential-issuer/oid4vci/issuer`, {
      headers: { accept: 'application/jwt; application/json' },
    })
    const proofTypes = proofTypesOf(await response.json())

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(Object.keys(proofTypes).sort()).toEqual(['attestation', 'jwt'])
    expect(proofTypes.attestation).toEqual({
      proof_signing_alg_values_supported: ['ES256'],
      key_attestations_required: {},
    })
  }, 60_000)
})

function proofTypesOf(metadata: unknown): Record<string, Record<string, unknown>> {
  const configurations = (metadata as Record<string, Record<string, Record<string, unknown>>>)
    .credential_configurations_supported
  return configurations[testCredentialConfiguration.id].proof_types_supported as Record<
    string,
    Record<string, unknown>
  >
}

async function verifyEs256(jwt: string, encodedLeafCertificate: string): Promise<boolean> {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
  const leaf = X509Certificate.fromEncodedCertificate(encodedLeafCertificate)
  const key = await webcrypto.subtle.importKey(
    'jwk',
    leaf.publicJwk.toJson(),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )

  return await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(encodedSignature, 'base64url'),
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
  )
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async entry => {
      if (!entry.isDirectory()) return [entry.name]
      return await filesBelow(join(directory, entry.name))
    }),
  )
  return nested.flat()
}
