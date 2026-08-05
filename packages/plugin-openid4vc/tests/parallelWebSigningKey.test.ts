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

import {
  asParallelDidWeb,
  PARALLEL_WEB_SIGNING_KEY_FRAGMENT,
  publishParallelWebSigningKey,
} from '../src/trust/parallelWebSigningKey'

const DID_WEBVH = 'did:webvh:QmYwAPJzv5CZsnAzt8auVZRnGi2C9AwBypHj6yQVB5hJiJ:agent.example'
const DID_WEB = 'did:web:agent.example'
const SOURCE_METHOD_SUFFIX = 'z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const SOURCE_MULTIBASE = 'z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const SOURCE_KMS_KEY_ID = 'kms-key-for-didcomm-ed25519'
const ASKAR_STORE_KEY = 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa'

type TestAgent = Agent & { did?: string }

class MutableDidRegistry {
  public readonly supportedMethods = ['web', 'webvh']
  public readonly allowsCaching = false
  public readonly allowsLocalDidRecord = false
  public updateCount = 0

  public constructor(private readonly documents: Map<string, DidDocument>) {}

  public async resolve(_agentContext: AgentContext, did: string): Promise<DidResolutionResult> {
    const stored = this.documents.get(did)
    if (!stored) {
      return { didDocument: null, didDocumentMetadata: {}, didResolutionMetadata: { error: 'notFound' } }
    }
    return { didDocument: clone(stored), didDocumentMetadata: {}, didResolutionMetadata: {} }
  }

  public async update(agentContext: AgentContext, options: DidUpdateOptions): Promise<DidUpdateResult> {
    this.updateCount += 1
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
    return clone(document)
  }
}

const agents: TestAgent[] = []

afterEach(async () => {
  await Promise.all(agents.splice(0).map(agent => agent.shutdown()))
})

describe('asParallelDidWeb', () => {
  it('maps a did:webvh and its did urls onto the parallel did:web', () => {
    expect(asParallelDidWeb(DID_WEBVH)).toBe(DID_WEB)
    expect(asParallelDidWeb(`${DID_WEBVH}#key-1`)).toBe(`${DID_WEB}#key-1`)
  })

  it('returns anything that is not a did:webvh unchanged', () => {
    expect(asParallelDidWeb(DID_WEB)).toBe(DID_WEB)
    expect(asParallelDidWeb('did:key:z6Mk')).toBe('did:key:z6Mk')
  })
})

describe('publishParallelWebSigningKey', () => {
  it('publishes the Ed25519 authentication key under the parallel did:web name, appended last', async () => {
    const { agent, registry } = await createHarness(DID_WEBVH)

    const didUrl = await publishParallelWebSigningKey(agent, 5_000)

    const methodId = `${DID_WEB}${PARALLEL_WEB_SIGNING_KEY_FRAGMENT}`
    expect(didUrl).toBe(methodId)

    const document = registry.document(DID_WEBVH)
    const methods = document.verificationMethod ?? []
    const published = methods[methods.length - 1]
    expect(published?.id).toBe(methodId)
    expect(published?.type).toBe('Multikey')
    expect(published?.controller).toBe(DID_WEBVH)
    expect(published?.publicKeyMultibase).toBe(SOURCE_MULTIBASE)

    const relationshipIds = (document.authentication ?? []).map(entry =>
      typeof entry === 'string' ? entry : entry.id,
    )
    expect(relationshipIds).not.toContain(methodId)

    expect(await createdDidRecordKeys(agent)).toContainEqual({
      didDocumentRelativeKeyId: PARALLEL_WEB_SIGNING_KEY_FRAGMENT,
      kmsKeyId: SOURCE_KMS_KEY_ID,
    })
  })

  it('does not publish again when the method already exists', async () => {
    const { agent, registry } = await createHarness(DID_WEBVH)

    await publishParallelWebSigningKey(agent, 5_000)
    const didUrl = await publishParallelWebSigningKey(agent, 5_000)

    expect(didUrl).toBe(`${DID_WEB}${PARALLEL_WEB_SIGNING_KEY_FRAGMENT}`)
    expect(registry.updateCount).toBe(1)
  })

  it('returns undefined for an agent that is not did:webvh', async () => {
    const { agent, registry } = await createHarness(DID_WEB)

    expect(await publishParallelWebSigningKey(agent, 5_000)).toBeUndefined()
    expect(registry.updateCount).toBe(0)
  })

  it('returns undefined without publishing when the record has no key mapping for the method', async () => {
    const { agent, registry } = await createHarness(DID_WEBVH, { seedKeyMapping: false })

    expect(await publishParallelWebSigningKey(agent, 5_000)).toBeUndefined()
    expect(registry.updateCount).toBe(0)
    expect(await createdDidRecordKeys(agent)).toBeUndefined()
  })
})

async function createHarness(
  did: string,
  { seedKeyMapping = true }: { seedKeyMapping?: boolean } = {},
): Promise<{ agent: TestAgent; registry: MutableDidRegistry }> {
  const registry = new MutableDidRegistry(new Map([[did, initialDidDocument(did)]]))
  const agent = new Agent({
    config: { logger: new ConsoleLogger(LogLevel.Off) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `parallel-web-signing-${utils.uuid()}`,
          key: ASKAR_STORE_KEY,
          keyDerivationMethod: 'raw',
          database: { type: 'sqlite', config: { inMemory: true } } as AskarSqliteStorageConfig,
        },
      }),
      dids: new DidsModule({ resolvers: [registry], registrars: [registry] }),
    },
  }) as TestAgent
  agent.did = did
  await agent.initialize()
  await agent.dependencyManager.resolve(DidRepository).save(
    agent.context,
    new DidRecord({
      did,
      role: DidDocumentRole.Created,
      didDocument: initialDidDocument(did),
      keys: seedKeyMapping
        ? [{ didDocumentRelativeKeyId: `#${SOURCE_METHOD_SUFFIX}`, kmsKeyId: SOURCE_KMS_KEY_ID }]
        : undefined,
    }),
  )
  agents.push(agent)
  return { agent, registry }
}

function initialDidDocument(did: string): DidDocument {
  const methodId = `${did}#${SOURCE_METHOD_SUFFIX}`
  return JsonTransformer.fromJSON(
    {
      id: did,
      verificationMethod: [
        {
          id: methodId,
          type: 'Multikey',
          controller: did,
          publicKeyMultibase: SOURCE_MULTIBASE,
        },
      ],
      authentication: [methodId],
      assertionMethod: [methodId],
    },
    DidDocument,
  )
}

async function createdDidRecordKeys(agent: TestAgent) {
  const record = await agent.dependencyManager
    .resolve(DidRepository)
    .findCreatedDid(agent.context, agent.did as string)
  return record?.keys
}

function clone(document: DidDocument): DidDocument {
  return JsonTransformer.fromJSON(document.toJSON(), DidDocument)
}
