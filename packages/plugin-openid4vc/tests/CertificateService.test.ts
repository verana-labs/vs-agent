import type { OpenId4VcSigningOptions } from '../src/types'
import type { X509Certificate } from '@credo-ts/core'

import { Kms } from '@credo-ts/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { didFromValidatedCertificate, loadSigningCertificate } from '../src/services/CertificateService'

import { createCertificateFixtures, LEAF_PRIVATE_JWK, OTHER_PRIVATE_JWK } from './helpers/certificates'

describe('CertificateService', () => {
  let fixtures: Awaited<ReturnType<typeof createCertificateFixtures>>

  beforeAll(async () => {
    fixtures = await createCertificateFixtures()
  })

  it('loads a configured leaf-first chain and imports the matching P-256 key', async () => {
    const agent = createAgent()
    const handle = await loadSigningCertificate(
      agent,
      configuredSigning(fixtures.leaf, fixtures.intermediate),
    )

    expect(handle.chain).toHaveLength(2)
    expect(handle.certificate.equal(handle.chain[0])).toBe(true)
    expect(handle.keyId).toBe('fixture-leaf')
    expect(handle.development).toBe(false)
  })

  it('rejects a private key that does not match the leaf certificate', async () => {
    const agent = createAgent()
    const signing = configuredSigning(fixtures.leaf, fixtures.intermediate)
    signing.configured.privateJwk = OTHER_PRIVATE_JWK

    await expect(loadSigningCertificate(agent, signing)).rejects.toThrow(
      'does not match the leaf certificate',
    )
  })

  it('rejects an expired certificate', async () => {
    await expect(
      loadSigningCertificate(createAgent(), configuredSigning(fixtures.expiredLeaf, fixtures.intermediate)),
    ).rejects.toThrow('expired')
  })

  it('rejects an empty configured chain', async () => {
    const signing: OpenId4VcSigningOptions = {
      configured: { certificateChain: [], privateJwk: LEAF_PRIVATE_JWK },
    }

    await expect(loadSigningCertificate(createAgent(), signing)).rejects.toThrow('empty')
  })

  it('rejects a self-signed configured leaf outside explicit development mode', async () => {
    await expect(
      loadSigningCertificate(createAgent(), {
        configured: {
          certificateChain: [fixtures.attacker.toString('base64')],
          privateJwk: OTHER_PRIVATE_JWK,
        },
      }),
    ).rejects.toThrow('self-signed')
  })

  it('reuses a matching configured KMS key by stable kid', async () => {
    const agent = createAgent()
    const signing = configuredSigning(fixtures.leaf, fixtures.intermediate)

    const first = await loadSigningCertificate(agent, signing)
    const second = await loadSigningCertificate(agent, signing)

    expect(second.keyId).toBe(first.keyId)
    expect(agent.kms.importKey).toHaveBeenCalledTimes(1)
  })

  it('rejects a stable kid already bound to different public key material', async () => {
    const agent = createAgent()
    agent.keys.set('fixture-leaf', publicJwk(OTHER_PRIVATE_JWK))

    await expect(
      loadSigningCertificate(agent, configuredSigning(fixtures.leaf, fixtures.intermediate)),
    ).rejects.toThrow('does not match the configured private key')
  })

  it('extracts the DID URI SAN from a validated certificate', () => {
    expect(didFromValidatedCertificate(fixtures.leaf)).toBe('did:web:issuer.example')
  })

  it('rejects a certificate without a URI SAN', () => {
    expect(() => didFromValidatedCertificate(fixtures.leafWithoutUriSan)).toThrow('DID URI SAN')
  })

  it('rejects a non-DID URI SAN', () => {
    expect(() => didFromValidatedCertificate(fixtures.leafWithNonDidUriSan)).toThrow('DID URI SAN')
  })

  it('rejects a malformed DID URI SAN', () => {
    expect(() => didFromValidatedCertificate(fixtures.leafWithMalformedDidUriSan)).toThrow('DID URI SAN')
  })

  it('creates and persists one explicit development certificate with DID and DNS SANs', async () => {
    const agent = createAgent({ developmentCertificate: fixtures.attacker })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    const signing: OpenId4VcSigningOptions = {
      development: { enabled: true, commonName: 'Development Agent' },
    }

    const first = await loadSigningCertificate(agent, signing)
    const second = await loadSigningCertificate(agent, signing)

    expect(first.development).toBe(true)
    expect(second.certificate.equal(first.certificate)).toBe(true)
    expect(agent.kms.createKey).toHaveBeenCalledTimes(1)
    expect(agent.x509.createCertificate).toHaveBeenCalledTimes(1)
    expect(agent.genericRecords.save).toHaveBeenCalledTimes(1)
    expect(agent.x509.createCertificate).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: expect.objectContaining({
          subjectAlternativeName: {
            name: [
              { type: 'url', value: 'did:web:attacker.example' },
              { type: 'dns', value: 'attacker.example' },
            ],
          },
        }),
      }),
    )
  })
})

function configuredSigning(
  leaf: X509Certificate,
  intermediate: X509Certificate,
): Extract<OpenId4VcSigningOptions, { configured: unknown }> {
  return {
    configured: {
      certificateChain: [leaf.toString('base64'), intermediate.toString('base64')],
      privateJwk: { ...LEAF_PRIVATE_JWK },
    },
  }
}

function publicJwk(privateJwk: Kms.KmsJwkPrivateEc): Kms.KmsJwkPublicEc {
  return {
    kty: privateJwk.kty,
    crv: privateJwk.crv,
    x: privateJwk.x,
    y: privateJwk.y,
    kid: privateJwk.kid,
  }
}

function createAgent({ developmentCertificate }: { developmentCertificate?: X509Certificate } = {}) {
  const keys = new Map<string, Kms.KmsJwkPublicEc>()
  const records = new Map<string, { id: string; content: Record<string, unknown> }>()
  const kms = {
    createKey: vi.fn(async () => {
      const keyId = 'development-key'
      const publicKey = { ...publicJwk(OTHER_PRIVATE_JWK), kid: keyId }
      keys.set(keyId, publicKey)
      return { keyId, publicJwk: publicKey }
    }),
    getPublicKey: vi.fn(async ({ keyId }: { keyId: string }) => {
      const key = keys.get(keyId)
      if (!key) throw new Kms.KeyManagementKeyNotFoundError(keyId, ['test'])
      return key
    }),
    importKey: vi.fn(async ({ privateJwk }: { privateJwk: Kms.KmsJwkPrivateEc }) => {
      const keyId = privateJwk.kid ?? 'imported-key'
      const publicKey = { ...publicJwk(privateJwk), kid: keyId }
      keys.set(keyId, publicKey)
      return { keyId, publicJwk: publicKey }
    }),
  }
  const genericRecords = {
    findById: vi.fn(async (id: string) => records.get(id) ?? null),
    save: vi.fn(async (record: { id: string; content: Record<string, unknown> }) => {
      records.set(record.id, record)
      return record
    }),
  }
  const x509 = {
    createCertificate: vi.fn(async () => {
      if (!developmentCertificate) throw new Error('development certificate fixture was not configured')
      return developmentCertificate
    }),
  }

  return {
    keys,
    kms,
    genericRecords,
    x509,
    did: undefined as string | undefined,
    publicApiBaseUrl: undefined as string | undefined,
  }
}
