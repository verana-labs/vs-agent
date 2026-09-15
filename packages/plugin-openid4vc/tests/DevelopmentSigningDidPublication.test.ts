import type { OpenId4VcPluginOptions } from '../src/types'
import type {
  AgentContext,
  DidCreateResult,
  DidDeactivateResult,
  DidResolutionResult,
  DidUpdateOptions,
  DidUpdateResult,
} from '@credo-ts/core'

import { AskarModule, type AskarSqliteStorageConfig } from '@credo-ts/askar'
import {
  Agent,
  ConsoleLogger,
  DidDocument,
  DidDocumentRole,
  DidRecord,
  DidRepository,
  DidsModule,
  JsonTransformer,
  LogLevel,
  utils,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { afterEach, describe, expect, it } from 'vitest'

import { validateOpenId4VcOptions } from '../src/config'
import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'
import { IssuerService, type OpenId4VcIssuerAgent } from '../src/services/IssuerService'
import { VerifierService, type OpenId4VcVerifierAgent } from '../src/services/VerifierService'

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

const agents: TestAgent[] = []

afterEach(async () => {
  await Promise.all(agents.splice(0).map(agent => agent.shutdown()))
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

  it('publishes the issuer key under authentication as well when metadataSigner is did', async () => {
    const { initialize, registry } = await createHarness('issuer', DID_WEB, { metadataSigner: 'did' })

    await initialize()

    const document = registry.document(DID_WEB)
    const methodId = `${DID_WEB}#openid4vc-development-issuer`
    expect(relationshipIds(document.assertionMethod)).toContain(methodId)
    expect(relationshipIds(document.authentication)).toContain(methodId)
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
  issuerOverrides: Partial<NonNullable<OpenId4VcPluginOptions['issuer']>> = {},
): Promise<{
  agent: TestAgent
  initialize: () => Promise<void>
  registry: MutableDidRegistry
}> {
  const options = developmentOptions(role)
  if (options.issuer) Object.assign(options.issuer, issuerOverrides)
  validateOpenId4VcOptions(options)

  let issuerService: IssuerService | undefined
  const sdkPlugin = setupOpenId4Vc(options, () => {
    if (!issuerService) throw new Error('OpenID4VC issuer service is not initialized')
    return issuerService
  })

  const registry = new MutableDidRegistry(new Map([[did, initialDidDocument(did)]]))
  const agent = new Agent({
    config: { logger: new ConsoleLogger(LogLevel.Off) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `openid4vc-development-${utils.uuid()}`,
          key: ASKAR_STORE_KEY,
          keyDerivationMethod: 'raw',
          database: { type: 'sqlite', config: { inMemory: true } } as AskarSqliteStorageConfig,
        },
      }),
      dids: new DidsModule({ resolvers: [registry], registrars: [registry] }),
      ...sdkPlugin.modules,
    },
  }) as TestAgent
  agent.did = did
  await agent.initialize()
  await agent.dependencyManager
    .resolve(DidRepository)
    .save(
      agent.context,
      new DidRecord({ did, role: DidDocumentRole.Created, didDocument: initialDidDocument(did) }),
    )
  agents.push(agent)

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

function developmentOptions(role: Role): OpenId4VcPluginOptions {
  return {
    publicApiBaseUrl: 'https://agent.example',
    ...(role !== 'verifier'
      ? {
          issuer: {
            id: 'issuer',
            displayName: 'Development Issuer',
            signing: { development: { enabled: true as const, commonName: 'Development Issuer' } },
          },
        }
      : {}),
    ...(role !== 'issuer'
      ? {
          verifier: {
            id: 'verifier',
            displayName: 'Development Verifier',
            signing: { development: { enabled: true as const, commonName: 'Development Verifier' } },
          },
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
