import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TrustResolutionOutcome } from '@verana-labs/vs-agent-sdk'

import {
  createTestAgentsInput,
  startTestAgents,
  TEST_ISSUER_DID,
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

  async function present(requestedClaims: string[]) {
    const request = await agents.verifier.service.createRequest({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      requestedClaims,
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
          authorized: true,
        },
      },
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
