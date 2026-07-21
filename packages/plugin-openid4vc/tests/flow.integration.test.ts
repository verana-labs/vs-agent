import type { OpenId4VcCredentialConfiguration } from '../src/types'
import type { DidDocument, X509Certificate } from '@credo-ts/core'

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createCertificateFixtures } from './helpers/certificates'
import { didDocumentWithKey, MapDidResolver } from './helpers/didResolver'
import { startResolverStub } from './helpers/resolverStub'
import { createVerifierCertificate, startOpenId4VcTestAgents } from './helpers/testAgent'

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
  const didDocuments = new Map<string, DidDocument>()
  const didResolver = new MapDidResolver(didDocuments)
  let resolver: Awaited<ReturnType<typeof startResolverStub>>
  let agents: Awaited<ReturnType<typeof startOpenId4VcTestAgents>>
  let verifierCertificate: X509Certificate

  beforeAll(async () => {
    const certificates = await createCertificateFixtures()
    verifierCertificate = await createVerifierCertificate(certificates.root, VERIFIER_DID)

    didDocuments.set(
      ISSUER_DID,
      didDocumentWithKey(ISSUER_DID, certificates.leaf.publicJwk.toJson(), ['assertionMethod']),
    )
    didDocuments.set(
      VERIFIER_DID,
      didDocumentWithKey(VERIFIER_DID, verifierCertificate.publicJwk.toJson(), ['authentication']),
    )

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
  }, 60_000)

  afterAll(async () => {
    const cleanup = await Promise.allSettled([agents?.stop(), resolver?.stop()])
    expect(cleanup.filter(result => result.status === 'rejected')).toEqual([])
    await new Promise(resolve => setImmediate(resolve))
    expect(process.getActiveResourcesInfo().filter(resource => resource.includes('TCPSERVER'))).toEqual([])
  })

  it('issues and stores a holder-bound dc+sd-jwt through the pre-authorized flow', async () => {
    const offer = await agents.issuer.service.createOffer(CONFIGURATION.id, {
      name: 'Ada Lovelace',
      role: 'engineer',
    })

    const stored = await agents.holder.acceptCredentialOffer(offer.credentialOffer)

    expect(stored.claimFormat).toBe('dc+sd-jwt')
    expect(stored.prettyClaims).toMatchObject({
      vct: CONFIGURATION.vct,
      name: 'Ada Lovelace',
      role: 'engineer',
    })
    expect(Number(stored.prettyClaims.exp) - Number(stored.prettyClaims.iat)).toBe(CONFIGURATION.ttlSeconds)
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

  it('keeps holder controllers and services out of production source', async () => {
    const sourceFiles = await filesBelow(new URL('../src', import.meta.url).pathname)
    expect(sourceFiles).not.toContain('WalletController.ts')
    expect(sourceFiles).not.toContain('WalletService.ts')
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
