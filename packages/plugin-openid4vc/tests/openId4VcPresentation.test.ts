import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TrustResolutionOutcome } from '@verana-labs/vs-agent-sdk'

import { didDocumentWithKey } from './helpers/fakeDidResolver'
import {
  createTestAgentsInput,
  startTestAgents,
  TEST_ISSUER_DID,
  TEST_VERIFIER_DID,
  testCredentialConfiguration,
} from './helpers/startTestAgent'

const TTL_SECONDS = 3_600

describe('in-process OpenID4VP presentation', () => {
  let agents: Awaited<ReturnType<typeof startTestAgents>>
  // step 7 of the trust decision answers from here; a test flips it for the issuer it presents
  let issuerTrusted = true

  beforeEach(async () => {
    issuerTrusted = true
    agents = await startTestAgents({
      ...(await createTestAgentsInput()),
      resolveDidTrust: async () => ({
        trusted: issuerTrusted,
        verified: issuerTrusted,
        outcome: issuerTrusted ? TrustResolutionOutcome.VERIFIED : TrustResolutionOutcome.NOT_TRUSTED,
        source: 'fresh',
      }),
    })
    const offer = await agents.issuer.service.createOffer({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      claims: { name: 'Ada Lovelace', role: 'engineer' },
      ttlSeconds: TTL_SECONDS,
    })
    await agents.holder.acceptCredentialOffer(offer.credentialOffer)
  }, 60_000)

  afterEach(async () => {
    await agents?.stop()
  })

  async function present(requestedClaims: string[], queryLanguage?: 'dcql' | 'presentation_exchange') {
    const request = await agents.verifier.service.createRequest({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      requestedClaims,
      queryLanguage,
    })
    const resolved = await agents.holder.resolvePresentationRequest(request.authorizationRequest, [
      agents.rootCertificate,
    ])
    const submitted = await agents.holder.submitPresentation(resolved)
    expect(submitted.ok).toBe(true)
    return request.verificationSessionId
  }

  it('accepts the credential of an authorized issuer on the first read of the session', async () => {
    const proofExchangeId = await present(['name'])

    const presentation = await agents.verifier.service.getVerificationSession(proofExchangeId)

    expect(presentation).toMatchObject({
      state: 'ResponseVerified',
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      requestedClaims: ['name'],
      cryptographicVerified: true,
      accepted: true,
      trust: {
        verdict: 'TRUSTED_AUTHORIZED',
        evidence: {
          did: TEST_ISSUER_DID,
          trustStatus: 'TRUSTED',
          jsonSchemaCredentialId: testCredentialConfiguration.id,
          credentialSchemaId: testCredentialConfiguration.credentialSchemaId,
          authorized: true,
        },
      },
      credential: { vct: testCredentialConfiguration.vct, disclosedClaims: { name: 'Ada Lovelace' } },
    })
  }, 60_000)

  it('accepts a Presentation Exchange response to a request signed with x5c', async () => {
    const proofExchangeId = await present(['name'], 'presentation_exchange')

    const presentation = await agents.verifier.service.getVerificationSession(proofExchangeId)

    expect(presentation).toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: true,
      credential: { vct: testCredentialConfiguration.vct, disclosedClaims: { name: 'Ada Lovelace' } },
    })
  }, 60_000)

  it('stores the verdict with the session, so a later read does not decide again', async () => {
    const proofExchangeId = await present(['name'])
    const first = await agents.verifier.service.getVerificationSession(proofExchangeId)

    issuerTrusted = false
    const second = await agents.verifier.service.getVerificationSession(proofExchangeId)

    expect(second.trust).toEqual(first.trust)
    expect(second.accepted).toBe(true)
  }, 60_000)

  it('refuses the credential of an issuer the trust resolution does not trust', async () => {
    issuerTrusted = false
    const proofExchangeId = await present(['name', 'role'])

    const presentation = await agents.verifier.service.getVerificationSession(proofExchangeId)

    expect(presentation).toMatchObject({
      cryptographicVerified: true,
      accepted: false,
      trust: { verdict: 'UNTRUSTED', evidence: { did: TEST_ISSUER_DID, trustStatus: 'UNTRUSTED' } },
      credential: { disclosedClaims: { name: 'Ada Lovelace', role: 'engineer' } },
    })
  }, 60_000)
})

