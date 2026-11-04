import { IndexerHandlerRegistry, ParticipantState } from '@verana-labs/vs-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IssuerCredentialDefinitions } from '../src/utils/issuerCredentialDefinitions'

const { classifyEcsSchema, resolveJsonSchemaCredentialId } = vi.hoisted(() => ({
  classifyEcsSchema: vi.fn(),
  resolveJsonSchemaCredentialId: vi.fn(),
}))

vi.mock('@verana-labs/vs-agent-model', () => ({ classifyEcsSchema }))
vi.mock('@verana-labs/vs-agent-sdk', async importOriginal => ({
  ...(await importOriginal<object>()),
  resolveJsonSchemaCredentialId,
}))

const AGENT_DID = 'did:webvh:abc:issuer.example'
const AGENT_ACCOUNT = 'verana1agent'

const entry = (id: number, schemaId: number, extra: Record<string, unknown> = {}) => ({
  id,
  schema_id: schemaId,
  did: AGENT_DID,
  role: 'ISSUER',
  vs_operator: AGENT_ACCOUNT,
  revoked: null,
  slashed: null,
  modified: '2026-11-04T00:00:00Z',
  ...extra,
})

describe('IssuerCredentialDefinitions', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const agent = { did: AGENT_DID, veranaChain: { address: AGENT_ACCOUNT, getChainId: 'vna-testnet-1' } }
  let active: unknown[]
  let future: unknown[]
  let indexer: { listParticipants: ReturnType<typeof vi.fn>; getCredentialSchema: ReturnType<typeof vi.fn> }
  let registrar: {
    findAnonCredsCredentialDefinition: ReturnType<typeof vi.fn>
    getOrRegisterAnonCredsSchema: ReturnType<typeof vi.fn>
    registerAnonCredsCredentialDefinition: ReturnType<typeof vi.fn>
  }

  const build = () => new IssuerCredentialDefinitions(agent as any, indexer as any, registrar, logger)

  beforeEach(() => {
    vi.clearAllMocks()
    active = []
    future = []
    indexer = {
      listParticipants: vi.fn(async ({ participantState }) =>
        participantState === ParticipantState.Active ? active : future,
      ),
      getCredentialSchema: vi.fn(async (id: number) => ({ id, json_schema: `{"title":"S${id}"}` })),
    }
    registrar = {
      findAnonCredsCredentialDefinition: vi.fn(async () => undefined),
      getOrRegisterAnonCredsSchema: vi.fn(async () => ({
        schema: { name: 'S', version: '1.0' },
        schemaId: 'schema-1',
      })),
      registerAnonCredsCredentialDefinition: vi.fn(async () => ({})),
    }
    classifyEcsSchema.mockResolvedValue(null)
    resolveJsonSchemaCredentialId.mockImplementation(
      async (_a: unknown, _i: unknown, schemaId: number) =>
        `https://eco.example/vt/schemas-${schemaId}-jsc.json`,
    )
  })

  it('creates the credential definition of an active ISSUER entry', async () => {
    active = [entry(10, 7)]
    await build().reconcile()
    expect(registrar.registerAnonCredsCredentialDefinition).toHaveBeenCalledWith({
      name: 'S',
      version: '1.0',
      schemaId: 'schema-1',
      supportRevocation: false,
      relatedJsonSchemaCredentialId: 'https://eco.example/vt/schemas-7-jsc.json',
    })
  })

  it('keeps an existing credential definition', async () => {
    active = [entry(10, 7)]
    registrar.findAnonCredsCredentialDefinition.mockResolvedValue({ credentialDefinitionId: 'cd' })
    await build().reconcile()
    expect(registrar.registerAnonCredsCredentialDefinition).not.toHaveBeenCalled()
  })

  it('skips ECS schemas, revoked entries and entries of another vs_operator', async () => {
    active = [
      entry(10, 7),
      entry(11, 8, { revoked: '2026-11-01T00:00:00Z' }),
      entry(12, 9, { vs_operator: 'verana1other' }),
    ]
    classifyEcsSchema.mockResolvedValue('service')
    await build().reconcile()
    expect(registrar.registerAnonCredsCredentialDefinition).not.toHaveBeenCalled()
    expect(indexer.getCredentialSchema).toHaveBeenCalledTimes(1)
  })

  it('logs and goes on when the VTJSC cannot be resolved yet', async () => {
    active = [entry(10, 7), entry(11, 8)]
    resolveJsonSchemaCredentialId.mockRejectedValueOnce(new Error('not published'))
    await build().reconcile()
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(registrar.registerAnonCredsCredentialDefinition).toHaveBeenCalledOnce()
  })

  it('runs again shortly after a future entry becomes active', async () => {
    vi.useFakeTimers()
    try {
      future = [entry(10, 7, { effective_from: new Date(Date.now() + 20_000).toISOString() })]
      const service = build()
      await service.reconcile()
      expect(registrar.registerAnonCredsCredentialDefinition).not.toHaveBeenCalled()
      active = future
      future = []
      await vi.advanceTimersByTimeAsync(26_000)
      expect(registrar.registerAnonCredsCredentialDefinition).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconciles after the handler already registered for a ready message', async () => {
    const registry = new IndexerHandlerRegistry()
    const original = vi.fn(async () => undefined)
    registry.register({ msg: 'SetParticipantOPToValidated', handle: original })
    active = [entry(10, 7)]
    build().registerHandlers(registry)
    await registry.get('SetParticipantOPToValidated')?.handle({} as any, {} as any)
    expect(original).toHaveBeenCalledOnce()
    expect(registrar.registerAnonCredsCredentialDefinition).toHaveBeenCalledOnce()
  })
})
