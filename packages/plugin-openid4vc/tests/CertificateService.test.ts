import type { OpenId4VcSigningOptions } from '../src/types'

import { AgentContext, DidDocument, DidRepository, Kms, X509Certificate } from '@credo-ts/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  didFromValidatedCertificate,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
} from '../src/services/CertificateService'

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
    expect(agent.x509.validateCertificateChain).toHaveBeenCalledWith({
      certificateChain: [fixtures.leaf.toString('base64'), fixtures.intermediate.toString('base64')],
      trustedCertificates: [fixtures.intermediate.toString('base64')],
      allowNonRootTrustedCertificate: true,
    })
  })

  it('rejects a private key that does not match the leaf certificate', async () => {
    const agent = createAgent()
    const signing = configuredSigning(fixtures.leaf, fixtures.intermediate)
    signing.configured.privateJwk = OTHER_PRIVATE_JWK

    await expect(loadSigningCertificate(agent, signing)).rejects.toThrow(
      'does not match the leaf certificate',
    )
  })

  it('rejects a leaf followed by an unrelated self-signed certificate', async () => {
    const validationError = new Error('configured certificate chain is invalid')
    const agent = createAgent({ validationError })
    const certificateChain = [fixtures.leaf.toString('base64'), fixtures.attacker.toString('base64')]

    await expect(
      loadSigningCertificate(agent, {
        configured: { certificateChain, privateJwk: LEAF_PRIVATE_JWK },
      }),
    ).rejects.toThrow('configured certificate chain is invalid')
    expect(agent.x509.validateCertificateChain).toHaveBeenCalledWith({
      certificateChain,
      trustedCertificates: [fixtures.attacker.toString('base64')],
      allowNonRootTrustedCertificate: true,
    })
  })

  it('rejects a valid chain that is not configured leaf-first', async () => {
    const agent = createAgent({
      validatedCertificateChain: [fixtures.intermediate, fixtures.leaf],
    })
    const certificateChain = [
      fixtures.leaf.toString('base64'),
      fixtures.root.toString('base64'),
      fixtures.intermediate.toString('base64'),
    ]

    await expect(
      loadSigningCertificate(agent, {
        configured: { certificateChain, privateJwk: LEAF_PRIVATE_JWK },
      }),
    ).rejects.toThrow('leaf-first')
  })

  it('returns a validated three-certificate chain in leaf-first order', async () => {
    const certificateChain = [
      fixtures.leaf.toString('base64'),
      fixtures.intermediate.toString('base64'),
      fixtures.root.toString('base64'),
    ]

    const handle = await loadSigningCertificate(createAgent(), {
      configured: { certificateChain, privateJwk: LEAF_PRIVATE_JWK },
    })

    expect(handle.chain.map(certificate => certificate.toString('base64'))).toEqual(certificateChain)
  })

  it('rejects an expired certificate', async () => {
    await expect(
      loadSigningCertificate(createAgent(), configuredSigning(fixtures.expiredLeaf, fixtures.intermediate)),
    ).rejects.toThrow('expired')
  })

  it('rejects an expired intermediate certificate', async () => {
    await expect(
      loadSigningCertificate(createAgent(), configuredSigning(fixtures.leaf, fixtures.expiredIntermediate)),
    ).rejects.toThrow('expired')
  })

  it('rejects an intermediate certificate that is not yet valid', async () => {
    await expect(
      loadSigningCertificate(
        createAgent(),
        configuredSigning(fixtures.leaf, fixtures.notYetValidIntermediate),
      ),
    ).rejects.toThrow('not yet valid')
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

  it('never publishes configured production signing material to the DID', async () => {
    const agent = createAgent()
    agent.did = 'did:web:issuer.example'
    const handle = await loadSigningCertificate(
      agent,
      configuredSigning(fixtures.leaf, fixtures.intermediate),
    )

    await publishDevelopmentSigningKey(agent, handle, 'issuer')

    expect(agent.dids.resolve).not.toHaveBeenCalled()
    expect(agent.dids.update).not.toHaveBeenCalled()
  })

  it('records the KMS key id mapping on the created DID record when publishing', async () => {
    const agent = createAgent({ developmentCertificate: fixtures.attacker })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    const handle = await loadSigningCertificate(agent, {
      development: { enabled: true, commonName: 'Development Agent' },
    })
    agent.dids.resolve.mockResolvedValue({
      didDocument: DidDocument.fromJSON({ id: 'did:web:attacker.example' }),
    })
    agent.dids.update.mockImplementation(async ({ did, didDocument }) => ({
      didState: { state: 'finished', did, didDocument },
    }))

    await publishDevelopmentSigningKey(agent, handle, 'issuer')

    expect(agent.dids.update).toHaveBeenCalledTimes(1)
    expect(agent.didRepository.update).toHaveBeenCalledTimes(1)
    expect(agent.didRecord.keys).toEqual([
      { didDocumentRelativeKeyId: '#openid4vc-development-issuer', kmsKeyId: handle.keyId },
    ])
  })

  it('declares the JsonWebKey2020 context alongside the published method', async () => {
    const agent = createAgent({ developmentCertificate: fixtures.attacker })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    const handle = await loadSigningCertificate(agent, {
      development: { enabled: true, commonName: 'Development Agent' },
    })
    agent.dids.resolve.mockResolvedValue({
      didDocument: DidDocument.fromJSON({
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: 'did:web:attacker.example',
      }),
    })
    agent.dids.update.mockImplementation(async ({ did, didDocument }) => ({
      didState: { state: 'finished', did, didDocument },
    }))

    await publishDevelopmentSigningKey(agent, handle, 'issuer')

    expect(agent.dids.update.mock.calls[0][0].didDocument.context).toEqual([
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ])
  })

  it('republishes a document that already carries the method but not its context', async () => {
    const agent = createAgent({ developmentCertificate: fixtures.attacker })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    const handle = await loadSigningCertificate(agent, {
      development: { enabled: true, commonName: 'Development Agent' },
    })
    const published = publishedDidDocument('did:web:attacker.example', handle.keyId)
    published.context = ['https://www.w3.org/ns/did/v1']
    agent.dids.resolve.mockResolvedValue({ didDocument: published })
    agent.dids.update.mockImplementation(async ({ did, didDocument }) => ({
      didState: { state: 'finished', did, didDocument },
    }))

    await publishDevelopmentSigningKey(agent, handle, 'issuer')

    expect(agent.dids.update).toHaveBeenCalledTimes(1)
    expect(agent.dids.update.mock.calls[0][0].didDocument.context).toContain(
      'https://w3id.org/security/suites/jws-2020/v1',
    )
  })

  it('repairs a missing KMS key id mapping even when the method is already published', async () => {
    const agent = createAgent({ developmentCertificate: fixtures.attacker })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    const handle = await loadSigningCertificate(agent, {
      development: { enabled: true, commonName: 'Development Agent' },
    })
    agent.dids.resolve.mockResolvedValue({
      didDocument: publishedDidDocument('did:web:attacker.example', handle.keyId),
    })

    await publishDevelopmentSigningKey(agent, handle, 'issuer')

    expect(agent.dids.update).not.toHaveBeenCalled()
    expect(agent.didRepository.update).toHaveBeenCalledTimes(1)
    expect(agent.didRecord.keys).toEqual([
      { didDocumentRelativeKeyId: '#openid4vc-development-issuer', kmsKeyId: handle.keyId },
    ])
  })

  it('leaves the DID record untouched when the mapping is already correct', async () => {
    const agent = createAgent({ developmentCertificate: fixtures.attacker })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    const handle = await loadSigningCertificate(agent, {
      development: { enabled: true, commonName: 'Development Agent' },
    })
    agent.didRecord.keys = [
      { didDocumentRelativeKeyId: '#openid4vc-development-issuer', kmsKeyId: handle.keyId },
    ]
    agent.dids.resolve.mockResolvedValue({
      didDocument: publishedDidDocument('did:web:attacker.example', handle.keyId),
    })

    await publishDevelopmentSigningKey(agent, handle, 'issuer')

    expect(agent.dids.update).not.toHaveBeenCalled()
    expect(agent.didRepository.update).not.toHaveBeenCalled()
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

  it('uses separate development records for concurrent issuer and verifier roles with equal names', async () => {
    const agent = createAgent({ developmentCertificate: fixtures.attacker })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    const signing: OpenId4VcSigningOptions = {
      development: { enabled: true, commonName: 'Development Agent' },
    }

    await Promise.all([
      loadSigningCertificate(agent, signing, agent.publicApiBaseUrl, 'issuer'),
      loadSigningCertificate(agent, signing, agent.publicApiBaseUrl, 'verifier'),
    ])

    const savedRecordIds = agent.genericRecords.save.mock.calls.map(([record]) => record.id)
    expect(savedRecordIds).toHaveLength(2)
    expect(new Set(savedRecordIds)).toHaveLength(2)
  })

  it('replaces an expired persisted development certificate with a fresh one', async () => {
    const agent = createAgent({
      developmentCertificate: fixtures.attacker,
      persistedDevelopmentCertificate: fixtures.expiredAttacker,
    })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'

    const handle = await loadSigningCertificate(agent, {
      development: { enabled: true, commonName: 'Development Agent' },
    })

    expect(handle.certificate.equal(fixtures.attacker)).toBe(true)
    expect(agent.genericRecords.deleteById).toHaveBeenCalledTimes(1)
    expect(agent.kms.createKey).toHaveBeenCalledTimes(1)
    expect(agent.genericRecords.save).toHaveBeenCalledTimes(1)
  })

  it('replaces a persisted development record whose key no KMS backend holds', async () => {
    const agent = createAgent({
      developmentCertificate: fixtures.attacker,
      persistedDevelopmentCertificate: fixtures.attacker,
    })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    agent.keys.clear()

    const handle = await loadSigningCertificate(agent, {
      development: { enabled: true, commonName: 'Development Agent' },
    })

    expect(handle.development).toBe(true)
    expect(agent.genericRecords.deleteById).toHaveBeenCalledTimes(1)
    expect(agent.kms.createKey).toHaveBeenCalledTimes(1)
  })

  it('does not replace a persisted development certificate on a KMS backend fault', async () => {
    const agent = createAgent({
      developmentCertificate: fixtures.attacker,
      persistedDevelopmentCertificate: fixtures.attacker,
    })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'
    agent.kms.getPublicKey.mockRejectedValueOnce(new Kms.KeyManagementError('backend unavailable'))

    await expect(
      loadSigningCertificate(agent, {
        development: { enabled: true, commonName: 'Development Agent' },
      }),
    ).rejects.toThrow('backend unavailable')
    expect(agent.genericRecords.deleteById).not.toHaveBeenCalled()
    expect(agent.kms.createKey).not.toHaveBeenCalled()
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

function publishedDidDocument(did: string, kmsKeyId: string): DidDocument {
  return DidDocument.fromJSON({
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
    id: did,
    verificationMethod: [
      {
        id: `${did}#openid4vc-development-issuer`,
        type: 'JsonWebKey2020',
        controller: did,
        publicKeyJwk: { ...publicJwk(OTHER_PRIVATE_JWK), kid: kmsKeyId },
      },
    ],
    assertionMethod: [`${did}#openid4vc-development-issuer`],
  })
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

function createAgent({
  developmentCertificate,
  persistedDevelopmentCertificate,
  validatedCertificateChain,
  validationError,
}: {
  developmentCertificate?: X509Certificate
  persistedDevelopmentCertificate?: X509Certificate
  validatedCertificateChain?: X509Certificate[]
  validationError?: Error
} = {}) {
  const keys = new Map<string, Kms.KmsJwkPublicEc>()
  const records = new Map<string, { id: string; content: Record<string, unknown> }>()
  if (persistedDevelopmentCertificate) {
    keys.set('development-key', { ...publicJwk(OTHER_PRIVATE_JWK), kid: 'development-key' })
  }
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
  const deletedIds = new Set<string>()
  const genericRecords = {
    findById: vi.fn(async (id: string) => {
      if (persistedDevelopmentCertificate && !deletedIds.has(id) && !records.has(id)) {
        return {
          id,
          content: {
            certificate: persistedDevelopmentCertificate.toString('base64'),
            keyId: 'development-key',
          },
        }
      }
      return records.get(id) ?? null
    }),
    save: vi.fn(async (record: { id: string; content: Record<string, unknown> }) => {
      records.set(record.id, record)
      return record
    }),
    deleteById: vi.fn(async (id: string) => {
      deletedIds.add(id)
      records.delete(id)
    }),
  }
  const x509 = {
    validateCertificateChain: vi.fn(async ({ certificateChain }: { certificateChain: string[] }) => {
      if (validationError) throw validationError
      return (
        validatedCertificateChain ??
        certificateChain.map(encoded => X509Certificate.fromEncodedCertificate(encoded)).reverse()
      )
    }),
    createCertificate: vi.fn(async () => {
      if (!developmentCertificate) throw new Error('development certificate fixture was not configured')
      return developmentCertificate
    }),
  }

  const didRecord = {
    keys: undefined as { didDocumentRelativeKeyId: string; kmsKeyId: string }[] | undefined,
  }
  const didRepository = {
    findCreatedDid: vi.fn(async () => didRecord),
    update: vi.fn(async () => undefined),
  }
  const agentContext = {}
  const dependencyManager = {
    resolve: vi.fn((token: unknown) => {
      if (token === DidRepository) return didRepository
      if (token === AgentContext) return agentContext
      throw new Error('unexpected dependency requested in test')
    }),
  }

  const agent = {
    keys,
    dids: { resolve: vi.fn(), update: vi.fn() },
    kms,
    genericRecords,
    x509,
    dependencyManager,
    didRepository,
    didRecord,
    did: undefined as string | undefined,
    publicApiBaseUrl: undefined as string | undefined,
  }

  return agent as unknown as typeof agent & Parameters<typeof loadSigningCertificate>[0]
}
