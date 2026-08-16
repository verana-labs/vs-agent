import type { OpenId4VcCredentialConfiguration } from '../src/types'
import type { DidDocument, X509Certificate } from '@credo-ts/core'

import { X509Certificate as CredoX509Certificate } from '@credo-ts/core'
import { webcrypto } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createCertificateFixtures } from './helpers/certificates'
import { didDocumentWithKey, MapDidResolver } from './helpers/didResolver'
import { startResolverStub } from './helpers/resolverStub'
import {
  activeTcpServers,
  createAggregateError,
  createVerifierCertificate,
  startOpenId4VcTestAgents,
} from './helpers/testAgent'

const ISSUER_DID = 'did:web:issuer.example'
const VERIFIER_DID = 'did:web:verifier.example'
const CONFIGURATION: OpenId4VcCredentialConfiguration = {
  id: 'employee',
  format: 'dc+sd-jwt',
  vct: 'https://credentials.example/vct/employee',
  name: 'Employee credential',
  vtjscId: 'https://credentials.example/vt/employee.json',
  claims: ['name', 'role'],
  disclosureFrame: ['name', 'role'],
  ttlSeconds: 3_600,
}

describe('in-process OpenID4VC issuance and presentation', () => {
  let didDocuments: Map<string, DidDocument>
  let resolver: Awaited<ReturnType<typeof startResolverStub>>
  let agents: Awaited<ReturnType<typeof startOpenId4VcTestAgents>>
  let verifierCertificate: X509Certificate
  let storedCredential: Awaited<
    ReturnType<Awaited<ReturnType<typeof startOpenId4VcTestAgents>>['holder']['acceptCredentialOffer']>
  >
  let tcpServerBaseline: string[]

  beforeEach(async () => {
    tcpServerBaseline = activeTcpServers()
    const certificates = await createCertificateFixtures()
    verifierCertificate = await createVerifierCertificate(certificates.root, VERIFIER_DID)
    didDocuments = new Map<string, DidDocument>()
    const didResolver = new MapDidResolver(didDocuments)

    didDocuments.set(
      ISSUER_DID,
      didDocumentWithKey(ISSUER_DID, certificates.leaf.publicJwk.toJson(), ['assertionMethod']),
    )
    didDocuments.set(
      VERIFIER_DID,
      didDocumentWithKey(VERIFIER_DID, verifierCertificate.publicJwk.toJson(), ['authentication']),
    )

    try {
      resolver = await startResolverStub({
        trusted: new Set([ISSUER_DID, VERIFIER_DID]),
        authorized: new Set([ISSUER_DID, VERIFIER_DID]),
      })
      agents = await startOpenId4VcTestAgents({
        certificates,
        verifierCertificate,
        didResolver,
        resolverUrl: resolver.url,
        issuerDid: ISSUER_DID,
        verifierDid: VERIFIER_DID,
        credentialConfiguration: CONFIGURATION,
      })
      const offer = await agents.issuer.service.createOffer(CONFIGURATION.id, {
        name: 'Ada Lovelace',
        role: 'engineer',
      })
      storedCredential = await agents.holder.acceptCredentialOffer(offer.credentialOffer)
    } catch (error) {
      await rethrowAfterFixtureCleanup(error, [agents?.stop(), resolver?.stop()])
    }
  }, 60_000)

  afterEach(async () => {
    const cleanup = await Promise.allSettled([agents?.stop(), resolver?.stop()])
    expect(cleanup.filter(result => result.status === 'rejected')).toEqual([])
    await new Promise(resolve => setImmediate(resolve))
    expect(activeTcpServers()).toEqual(tcpServerBaseline)
  })

  it('issues and stores a holder-bound dc+sd-jwt through the pre-authorized flow', async () => {
    expect(storedCredential.claimFormat).toBe('dc+sd-jwt')
    expect(storedCredential.prettyClaims).toMatchObject({
      vct: CONFIGURATION.vct,
      name: 'Ada Lovelace',
      role: 'engineer',
    })
    expect(Number(storedCredential.prettyClaims.exp) - Number(storedCredential.prettyClaims.iat)).toBe(
      CONFIGURATION.ttlSeconds,
    )
    const records = await agents.holder.agent.sdJwtVc.getAll()
    expect(records).toHaveLength(1)
    expect(records[0].firstCredential.claimFormat).toBe('dc+sd-jwt')
  }, 60_000)

  it('presents the stored credential through DCQL and returns TRUSTED_AUTHORIZED', async () => {
    const exchange = await presentCredential()

    expect(exchange.resolved.authorizationRequestPayload.response_mode).toBe('direct_post.jwt')
    expect(exchange.resolved.dcql).toBeDefined()
    expect(exchange.submission.ok).toBe(true)
    expect(exchange.submission.serverResponse?.status).toBe(200)
    expect(await agents.verifier.service.getResult(exchange.verificationSessionId)).toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: true,
      trust: { verdict: 'TRUSTED_AUTHORIZED' },
      credential: {
        vct: CONFIGURATION.vct,
        disclosedClaims: { name: 'Ada Lovelace', role: 'engineer' },
      },
    })
  }, 60_000)

  it('returns UNTRUSTED without querying Verana when the issuer DID key is wrong', async () => {
    const boundDocument = didDocuments.get(ISSUER_DID)
    didDocuments.set(
      ISSUER_DID,
      didDocumentWithKey(ISSUER_DID, verifierCertificate.publicJwk.toJson(), ['assertionMethod']),
    )

    try {
      const exchange = await presentCredential()
      expect(exchange.submission.ok).toBe(true)
      resolver.reset()

      expect(await agents.verifier.service.getResult(exchange.verificationSessionId)).toMatchObject({
        state: 'ResponseVerified',
        cryptographicVerified: true,
        accepted: false,
        trust: { verdict: 'UNTRUSTED' },
      })
      expect(resolver.requestCount).toBe(0)
    } finally {
      if (boundDocument) didDocuments.set(ISSUER_DID, boundDocument)
    }
  }, 60_000)

  it('returns TRUSTED_NOT_AUTHORIZED when issuer authorization is false', async () => {
    resolver.behavior.authorized.delete(ISSUER_DID)
    try {
      const exchange = await presentCredential()
      resolver.reset()

      expect(await agents.verifier.service.getResult(exchange.verificationSessionId)).toMatchObject({
        state: 'ResponseVerified',
        cryptographicVerified: true,
        accepted: false,
        trust: { verdict: 'TRUSTED_NOT_AUTHORIZED' },
      })
      expect(resolver.requestCount).toBe(2)
    } finally {
      resolver.behavior.authorized.add(ISSUER_DID)
    }
  }, 60_000)

  it('rejects a replayed completed authorization response in Credo', async () => {
    const exchange = await presentCredential()
    expect(exchange.submission.ok).toBe(true)
    expect(exchange.submission.serverResponse?.status).toBe(200)
    expect(await agents.verifier.service.getResult(exchange.verificationSessionId)).toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
    })

    const responseUri = exchange.resolved.authorizationRequestPayload.response_uri
    const authorizationResponse = exchange.submission.authorizationResponse
    if (typeof responseUri !== 'string' || !('response' in authorizationResponse)) {
      throw new Error('expected a direct_post.jwt response URI and encrypted authorization response')
    }

    const replay = await fetch(responseUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ response: String(authorizationResponse.response) }),
    })

    expect(replay.status).toBe(400)
    await expect(replay.json()).resolves.toMatchObject({
      error: 'invalid_request',
      error_description: 'Invalid session',
    })
  }, 60_000)

  it('returns RESOLVER_UNAVAILABLE after the resolver is stopped', async () => {
    const exchange = await presentCredential()
    await resolver.stop()

    expect(await agents.verifier.service.getResult(exchange.verificationSessionId)).toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: false,
      trust: { verdict: 'RESOLVER_UNAVAILABLE' },
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
    // NL Wallet reads x5c through serde_with Base64<Standard, Padded> into DER, so base64url or
    // PEM armour would fail to deserialize before any signature check runs.
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

  it('keeps holder controllers and services out of production source', async () => {
    const sourceFiles = await filesBelow(join(__dirname, '../src'))
    expect(sourceFiles).not.toContain('WalletController.ts')
    expect(sourceFiles).not.toContain('WalletService.ts')
    const publicApi = await import('../src')
    expect(publicApi).not.toHaveProperty('WalletController')
    expect(publicApi).not.toHaveProperty('WalletService')
  }, 60_000)

  async function presentCredential() {
    const request = await agents.verifier.service.createRequest('employee-check')
    const resolved = await agents.holder.resolvePresentationRequest(request.authorizationRequest, [
      agents.rootCertificate,
    ])
    const submission = await agents.holder.submitPresentation(resolved)
    return { resolved, submission, verificationSessionId: request.verificationSessionId }
  }
})

async function rethrowAfterFixtureCleanup(
  primaryError: unknown,
  tasks: Array<Promise<unknown> | undefined>,
): Promise<never> {
  const cleanup = await Promise.allSettled(tasks)
  const cleanupErrors = cleanup.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
  if (cleanupErrors.length > 0) {
    throw createAggregateError([primaryError, ...cleanupErrors], 'OpenID4VC fixture setup and cleanup failed')
  }
  throw primaryError
}

async function verifyEs256(jwt: string, encodedLeafCertificate: string): Promise<boolean> {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
  const leaf = CredoX509Certificate.fromEncodedCertificate(encodedLeafCertificate)
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
