import { X509Certificate } from '@credo-ts/core'
import { webcrypto } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { OpenId4VcErrorCode } from '../src/errors'

import {
  activeTcpServers,
  createAggregateError,
  createTestAgentsInput,
  startTestAgents,
  testCredentialConfiguration,
} from './helpers/startTestAgent'

const TTL_SECONDS = 3_600

describe('in-process OpenID4VC issuance', () => {
  let agents: Awaited<ReturnType<typeof startTestAgents>>
  let storedCredential: Awaited<
    ReturnType<Awaited<ReturnType<typeof startTestAgents>>['holder']['acceptCredentialOffer']>
  >
  let tcpServerBaseline: string[]

  beforeEach(async () => {
    tcpServerBaseline = activeTcpServers()

    try {
      agents = await startTestAgents(await createTestAgentsInput())
      const offer = await agents.issuer.service.createOffer({
        jsonSchemaCredentialId: testCredentialConfiguration.id,
        claims: { name: 'Ada Lovelace', role: 'engineer' },
        ttlSeconds: TTL_SECONDS,
      })
      storedCredential = await agents.holder.acceptCredentialOffer(offer.credentialOffer)
    } catch (error) {
      await rethrowAfterFixtureCleanup(error, [agents?.stop()])
    }
  }, 60_000)

  afterEach(async () => {
    const cleanup = await Promise.allSettled([agents?.stop()])
    expect(cleanup.filter(result => result.status === 'rejected')).toEqual([])
    await new Promise(resolve => setImmediate(resolve))
    expect(activeTcpServers()).toEqual(tcpServerBaseline)
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
      code: OpenId4VcErrorCode.UnknownIssuanceSession,
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
