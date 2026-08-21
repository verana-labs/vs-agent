import type { VeranaIndexerService } from '../src/blockchain'

import { describe, expect, it, vi } from 'vitest'

import { ParticipantRole, ParticipantState } from '../src/blockchain'
import { allowEcsIssuanceExemption } from '../src/vtFlow/allowEcsIssuanceExemption'

const OWN_DID = 'did:web:validator'
const PEER_DID = 'did:web:applicant'
const ECOSYSTEM_DID = 'did:web:ecosystem'

const orgSchema = {
  id: 4,
  ecosystem_id: 1,
  json_schema: JSON.stringify({ title: 'OrganizationCredential', type: 'object' }),
  archived: null,
}
const serviceSchema = {
  id: 5,
  ecosystem_id: 1,
  json_schema: JSON.stringify({ title: 'ServiceCredential', type: 'object' }),
  archived: null,
}
const badgeSchema = {
  id: 6,
  ecosystem_id: 1,
  json_schema: JSON.stringify({ title: 'BadgeCredential', type: 'object' }),
  archived: null,
}

const pendingParticipant = {
  id: 42,
  schema_id: orgSchema.id,
  did: PEER_DID,
  role: ParticipantRole.Holder,
  op_state: 'PENDING',
  revoked: null,
  slashed: null,
  validator_participant_id: 7,
}
const ownIssuerParticipant = {
  id: 7,
  schema_id: orgSchema.id,
  did: OWN_DID,
  role: ParticipantRole.Issuer,
  participant_state: ParticipantState.Active,
  revoked: null,
  slashed: null,
}

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function makeIndexer(overrides: Record<string, unknown> = {}) {
  return {
    getParticipant: vi.fn(async (id: string | number) => {
      if (Number(id) === pendingParticipant.id) return pendingParticipant
      if (Number(id) === ownIssuerParticipant.id) return ownIssuerParticipant
      throw new Error(`unknown participant ${id}`)
    }),
    getCredentialSchema: vi.fn(async (id: string | number) => {
      const schema = [orgSchema, serviceSchema, badgeSchema].find(s => s.id === Number(id))
      if (!schema) throw new Error(`unknown schema ${id}`)
      return schema
    }),
    getEcosystem: vi.fn().mockResolvedValue({ id: 1, did: ECOSYSTEM_DID, archived: null }),
    listParticipants: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as VeranaIndexerService
}

function makeHook(indexer: VeranaIndexerService, trustedEcosystemDids?: string[]) {
  return allowEcsIssuanceExemption({
    indexer,
    ownDid: () => OWN_DID,
    trustedEcosystemDids: trustedEcosystemDids ?? [ECOSYSTEM_DID],
    logger: logger as never,
  })
}

function onboarding(participantId = '42') {
  return { agentContext: {} as never, peerDid: PEER_DID, purpose: { participantId } }
}

describe('allowEcsIssuanceExemption: onboarding request', () => {
  it('grants the exemption for a PENDING participant this agent validates on an ECS schema', async () => {
    const hook = makeHook(makeIndexer())

    await expect(hook(onboarding())).resolves.toBe(true)
  })

  it('denies a participant entry that belongs to another DID', async () => {
    const indexer = makeIndexer({
      getParticipant: vi.fn().mockResolvedValue({ ...pendingParticipant, did: 'did:web:someone-else' }),
    })

    await expect(makeHook(indexer)(onboarding())).resolves.toBe(false)
  })

  it('denies a participant entry that is not PENDING', async () => {
    const indexer = makeIndexer({
      getParticipant: vi.fn().mockResolvedValue({ ...pendingParticipant, op_state: 'VALIDATED' }),
    })

    await expect(makeHook(indexer)(onboarding())).resolves.toBe(false)
  })

  it('denies an onboarding validated by a different agent', async () => {
    const indexer = makeIndexer({
      getParticipant: vi.fn(async (id: string | number) =>
        Number(id) === pendingParticipant.id
          ? pendingParticipant
          : { ...ownIssuerParticipant, did: 'did:web:other-validator' },
      ),
    })

    await expect(makeHook(indexer)(onboarding())).resolves.toBe(false)
  })

  it('denies a schema that is not an ECS Organization, Persona or Service schema', async () => {
    const indexer = makeIndexer({
      getParticipant: vi.fn(async (id: string | number) =>
        Number(id) === pendingParticipant.id
          ? { ...pendingParticipant, schema_id: badgeSchema.id }
          : ownIssuerParticipant,
      ),
    })

    await expect(makeHook(indexer)(onboarding())).resolves.toBe(false)
  })

  it('denies an ECS schema from an ecosystem outside the allowlist', async () => {
    const hook = makeHook(makeIndexer(), ['did:web:another-ecosystem'])

    await expect(hook(onboarding())).resolves.toBe(false)
  })

  it('denies while the agent has not resolved its own DID yet', async () => {
    const indexer = makeIndexer()
    const hook = allowEcsIssuanceExemption({
      indexer,
      ownDid: () => undefined,
      trustedEcosystemDids: [ECOSYSTEM_DID],
      logger: logger as never,
    })

    await expect(hook(onboarding())).resolves.toBe(false)
    expect(indexer.getParticipant).not.toHaveBeenCalled()
  })

  it.each([
    '1/../../v4/ecosystem/list',
    '1abc',
    '',
    '-1',
    '1.5',
  ])('denies the malformed participant id %j without querying the indexer', async participantId => {
    const indexer = makeIndexer()

    await expect(makeHook(indexer)(onboarding(participantId))).resolves.toBe(false)
    expect(indexer.getParticipant).not.toHaveBeenCalled()
  })

  it('denies and logs when the indexer cannot be reached', async () => {
    const indexer = makeIndexer({
      getParticipant: vi.fn().mockRejectedValue(new Error('indexer unreachable')),
    })

    await expect(makeHook(indexer)(onboarding())).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('indexer unreachable'))
  })
})

describe('allowEcsIssuanceExemption: direct issuance request', () => {
  const issuance = (schemaId: string) => ({
    agentContext: {} as never,
    peerDid: PEER_DID,
    purpose: { schemaId },
  })

  it('grants the exemption when this agent is an active ISSUER of the ECS Service schema', async () => {
    const indexer = makeIndexer({
      listParticipants: vi.fn().mockResolvedValue([{ ...ownIssuerParticipant, schema_id: serviceSchema.id }]),
    })

    await expect(makeHook(indexer)(issuance(String(serviceSchema.id)))).resolves.toBe(true)
  })

  it('denies a schema this agent does not issue', async () => {
    await expect(makeHook(makeIndexer())(issuance(String(serviceSchema.id)))).resolves.toBe(false)
  })

  it('denies a revoked ISSUER participant', async () => {
    const indexer = makeIndexer({
      listParticipants: vi
        .fn()
        .mockResolvedValue([{ ...ownIssuerParticipant, schema_id: serviceSchema.id, revoked: '2026-01-01' }]),
    })

    await expect(makeHook(indexer)(issuance(String(serviceSchema.id)))).resolves.toBe(false)
  })

  it('denies a malformed schema id without querying the indexer', async () => {
    const indexer = makeIndexer()

    await expect(makeHook(indexer)(issuance('5/../../v4/ecosystem/list'))).resolves.toBe(false)
    expect(indexer.listParticipants).not.toHaveBeenCalled()
  })

  it('denies a request that carries no purpose the exemption can anchor on', async () => {
    const hook = makeHook(makeIndexer())

    await expect(hook({ agentContext: {} as never, peerDid: PEER_DID, purpose: {} })).resolves.toBe(false)
  })
})
