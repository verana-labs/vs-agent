import type {
  OpenId4VcCredentialConfiguration,
  OpenId4VcPluginOptions,
  OpenId4VcSigningOptions,
} from '../src/types'
import type {
  DidCreateResult,
  DidDeactivateResult,
  DidRegistrar,
  DidResolutionResult,
  DidResolver,
  DidUpdateOptions,
  DidUpdateResult,
} from '@credo-ts/core'
import type { Server } from 'node:http'

import { AskarModule, type AskarSqliteStorageConfig } from '@credo-ts/askar'
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
  utils,
  X509Certificate,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { ed25519 } from '@noble/curves/ed25519.js'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { base58 } from '@scure/base'
import { CachedWebDidResolver } from '@verana-labs/vs-agent-sdk'
import express from 'express'
import { webcrypto } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { validateOpenId4VcOptions } from '../src/config'
import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'
import {
  didFromValidatedCertificate,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
} from '../src/services/CertificateService'
import {
  IssuerService,
  UnknownIssuanceSessionError,
  type OpenId4VcIssuerAgent,
} from '../src/services/IssuerService'
import {
  UnknownVerificationSessionError,
  VerifierService,
  type OpenId4VcVerifierAgent,
} from '../src/services/VerifierService'

import { createCertificateFixtures, LEAF_PRIVATE_JWK, OTHER_PRIVATE_JWK } from './helpers/certificates'
import { didDocumentWithKey, MapDidResolver } from './helpers/didResolver'
import { startResolverStub } from './helpers/resolverStub'
import {
  activeTcpServers,
  createAggregateError,
  createVerifierCertificate,
  OpenId4VcTestStartupError,
  startOpenId4VcTestAgents,
  type TestAgentFailureHooks,
} from './helpers/testAgent'

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
  const agentContext = {}
  const dependencyManager = {
    resolve: (token: unknown) => {
      if (token === DidRepository) return didRepository
      if (token === AgentContext) return agentContext
      throw new Error('unexpected dependency requested in test')
    },
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

  return agent as unknown as typeof agent &
    Parameters<typeof loadSigningCertificate>[0] &
    Parameters<typeof publishDevelopmentSigningKey>[0]
}

const DID_WEB = 'did:web:agent.example'
const DID_WEBVH = 'did:webvh:QmYwAPJzv5CZsnAzt8auVZRnGi2C9AwBypHj6yQVB5hJiJ:agent.example'
const EXISTING_METHOD_SUFFIX = 'existing-ed25519'
const ASKAR_STORE_KEY = 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa'

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
  validateOpenId4VcOptions(options)

  let issuerService: IssuerService | undefined
  const sdkPlugin = setupOpenId4Vc(options, () => {
    if (!issuerService) throw new Error('OpenID4VC issuer service is not initialized')
    return issuerService
  })

  const registry = new MutableDidRegistry(new Map([[did, initialDidDocument(did)]]))
  const agent = await startTestAgent('openid4vc-development', did, registry, sdkPlugin.modules)
  await agent.dependencyManager
    .resolve(DidRepository)
    .save(
      agent.context,
      new DidRecord({ did, role: DidDocumentRole.Created, didDocument: initialDidDocument(did) }),
    )
  developmentAgents.push(agent)

  const initialize = async (): Promise<void> => {
    const lifecycleAgent = agent as unknown as OpenId4VcIssuerAgent & OpenId4VcVerifierAgent
    if (options.issuer) {
      issuerService = new IssuerService(lifecycleAgent, options)
      await issuerService.ensureInitialized()
    }
    if (options.verifier) {
      await new VerifierService(lifecycleAgent, options).ensureInitialized()
    }
  }

  return { agent, initialize, registry }
}

