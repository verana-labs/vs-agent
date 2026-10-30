import { inflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AdminApiErrorCode } from '@verana-labs/vs-agent-sdk'

import { STATUS_LIST_TOKEN_LIFETIME_SECONDS } from '../src/services/StatusListService'
import { OpenId4VcStatusListRepository } from '../src/storage/StatusListRecord'

import { createTestAgentsInput, startTestAgents, testCredentialConfiguration } from './helpers/startTestAgent'

const ONE_HOUR = 3_600
const ONE_YEAR = 31_536_000
const CLAIMS = { name: 'Ada Lovelace', role: 'engineer' }

function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [header, payload] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
  }
}

// Token Status List, one bit per status: the first status is the least significant bit of the first byte.
function statusAt(token: string, index: number): number {
  const statusList = decodeJwt(token).payload.status_list as { bits: number; lst: string }
  expect(statusList.bits).toBe(1)
  const bytes = inflateSync(Buffer.from(statusList.lst, 'base64url'))
  return (bytes[Math.floor(index / 8)] >> (index % 8)) & 1
}

describe('OpenID4VC Token Status Lists', () => {
  let agents: Awaited<ReturnType<typeof startTestAgents>>

  beforeEach(async () => {
    agents = await startTestAgents(await createTestAgentsInput())
  }, 60_000)

  afterEach(async () => {
    await agents?.stop()
  })

  const createOffer = (
    statusList?: { statusListId: string; statusListIndex: number },
    ttlSeconds = ONE_HOUR,
  ) =>
    agents.issuer.service.createOffer({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      claims: CLAIMS,
      ttlSeconds,
      ...statusList,
    })

  const servedToken = async (uri: string) => {
    const response = await fetch(uri)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/statuslist+jwt')
    return response.text()
  }

  async function present(): Promise<{ ok: boolean; proofExchangeId: string }> {
    const request = await agents.verifier.service.createRequest({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      requestedClaims: ['name'],
    })
    const resolved = await agents.holder.resolvePresentationRequest(request.authorizationRequest, [
      agents.rootCertificate,
    ])
    const submitted = await agents.holder.submitPresentation(resolved)
    return { ok: submitted.ok, proofExchangeId: request.verificationSessionId }
  }

  it('creates a list and serves its all-valid token, signed with the chain of the credentials', async () => {
    const list = await agents.issuer.statusLists.createStatusList({ size: 4_096 })

    expect(list).toMatchObject({
      size: 4_096,
      uri: `${agents.issuer.publicApiBaseUrl}/oid4vc/status-list/${list.id}`,
    })
    expect(list.createdAt).toBeInstanceOf(Date)

    const token = await servedToken(list.uri)
    const { header, payload } = decodeJwt(token)
    const certificates = await agents.issuer.service.getCertificateInfo()
    expect(header).toMatchObject({ alg: 'ES256', typ: 'statuslist+jwt' })
    expect(header.x5c).toEqual(certificates.certificateChain)
    expect(payload).toMatchObject({ sub: list.uri, status_list: { bits: 1 } })
    expect(payload.iat).toBe(Math.floor(list.updatedAt.getTime() / 1_000))
    expect(Number(payload.exp) - Number(payload.iat)).toBe(STATUS_LIST_TOKEN_LIFETIME_SECONDS)
    expect(statusAt(token, 0)).toBe(0)
    expect(statusAt(token, 4_095)).toBe(0)

    // credo, as a verifier would, fetches and parses the token at its uri
    const fetched = await agents.verifier.agent.tokenStatusList.fetchTokenStatusList({
      uri: list.uri,
      acceptedFormats: ['jwt'],
    })
    expect(fetched.statusList).toBe(token)

    const listed = await agents.issuer.statusLists.listStatusLists()
    expect(listed.map(entry => entry.id)).toContain(list.id)
  }, 60_000)

  it('refuses a size out of range, and answers 404 for an unknown list', async () => {
    await expect(agents.issuer.statusLists.createStatusList({ size: 1_000 })).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidInput,
    })

    const response = await fetch(`${agents.issuer.publicApiBaseUrl}/oid4vc/status-list/unknown`)
    expect(response.status).toBe(404)
  }, 60_000)

  it('binds an index at offer time, stamps the status claim, and refuses a reused index', async () => {
    const list = await agents.issuer.statusLists.createStatusList({ size: 1_024 })
    const coordinates = { statusListId: list.id, statusListIndex: 7 }

    const offer = await createOffer(coordinates, ONE_YEAR)

    await expect(agents.issuer.service.getIssuanceSession(offer.issuanceSessionId)).resolves.toMatchObject(
      coordinates,
    )
    const byList = await agents.issuer.service.listIssuanceSessions({ statusListId: list.id })
    expect(byList.map(session => session.id)).toEqual([offer.issuanceSessionId])
    await expect(agents.issuer.service.listIssuanceSessions({ statusListId: 'other' })).resolves.toEqual([])

    await expect(createOffer(coordinates)).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidState,
      status: 409,
    })
    await expect(createOffer({ statusListId: list.id, statusListIndex: 1_024 })).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidInput,
    })
    await expect(createOffer({ statusListId: 'missing', statusListIndex: 0 })).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
    })
    // a year is for a registered credential alone
    await expect(createOffer(undefined, ONE_YEAR)).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidInput,
    })

    const credential = await agents.holder.acceptCredentialOffer(offer.credentialOffer)
    expect(credential.prettyClaims.status).toEqual({ status_list: { idx: 7, uri: list.uri } })
    expect(Number(credential.prettyClaims.exp) - Number(credential.prettyClaims.iat)).toBe(ONE_YEAR)
  }, 60_000)

  it('revokes by list and index after the session is gone, idempotently, then frees the list', async () => {
    const list = await agents.issuer.statusLists.createStatusList({ size: 1_024 })
    const issued = { statusListId: list.id, statusListIndex: 5 }
    const pending = { statusListId: list.id, statusListIndex: 9 }
    const offer = await createOffer(issued)
    await agents.holder.acceptCredentialOffer(offer.credentialOffer)
    await createOffer(pending)
    await agents.issuer.service.deleteIssuanceSession(offer.issuanceSessionId)

    await expect(agents.issuer.statusLists.deleteStatusList(list.id)).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidState,
      status: 409,
    })
    const before = await servedToken(list.uri)
    expect(statusAt(before, 5)).toBe(0)

    const revoked = await agents.issuer.statusLists.revokeCredential(issued)

    expect(revoked).toMatchObject(issued)
    expect(revoked.revokedAt).toBeInstanceOf(Date)
    const after = await servedToken(list.uri)
    expect(after).not.toBe(before)
    expect(statusAt(after, 5)).toBe(1)
    expect(statusAt(after, 4)).toBe(0)
    expect(statusAt(after, 9)).toBe(0)
    const { header, payload } = decodeJwt(after)
    expect(header).toMatchObject({ typ: 'statuslist+jwt', x5c: decodeJwt(before).header.x5c })
    expect(payload).toMatchObject({ sub: list.uri, iat: Math.floor(revoked.revokedAt.getTime() / 1_000) })
    const listed = await agents.issuer.statusLists.listStatusLists()
    expect(listed.find(entry => entry.id === list.id)?.updatedAt).toEqual(revoked.revokedAt)

    const again = await agents.issuer.statusLists.revokeCredential(issued)
    expect(again).toEqual(revoked)
    expect(await servedToken(list.uri)).toBe(after)

    await expect(
      agents.issuer.statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 6 }),
    ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidState, status: 409 })
    await expect(
      agents.issuer.statusLists.revokeCredential({ statusListId: 'missing', statusListIndex: 0 }),
    ).rejects.toMatchObject({ code: AdminApiErrorCode.UnknownId, status: 404 })
    await expect(
      agents.issuer.statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 5_000 }),
    ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidInput, status: 400 })

    // the pending offer still binds its index
    await expect(agents.issuer.statusLists.deleteStatusList(list.id)).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidState,
    })
    await agents.issuer.statusLists.revokeCredential(pending)
    await agents.issuer.statusLists.deleteStatusList(list.id)

    expect((await fetch(list.uri)).status).toBe(404)
    expect((await agents.issuer.statusLists.listStatusLists()).map(entry => entry.id)).not.toContain(list.id)
  }, 60_000)

  it('re-signs a token that passed half of its lifetime on the next read of its uri', async () => {
    const list = await agents.issuer.statusLists.createStatusList({ size: 1_024 })
    const first = await servedToken(list.uri)
    const repository = agents.issuer.agent.context.dependencyManager.resolve(OpenId4VcStatusListRepository)
    const record = await repository.getById(agents.issuer.agent.context, list.id)
    const issuedAt = new Date(Date.now() - (STATUS_LIST_TOKEN_LIFETIME_SECONDS / 2 + 60) * 1_000)
    record.tokenIssuedAt = issuedAt.toISOString()
    record.tokenExpiresAt = new Date(
      issuedAt.getTime() + STATUS_LIST_TOKEN_LIFETIME_SECONDS * 1_000,
    ).toISOString()
    await repository.update(agents.issuer.agent.context, record)

    const second = await servedToken(list.uri)

    expect(second).not.toBe(first)
    const { header, payload } = decodeJwt(second)
    expect(header.x5c).toEqual(decodeJwt(first).header.x5c)
    expect(Number(payload.exp)).toBeGreaterThan(
      Math.floor(Date.now() / 1_000) + STATUS_LIST_TOKEN_LIFETIME_SECONDS - 60,
    )
    expect(statusAt(second, 0)).toBe(0)
    expect(await servedToken(list.uri)).toBe(second)
  }, 60_000)

  it('lets a verifier accept a registered credential, and refuse it once it is revoked', async () => {
    const list = await agents.issuer.statusLists.createStatusList({ size: 1_024 })
    const coordinates = { statusListId: list.id, statusListIndex: 3 }
    const offer = await createOffer(coordinates)
    await agents.holder.acceptCredentialOffer(offer.credentialOffer)

    const accepted = await present()
    expect(accepted.ok).toBe(true)
    await expect(
      agents.verifier.service.getVerificationSession(accepted.proofExchangeId),
    ).resolves.toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: true,
      trust: { verdict: 'TRUSTED_AUTHORIZED' },
    })

    await agents.issuer.statusLists.revokeCredential(coordinates)

    // [VSA-VTI-FLOW-VERIFY-OID] step 6 runs as a part of step 1: the session ends in Error, with no verdict
    const refused = await present()
    expect(refused.ok).toBe(false)
    const session = await agents.verifier.service.getVerificationSession(refused.proofExchangeId)
    expect(session).toMatchObject({ state: 'Error', cryptographicVerified: false, accepted: false })
    expect(session).not.toHaveProperty('trust')
    expect(session.errorMessage).toMatch(/status/i)
  }, 60_000)
})
