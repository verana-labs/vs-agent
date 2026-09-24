import type { OpenId4VcAgent, OpenId4VcPluginOptions, OpenId4VcSigningOptions } from '../src/types'
import type {
  DidCreateResult,
  DidDeactivateResult,
  DidRegistrar,
  DidResolutionResult,
  DidResolver,
  DidUpdateOptions,
  DidUpdateResult,
} from '@credo-ts/core'

import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  AgentContext,
  ConsoleLogger,
  DidDocument,
  DidDocumentRole,
  DidRecord,
  DidRepository,
  DidsModule,
  JsonTransformer,
  Kms,
  LogLevel,
  X509Certificate,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'
import {
  didFromValidatedCertificate,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
} from '../src/services/CertificateService'
import { IssuerService } from '../src/services/IssuerService'
import { VerifierService } from '../src/services/VerifierService'

import { createCertificateFixtures, LEAF_PRIVATE_JWK, OTHER_PRIVATE_JWK } from './helpers/certificates'
import { getAskarStoreConfig } from './helpers/startTestAgent'

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

  it('accepts a configured issuer leaf whose URI SAN is the public API base URL', async () => {
    const handle = await loadSigningCertificate(
      createAgent(),
      configuredSigning(fixtures.leafWithNonDidUriSan, fixtures.intermediate),
      'https://issuer.example',
      'issuer',
    )

    expect(handle.development).toBe(false)
  })

  it('refuses a configured issuer leaf that names neither the credential issuer nor its host', async () => {
    await expect(
      loadSigningCertificate(
        createAgent(),
        configuredSigning(fixtures.leaf, fixtures.intermediate),
        'https://other.example/agent',
        'issuer',
      ),
    ).rejects.toThrow(
      "configured issuer certificate must carry 'https://other.example/agent' as a URI SAN or 'other.example' as a DNS SAN",
    )
  })

  it('leaves the verifier certificate out of that rule, it signs no credential', async () => {
    const handle = await loadSigningCertificate(
      createAgent(),
      configuredSigning(fixtures.leaf, fixtures.intermediate),
      'https://other.example/agent',
      'verifier',
    )

    expect(handle.development).toBe(false)
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
    const handle = await loadSigningCertificate(agent, undefined)
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
    const handle = await loadSigningCertificate(agent, undefined)
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
    const handle = await loadSigningCertificate(agent, undefined)
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
    const handle = await loadSigningCertificate(agent, undefined)
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
    const handle = await loadSigningCertificate(agent, undefined)
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
    const first = await loadSigningCertificate(agent, undefined)
    const second = await loadSigningCertificate(agent, undefined)

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

  it('uses separate development records for the issuer and the verifier role', async () => {
    const agent = createAgent({ developmentCertificate: fixtures.attacker })
    agent.did = 'did:web:attacker.example'
    agent.publicApiBaseUrl = 'https://attacker.example/agent'

    await Promise.all([
      loadSigningCertificate(agent, undefined, agent.publicApiBaseUrl, 'issuer'),
      loadSigningCertificate(agent, undefined, agent.publicApiBaseUrl, 'verifier'),
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

    const handle = await loadSigningCertificate(agent, undefined)

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

    const handle = await loadSigningCertificate(agent, undefined)

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

    await expect(loadSigningCertificate(agent, undefined)).rejects.toThrow('backend unavailable')
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
    findById: async (id: string) => {
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
    },
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
    findCreatedDid: async () => didRecord,
    update: vi.fn(async () => undefined),
  }
  const dependencyManager = {
    resolve: (token: unknown) => {
      if (token === DidRepository) return didRepository
      throw new Error('unexpected dependency requested in test')
    },
  }
  const agentContext = { dependencyManager }

  const agent = {
    keys,
    dids: { resolve: vi.fn(), update: vi.fn() },
    kms,
    genericRecords,
    x509,
    context: agentContext,
    didRepository,
    didRecord,
    did: undefined as string | undefined,
    publicApiBaseUrl: 'https://issuer.example' as string | undefined,
  }

  return agent as unknown as typeof agent &
    Parameters<typeof loadSigningCertificate>[0] &
    Parameters<typeof publishDevelopmentSigningKey>[0]
}

const DID_WEB = 'did:web:agent.example'
const DID_WEBVH = 'did:webvh:QmYwAPJzv5CZsnAzt8auVZRnGi2C9AwBypHj6yQVB5hJiJ:agent.example'
const EXISTING_METHOD_SUFFIX = 'existing-ed25519'

type Role = 'issuer' | 'verifier' | 'both'
type TestAgent = Agent & { did?: string }

class MutableDidRegistry {
  public readonly supportedMethods = ['web', 'webvh']
  public readonly allowsCaching = false
  public readonly allowsLocalDidRecord = false
  public updateCount = 0
  public failUpdate = false
  public returnWrongDidFromResolution = false
  public returnWrongDidFromUpdate = false

  public constructor(private readonly documents: Map<string, DidDocument>) {}

  public async resolve(_agentContext: AgentContext, did: string): Promise<DidResolutionResult> {
    const stored = this.documents.get(did)
    if (!stored) {
      return {
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: { error: 'notFound' },
      }
    }

    const didDocument = cloneDidDocument(stored)
    if (this.returnWrongDidFromResolution) didDocument.id = 'did:web:wrong.example'
    return { didDocument, didDocumentMetadata: {}, didResolutionMetadata: {} }
  }

  public async update(agentContext: AgentContext, options: DidUpdateOptions): Promise<DidUpdateResult> {
    this.updateCount += 1
    if (this.failUpdate) {
      return {
        didState: { state: 'failed', reason: 'deliberate DID update failure' },
        didDocumentMetadata: {},
        didRegistrationMetadata: {},
      }
    }

    const didDocument = cloneDidDocument(options.didDocument as DidDocument)
    const resultDid = this.returnWrongDidFromUpdate ? 'did:web:wrong.example' : options.did
    if (!this.returnWrongDidFromUpdate) {
      this.documents.set(options.did, didDocument)
      await this.refreshCreatedDidRecord(agentContext, options.did, didDocument)
    }
    return {
      didState: { state: 'finished', did: resultDid, didDocument },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }

  private async refreshCreatedDidRecord(
    agentContext: AgentContext,
    did: string,
    didDocument: DidDocument,
  ): Promise<void> {
    const didRepository = agentContext.dependencyManager.resolve(DidRepository)
    const didRecord = await didRepository.findCreatedDid(agentContext, did)
    if (!didRecord) return
    didRecord.didDocument = didDocument
    await didRepository.update(agentContext, didRecord)
  }

  public async create(): Promise<DidCreateResult> {
    return {
      didState: { state: 'failed', reason: 'not implemented in test registrar' },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }

  public async deactivate(): Promise<DidDeactivateResult> {
    return {
      didState: { state: 'failed', reason: 'not implemented in test registrar' },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }

  public document(did: string): DidDocument {
    const document = this.documents.get(did)
    if (!document) throw new Error(`missing test DID document for ${did}`)
    return cloneDidDocument(document)
  }
}

const developmentAgents: TestAgent[] = []

afterEach(async () => {
  await Promise.all(developmentAgents.splice(0).map(agent => agent.shutdown()))
})

describe('development signing DID publication', () => {
  it('publishes the generated issuer key before completing full plugin initialization', async () => {
    const { agent, initialize, registry } = await createHarness('issuer', DID_WEB)

    await initialize()

    const document = registry.document(DID_WEB)
    const methodId = `${DID_WEB}#openid4vc-development-issuer`
    expect(verificationMethodIds(document)).toContain(methodId)
    expect(relationshipIds(document.assertionMethod)).toContain(methodId)
    expect(relationshipIds(document.authentication)).toEqual([`${DID_WEB}#${EXISTING_METHOD_SUFFIX}`])
    expect(await createdDidRecordKeys(agent, DID_WEB)).toEqual([
      { didDocumentRelativeKeyId: '#openid4vc-development-issuer', kmsKeyId: expect.any(String) },
    ])
  })

  it('publishes the generated verifier key through the generic DID API for did:webvh', async () => {
    const { agent, initialize, registry } = await createHarness('verifier', DID_WEBVH)

    await initialize()

    const document = registry.document(DID_WEBVH)
    const methodId = `${DID_WEBVH}#openid4vc-development-verifier`
    expect(verificationMethodIds(document)).toContain(methodId)
    expect(relationshipIds(document.authentication)).toContain(methodId)
    expect(relationshipIds(document.assertionMethod)).toEqual([`${DID_WEBVH}#${EXISTING_METHOD_SUFFIX}`])
    expect(await createdDidRecordKeys(agent, DID_WEBVH)).toEqual([
      { didDocumentRelativeKeyId: '#openid4vc-development-verifier', kmsKeyId: expect.any(String) },
    ])
  })

  it('preserves both role relationships when issuer and verifier share one DID', async () => {
    const { agent, initialize, registry } = await createHarness('both', DID_WEB)

    await initialize()

    const document = registry.document(DID_WEB)
    expect(relationshipIds(document.assertionMethod)).toContain(`${DID_WEB}#openid4vc-development-issuer`)
    expect(relationshipIds(document.authentication)).toContain(`${DID_WEB}#openid4vc-development-verifier`)
    expect(registry.updateCount).toBe(2)
    const keys = await createdDidRecordKeys(agent, DID_WEB)
    expect(keys).toContainEqual({
      didDocumentRelativeKeyId: '#openid4vc-development-issuer',
      kmsKeyId: expect.any(String),
    })
    expect(keys).toContainEqual({
      didDocumentRelativeKeyId: '#openid4vc-development-verifier',
      kmsKeyId: expect.any(String),
    })
  })

  it('reuses persisted development keys without updating an already-published DID', async () => {
    const { initialize, registry } = await createHarness('both', DID_WEB)
    await initialize()

    await initialize()

    expect(registry.updateCount).toBe(2)
    expect(relationshipIds(registry.document(DID_WEB).assertionMethod)).toContain(
      `${DID_WEB}#openid4vc-development-issuer`,
    )
    expect(relationshipIds(registry.document(DID_WEB).authentication)).toContain(
      `${DID_WEB}#openid4vc-development-verifier`,
    )
  })

  it('fails initialization when the agent-owned DID update fails', async () => {
    const { initialize, registry } = await createHarness('issuer', DID_WEB)
    registry.failUpdate = true

    await expect(initialize()).rejects.toThrow('development signing key DID update failed')
  })

  it('fails closed when resolution returns a different DID document', async () => {
    const { initialize, registry } = await createHarness('issuer', DID_WEB)
    registry.returnWrongDidFromResolution = true

    await expect(initialize()).rejects.toThrow(
      'development signing key DID resolution returned a different DID',
    )
    expect(registry.updateCount).toBe(0)
  })

  it('fails closed when the DID update result identifies a different DID', async () => {
    const { initialize, registry } = await createHarness('issuer', DID_WEB)
    registry.returnWrongDidFromUpdate = true

    await expect(initialize()).rejects.toThrow('development signing key DID update returned a different DID')
  })
})

async function createHarness(
  role: Role,
  did: string,
): Promise<{
  agent: TestAgent
  initialize: () => Promise<void>
  registry: MutableDidRegistry
}> {
  const options = developmentOptions(role)

  let issuerService: IssuerService | undefined
  const sdkPlugin = setupOpenId4Vc(options, () => {
    if (!issuerService) throw new Error('OpenID4VC issuer service is not initialized')
    return issuerService
  })

  const registry = new MutableDidRegistry(new Map([[did, initialDidDocument(did)]]))
  const agent = await startDevelopmentAgent('openid4vc-development', did, registry, sdkPlugin.modules)
  await agent.dependencyManager
    .resolve(DidRepository)
    .save(
      agent.context,
      new DidRecord({ did, role: DidDocumentRole.Created, didDocument: initialDidDocument(did) }),
    )
  developmentAgents.push(agent)

  const initialize = async (): Promise<void> => {
    const lifecycleAgent = agent as unknown as OpenId4VcAgent
    if (options.issuer) {
      issuerService = new IssuerService(lifecycleAgent, options, () => {})
      await issuerService.ensureInitialized()
    }
    if (options.verifier) {
      await new VerifierService(lifecycleAgent, options).ensureInitialized()
    }
  }

  return { agent, initialize, registry }
}

async function startDevelopmentAgent(
  storePrefix: string,
  did: string,
  registry: DidResolver & DidRegistrar,
  extraModules: Record<string, unknown> = {},
): Promise<TestAgent> {
  const agent = new Agent({
    config: { logger: new ConsoleLogger(LogLevel.Off) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: getAskarStoreConfig(storePrefix) }),
      dids: new DidsModule({ resolvers: [registry], registrars: [registry] }),
      ...extraModules,
    },
  }) as TestAgent
  agent.did = did
  await agent.initialize()
  return agent
}

function developmentOptions(role: Role): OpenId4VcPluginOptions {
  return {
    publicApiBaseUrl: 'https://agent.example',
    ...(role !== 'verifier' ? { issuer: {} } : {}),
    ...(role !== 'issuer' ? { verifier: {} } : {}),
    credentialConfigurations: [],
  }
}

function initialDidDocument(did: string): DidDocument {
  const methodId = `${did}#${EXISTING_METHOD_SUFFIX}`
  return JsonTransformer.fromJSON(
    {
      id: did,
      verificationMethod: [
        {
          id: methodId,
          type: 'JsonWebKey2020',
          controller: did,
          publicKeyJwk: {
            kty: 'OKP',
            crv: 'Ed25519',
            x: '11qYAYLefJYdHnAu2rF7FQj9qH9iWjWzjKSkM5x2B7M',
          },
        },
      ],
      authentication: [methodId],
      assertionMethod: [methodId],
    },
    DidDocument,
  )
}

async function createdDidRecordKeys(agent: TestAgent, did: string) {
  const record = await agent.dependencyManager.resolve(DidRepository).findCreatedDid(agent.context, did)
  return record?.keys
}

function cloneDidDocument(document: DidDocument): DidDocument {
  return JsonTransformer.fromJSON(document.toJSON(), DidDocument)
}

function verificationMethodIds(document: DidDocument): string[] {
  return document.verificationMethod?.map(method => method.id) ?? []
}

function relationshipIds(relationship: DidDocument['assertionMethod']): string[] {
  return relationship?.map(method => (typeof method === 'string' ? method : method.id)) ?? []
}