async function startTestAgent(
  storePrefix: string,
  did: string,
  registry: DidResolver & DidRegistrar,
  extraModules: Record<string, unknown> = {},
): Promise<TestAgent> {
  const agent = new Agent({
    config: { logger: new ConsoleLogger(LogLevel.Off) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `${storePrefix}-${utils.uuid()}`,
          key: ASKAR_STORE_KEY,
          keyDerivationMethod: 'raw',
          database: { type: 'sqlite', config: { inMemory: true } } as AskarSqliteStorageConfig,
        },
      }),
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
    ...(role !== 'issuer'
      ? {
          verifier: {},
          trust: {
            resolverUrl: 'https://resolver.example/v1/trust',
            timeoutMs: 5_000,
            allowedDidWebHosts: ['agent.example'],
            credentialIssuerCertificates: [],
            developmentCertificateFingerprints: [`SHA256:${'0'.repeat(64)}`],
          },
        }
      : {}),
    credentialConfigurations: [],
    verifierPolicies: [],
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

function clone(document: DidDocument): DidDocument {
  return JsonTransformer.fromJSON(document.toJSON(), DidDocument)
}

const WEBVH_DID = 'did:webvh:QmYwAPJzv5CZsnAzt8auVZRnGi2C9AwBypHj6yQVB5hJiJ:verifier.example'
const WEB_DID = 'did:web:verifier.example'
const CONFIGURATION: OpenId4VcCredentialConfiguration = {
  id: 'employee',
  format: 'dc+sd-jwt',
  vct: 'https://credentials.example/vct/employee',
  name: 'Employee credential',
  vtjscId: 'https://credentials.example/vt/employee.json',
  claims: ['name', 'role'],
  disclosureFrame: ['name', 'role'],
}

class WebvhStubRegistry {
  public readonly supportedMethods = ['webvh']
  public readonly allowsCaching = false
  public readonly allowsLocalDidRecord = false

  public constructor(private readonly documents: Map<string, DidDocument>) {}

  public async resolve(_agentContext: AgentContext, did: string): Promise<DidResolutionResult> {
    const stored = this.documents.get(did)
    if (!stored) {
      return { didDocument: null, didDocumentMetadata: {}, didResolutionMetadata: { error: 'notFound' } }
    }
    return { didDocument: clone(stored), didDocumentMetadata: {}, didResolutionMetadata: {} }
  }

  public async update(agentContext: AgentContext, options: DidUpdateOptions): Promise<DidUpdateResult> {
    const didDocument = clone(options.didDocument as DidDocument)
    this.documents.set(options.did, didDocument)
    const didRepository = agentContext.dependencyManager.resolve(DidRepository)
    const didRecord = await didRepository.findCreatedDid(agentContext, options.did)
    if (didRecord) {
      didRecord.didDocument = clone(didDocument)
      await didRepository.update(agentContext, didRecord)
    }
    return {
      didState: { state: 'finished', did: options.did, didDocument },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }

  public async create(): Promise<DidCreateResult> {
    return {
      didState: { state: 'failed', reason: 'not implemented' },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }

  public async deactivate(): Promise<DidDeactivateResult> {
    return {
      didState: { state: 'failed', reason: 'not implemented' },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }
}

const cleanups: Array<() => Promise<unknown>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(stop => stop().catch(() => undefined)))
})

describe('presentation-exchange request signing for a webvh verifier', () => {
  it('signs under the agent webvh DID with its Ed25519 authentication key', async () => {
    const { service, fetchRequestJwt, ed25519MethodId } = await startWebvhVerifier()

    const request = await service.createRequest('employee-check', 'presentation_exchange', 'did')
    const { header, payload } = await fetchRequestJwt(request.authorizationRequest)

    expect(header.alg).toBe('EdDSA')
    expect(header.kid).toBe(ed25519MethodId)

    const filter = payload.presentation_definition?.input_descriptors?.[0]?.constraints?.fields?.[0]
      ?.filter as { const?: string; pattern?: string } | undefined
    expect(filter?.const).toBe(CONFIGURATION.vct)
    expect(filter?.pattern).toBe(CONFIGURATION.vct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    expect(payload.presentation_definition?.input_descriptors?.[0]?.constraints?.limit_disclosure).toBe(
      'preferred',
    )
    // No JARM on this rail: the wallets that need it cannot build the encrypted response.
    expect(payload.response_mode).toBe('direct_post')
    expect(payload.client_metadata?.jwks).toBeUndefined()
  })
})

async function startWebvhVerifier() {
  const certificates = await createCertificateFixtures()
  const verifierCertificate = await createVerifierCertificate(certificates.root, WEBVH_DID)
  const resolverStub = await startResolverStub({
    trusted: new Set([WEBVH_DID, WEB_DID]),
    authorized: new Set([WEBVH_DID, WEB_DID]),
  })
  cleanups.push(() => resolverStub.stop())

  const secretKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secretKey)
  const publicKeyMultibase = `z${base58.encode(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const ed25519MethodId = `${WEBVH_DID}#${publicKeyMultibase}`
  const certMethodId = `${WEBVH_DID}#certificate`

  const didDocument = JsonTransformer.fromJSON(
    {
      id: WEBVH_DID,
      alsoKnownAs: [WEB_DID],
      verificationMethod: [
        {
          id: ed25519MethodId,
          type: 'Multikey',
          controller: WEBVH_DID,
          publicKeyMultibase,
        },
        {
          id: certMethodId,
          type: 'JsonWebKey2020',
          controller: WEBVH_DID,
          publicKeyJwk: verifierCertificate.publicJwk.toJson(),
        },
      ],
      authentication: [ed25519MethodId, certMethodId],
      assertionMethod: [ed25519MethodId],
    },
    DidDocument,
  )

  const documents = new Map<string, DidDocument>([[WEBVH_DID, clone(didDocument)]])
  const registry = new WebvhStubRegistry(documents)

  const app = express()
  const server = await new Promise<Server>((resolve, reject) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started))
    started.on('error', reject)
  })
  cleanups.push(async () => {
    server.closeAllConnections?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server address')
  const publicApiBaseUrl = `http://127.0.0.1:${address.port}`

  const options = {
    publicApiBaseUrl,
    verifier: {
      signing: {
        configured: {
          certificateChain: [verifierCertificate.toString('base64'), certificates.root.toString('base64')],
          privateJwk: OTHER_PRIVATE_JWK,
        },
      },
    },
    trust: {
      resolverUrl: resolverStub.url,
      timeoutMs: 500,
      allowedDidWebHosts: ['verifier.example'],
      credentialIssuerCertificates: [certificates.root.toString('base64')],
    },
    credentialConfigurations: [CONFIGURATION],
    verifierPolicies: [
      {
        id: 'employee-check',
        credentialConfigurationId: CONFIGURATION.id,
        requestedClaims: ['name', 'role'],
      },
    ],
  }
  validateOpenId4VcOptions(options)
  let issuerService: IssuerService | undefined
  const sdkPlugin = setupOpenId4Vc(options, () => {
    if (!issuerService) throw new Error('OpenID4VC issuer service is not initialized')
    return issuerService
  })
  app.use(sdkPlugin.publicMiddleware)

  const logger = new ConsoleLogger(LogLevel.Off)
  const agent = new Agent({
    config: { logger, allowInsecureHttpUrls: true },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `webvh-pe-${utils.uuid()}`,
          key: ASKAR_STORE_KEY,
          keyDerivationMethod: 'raw',
          database: { type: 'sqlite', config: { inMemory: true } } as AskarSqliteStorageConfig,
        },
      }),
      dids: new DidsModule({
        resolvers: [new CachedWebDidResolver(), registry],
        registrars: [registry],
      }),
      ...sdkPlugin.modules,
    },
  }) as Agent & { did?: string }
  agent.did = WEBVH_DID
  await agent.initialize()
  cleanups.push(() => agent.shutdown())

  const imported = await agent.kms.importKey({
    privateJwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(publicKey).toString('base64url'),
      d: Buffer.from(secretKey).toString('base64url'),
    },
  })

  const didRecord = new DidRecord({
    did: WEBVH_DID,
    role: DidDocumentRole.Created,
    didDocument: clone(didDocument),
    keys: [{ didDocumentRelativeKeyId: `#${publicKeyMultibase}`, kmsKeyId: imported.keyId }],
  })
  didRecord.setTag('domain', 'verifier.example')
  await agent.dependencyManager.resolve(DidRepository).save(agent.context, didRecord)

  const service = new VerifierService(
    agent as unknown as OpenId4VcIssuerAgent & OpenId4VcVerifierAgent,
    options,
  )
  await service.ensureInitialized()

  const fetchRequestJwt = async (authorizationRequest: string) => {
    const url = new URL(authorizationRequest.replace('openid4vp://', 'https://x/'))
    const requestUri = url.searchParams.get('request_uri')
    if (!requestUri) throw new Error(`no request_uri in ${authorizationRequest}`)
    const jwt = await (await fetch(requestUri)).text()
    const [headerPart, payloadPart] = jwt.split('.')
    return {
      header: JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as {
        alg: string
        kid: string
      },
      // biome-ignore lint/suspicious/noExplicitAny: raw JWT payload probing
      payload: JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as any,
    }
  }

  return { service, fetchRequestJwt, ed25519MethodId }
}