describe('in-process OpenID4VP request signed with the verifier DID', () => {
  async function resolveDidSignedRequest(verificationMethodId?: string) {
    const input = await createTestAgentsInput()
    if (verificationMethodId) {
      input.didDocuments.set(
        TEST_VERIFIER_DID,
        didDocumentWithKey(
          TEST_VERIFIER_DID,
          input.verifierCertificate.publicJwk.toJson(),
          ['authentication'],
          verificationMethodId,
        ),
      )
    }
    const agents = await startTestAgents(input)
    try {
      const request = await agents.verifier.service.createRequest({
        jsonSchemaCredentialId: testCredentialConfiguration.id,
        requestedClaims: ['name'],
        requestSigner: 'did',
      })
      return await agents.holder.resolvePresentationRequest(request.authorizationRequest, [
        agents.rootCertificate,
      ])
    } finally {
      await agents.stop()
    }
  }

  it('signs with the configured key imported under its own kid, and the holder verifies it', async () => {
    const resolved = await resolveDidSignedRequest()

    expect(resolved.signedAuthorizationRequest?.signer).toMatchObject({
      method: 'did',
      didUrl: `${TEST_VERIFIER_DID}#key-1`,
    })
  }, 60_000)

  it('signs with a method that the DID document publishes under a relative id', async () => {
    const resolved = await resolveDidSignedRequest('#operator-key')

    expect(resolved.signedAuthorizationRequest?.signer).toMatchObject({
      method: 'did',
      didUrl: `${TEST_VERIFIER_DID}#operator-key`,
    })
  }, 60_000)

  it('refuses to start when the DID record of the agent lacks the method its published document binds', async () => {
    await expect(
      startTestAgents({ ...(await createTestAgentsInput()), verifierDidRecordWithoutPublishedKey: true }),
    ).rejects.toThrow(`the DID record of the agent does not carry ${TEST_VERIFIER_DID}#key-1`)
  }, 60_000)

  it('refuses to start when the published document binds the key under a method outside the agent DID', async () => {
    const outsideMethodId = `${TEST_VERIFIER_DID}:acme#key-1`

    await expect(resolveDidSignedRequest(outsideMethodId)).rejects.toThrow(
      `${outsideMethodId} bound to the configured signing key is not a method of the agent DID ${TEST_VERIFIER_DID}`,
    )
  }, 60_000)
})

describe('OpenID4VP presentation request lifetime', () => {
  const PAST_CREDO_DEFAULT_SECONDS = 600
  const PAST_AGENT_DEFAULT_SECONDS = 1_000

  async function resolveRequestLater(secondsLater: number, presentationRequestExpirationSeconds?: number) {
    const agents = await startTestAgents({
      ...(await createTestAgentsInput()),
      presentationRequestExpirationSeconds,
    })
    try {
      const request = await agents.verifier.service.createRequest({
        jsonSchemaCredentialId: testCredentialConfiguration.id,
        requestedClaims: ['name'],
      })
      const session = await agents.verifier.service.getVerificationSession(request.verificationSessionId)
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + secondsLater * 1000 })
      const resolved = await agents.holder.resolvePresentationRequest(request.authorizationRequest, [
        agents.rootCertificate,
      ])
      return { request, session, resolved }
    } finally {
      vi.useRealTimers()
      await agents.stop()
    }
  }

  it('keeps a request resolvable for the configured lifetime and reports it as expiresAt', async () => {
    const { request, session, resolved } = await resolveRequestLater(PAST_AGENT_DEFAULT_SECONDS, 86_400)

    expect(resolved.authorizationRequestPayload).toBeDefined()
    expect(session.expiresAt!.getTime() - session.createdAt.getTime()).toBe(86_400_000)
    expect(request.expiresAt).toEqual(session.expiresAt)
  }, 60_000)

  it('keeps a request resolvable for 15 minutes when no lifetime is configured', async () => {
    const { session, resolved } = await resolveRequestLater(PAST_CREDO_DEFAULT_SECONDS)

    expect(resolved.authorizationRequestPayload).toBeDefined()
    expect(session.expiresAt!.getTime() - session.createdAt.getTime()).toBe(900_000)
  }, 60_000)

  it('expires a request after 15 minutes when no lifetime is configured', async () => {
    await expect(resolveRequestLater(PAST_AGENT_DEFAULT_SECONDS)).rejects.toThrow("status code '404'")
  }, 60_000)
})