const ISSUER_DID = 'did:web:issuer.example'
const VERIFIER_DID = 'did:web:verifier.example'
const TTL_SECONDS = 3_600

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
      const offer = await agents.issuer.service.createOffer({
        credentialConfigurationId: CONFIGURATION.id,
        claims: { name: 'Ada Lovelace', role: 'engineer' },
        ttlSeconds: TTL_SECONDS,
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
      TTL_SECONDS,
    )
    expect(storedCredential.prettyClaims).not.toHaveProperty('status')
    const records = await agents.holder.agent.sdJwtVc.getAll()
    expect(records).toHaveLength(1)
    expect(records[0].firstCredential.claimFormat).toBe('dc+sd-jwt')
  }, 60_000)

  it('lists, reads and deletes the issuance sessions of this issuer', async () => {
    const offer = await agents.issuer.service.createOffer({
      credentialConfigurationId: CONFIGURATION.id,
      claims: { name: 'Grace Hopper', role: 'admiral' },
      ttlSeconds: TTL_SECONDS,
    })

    const listed = await agents.issuer.service.listIssuanceSessions()
    expect(listed.map(session => session.id)).toContain(offer.issuanceSessionId)

    const read = await agents.issuer.service.getIssuanceSession(offer.issuanceSessionId)
    expect(read).toMatchObject({
      id: offer.issuanceSessionId,
      credentialConfigurationId: CONFIGURATION.id,
      state: 'OfferCreated',
    })
    expect(read.expiresAt).toBeInstanceOf(Date)
    expect(read).not.toHaveProperty('credentialOffer')

    await agents.issuer.service.deleteIssuanceSession(offer.issuanceSessionId)
    await expect(agents.issuer.service.getIssuanceSession(offer.issuanceSessionId)).rejects.toBeInstanceOf(
      UnknownIssuanceSessionError,
    )
  }, 60_000)

  it('presents the stored credential through DCQL and returns TRUSTED_AUTHORIZED', async () => {
    const exchange = await presentCredential()

    expect(exchange.resolved.authorizationRequestPayload.response_mode).toBe('direct_post.jwt')
    expect(exchange.resolved.dcql).toBeDefined()
    expect(exchange.submission.ok).toBe(true)
    expect(exchange.submission.serverResponse?.status).toBe(200)
    expect(
      await agents.verifier.service.getVerificationSession(exchange.verificationSessionId),
    ).toMatchObject({
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

  it('carries the policy id, stores the decision, and lets the verifier delete the session', async () => {
    const exchange = await presentCredential()

    const first = await agents.verifier.service.getVerificationSession(exchange.verificationSessionId)
    expect(first).toMatchObject({ policyId: 'employee-check', accepted: true })
    expect(first.createdAt).toBeInstanceOf(Date)

    resolver.reset()
    const second = await agents.verifier.service.getVerificationSession(exchange.verificationSessionId)
    expect(second).toMatchObject({ accepted: true, trust: { verdict: 'TRUSTED_AUTHORIZED' } })
    expect(resolver.requestCount).toBe(0)

    const listed = await agents.verifier.service.listVerificationSessions()
    expect(listed.map(session => session.id)).toContain(exchange.verificationSessionId)

    await agents.verifier.service.deleteVerificationSession(exchange.verificationSessionId)
    await expect(
      agents.verifier.service.getVerificationSession(exchange.verificationSessionId),
    ).rejects.toBeInstanceOf(UnknownVerificationSessionError)
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

      expect(
        await agents.verifier.service.getVerificationSession(exchange.verificationSessionId),
      ).toMatchObject({
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

      expect(
        await agents.verifier.service.getVerificationSession(exchange.verificationSessionId),
      ).toMatchObject({
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
    expect(
      await agents.verifier.service.getVerificationSession(exchange.verificationSessionId),
    ).toMatchObject({
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

    expect(
      await agents.verifier.service.getVerificationSession(exchange.verificationSessionId),
    ).toMatchObject({
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

describe('OpenID4VC test-agent startup cleanup', () => {
  it('closes the acquired server when plugin option creation fails', async () => {
    const primary = new Error('deliberate issuer options failure')
    await expectCleanStartupFailure(
      {
        beforeOptions: role => {
          if (role === 'issuer') throw primary
        },
      },
      primary,
    )
  })

  it('shuts down an acquired holder agent when holder initialization fails', async () => {
    const primary = new Error('deliberate holder initialization failure')
    await expectCleanStartupFailure(
      {
        afterInitialize: role => {
          if (role === 'holder') throw primary
        },
      },
      primary,
    )
  })

  it('closes verifier resources and reports cleanup failure without losing the startup error', async () => {
    const primary = new Error('deliberate verifier initialization failure')
    const cleanup = new Error('deliberate verifier cleanup failure')
    const outcome = await captureStartup({
      afterInitialize: role => {
        if (role === 'verifier') throw primary
      },
      afterCleanup: role => {
        if (role === 'verifier') throw cleanup
      },
    })

    expect(outcome.error).toBeInstanceOf(OpenId4VcTestStartupError)
    expect(outcome.error).toMatchObject({ cause: primary, cleanupErrors: [cleanup] })
    expect(outcome.after).toEqual(outcome.before)
  })
})

async function expectCleanStartupFailure(hooks: TestAgentFailureHooks, primary: Error): Promise<void> {
  const outcome = await captureStartup(hooks)
  expect(outcome.error).toBe(primary)
  expect(outcome.after).toEqual(outcome.before)
}

async function captureStartup(hooks: TestAgentFailureHooks): Promise<{
  before: string[]
  after: string[]
  error?: unknown
}> {
  const input = await startupInput()
  const before = activeTcpServers()
  let error: unknown
  const started = await startOpenId4VcTestAgents({ ...input, failureHooks: hooks }).catch(cause => {
    error = cause
    return undefined
  })
  await started?.stop()
  await new Promise(resolve => setImmediate(resolve))
  return { before, after: activeTcpServers(), error }
}

async function startupInput() {
  const certificates = await createCertificateFixtures()
  const verifierCertificate = await createVerifierCertificate(certificates.root, VERIFIER_DID)
  const documents = new Map<string, DidDocument>()
  documents.set(
    ISSUER_DID,
    didDocumentWithKey(ISSUER_DID, certificates.leaf.publicJwk.toJson(), ['assertionMethod']),
  )
  documents.set(
    VERIFIER_DID,
    didDocumentWithKey(VERIFIER_DID, verifierCertificate.publicJwk.toJson(), ['authentication']),
  )
  return {
    certificates,
    verifierCertificate,
    didResolver: new MapDidResolver(documents),
    resolverUrl: 'http://127.0.0.1:9/v1/trust',
    issuerDid: ISSUER_DID,
    verifierDid: VERIFIER_DID,
    credentialConfiguration: CONFIGURATION,
  }
}
