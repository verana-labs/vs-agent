import { CredoError, utils } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import { VtFlowRole, VtFlowState, VtFlowVariant } from '../src'
import { VtFlowRecord } from '../src/repository'

function makeRecord(overrides: Partial<ConstructorParameters<typeof VtFlowRecord>[0]> = {}) {
  return new VtFlowRecord({
    threadId: utils.uuid(),
    participantSessionId: utils.uuid(),
    connectionId: utils.uuid(),
    role: VtFlowRole.Applicant,
    state: VtFlowState.OrSent,
    variant: VtFlowVariant.OnboardingProcess,
    agentParticipantId: 'agent-participant-1',
    walletAgentParticipantId: 'wallet-agent-participant-1',
    participantId: 'participant-42',
    ...overrides,
  })
}

describe('VtFlowRecord', () => {
  it('stores all constructor fields', () => {
    const record = makeRecord({
      claims: { country: 'FR' },
      subprotocolThid: 'sub-thid-xyz',
      credentialExchangeRecordId: 'cred-xchg-1',
      errorMessage: undefined,
    })

    expect(record.threadId).toBeDefined()
    expect(record.participantSessionId).toBeDefined()
    expect(record.connectionId).toBeDefined()
    expect(record.role).toBe(VtFlowRole.Applicant)
    expect(record.state).toBe(VtFlowState.OrSent)
    expect(record.variant).toBe(VtFlowVariant.OnboardingProcess)
    expect(record.agentParticipantId).toBe('agent-participant-1')
    expect(record.walletAgentParticipantId).toBe('wallet-agent-participant-1')
    expect(record.participantId).toBe('participant-42')
    expect(record.claims).toEqual({ country: 'FR' })
    expect(record.subprotocolThid).toBe('sub-thid-xyz')
    expect(record.credentialExchangeRecordId).toBe('cred-xchg-1')
    expect(record.errorMessage).toBeUndefined()
    expect(record.type).toBe('VtFlowRecord')
    expect(VtFlowRecord.type).toBe('VtFlowRecord')
  })

  it('generates an id and createdAt when not provided', () => {
    const before = new Date()
    const record = makeRecord()
    const after = new Date()

    expect(record.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(record.createdAt).toBeInstanceOf(Date)
    expect(record.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(record.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  describe('getTags', () => {
    it('includes every field declared in DefaultVtFlowTags', () => {
      const record = makeRecord({
        credentialExchangeRecordId: 'cred-xchg-99',
        subprotocolThid: 'sub-thid-99',
      })
      const tags = record.getTags()

      expect(tags.threadId).toBe(record.threadId)
      expect(tags.participantSessionId).toBe(record.participantSessionId)
      expect(tags.connectionId).toBe(record.connectionId)
      expect(tags.role).toBe(VtFlowRole.Applicant)
      expect(tags.flowState).toBe(VtFlowState.OrSent)
      expect(tags.flowVariant).toBe(VtFlowVariant.OnboardingProcess)
      expect(tags.participantId).toBe('participant-42')
      expect(tags.schemaId).toBeUndefined()
      expect(tags.credentialExchangeRecordId).toBe('cred-xchg-99')
      expect(tags.subprotocolThid).toBe('sub-thid-99')
    })

    it('surfaces variant-specific identifiers correctly', () => {
      const onboarding = makeRecord({
        variant: VtFlowVariant.OnboardingProcess,
        participantId: 'participant-abc',
        schemaId: undefined,
      })
      expect(onboarding.getTags().participantId).toBe('participant-abc')
      expect(onboarding.getTags().schemaId).toBeUndefined()

      const direct = makeRecord({
        variant: VtFlowVariant.DirectIssuance,
        state: VtFlowState.IrSent,
        participantId: undefined,
        schemaId: 'vpr:schema:xyz',
      })
      expect(direct.getTags().participantId).toBeUndefined()
      expect(direct.getTags().schemaId).toBe('vpr:schema:xyz')
    })

    it('merges custom tags with default tags', () => {
      const record = makeRecord({ tags: { tenant: 'acme', environment: 'staging' } })
      const tags = record.getTags()

      expect(tags.tenant).toBe('acme')
      expect(tags.environment).toBe('staging')
      // Default tags still present.
      expect(tags.threadId).toBeDefined()
    })
  })

  describe('assertRole', () => {
    it('does not throw when the role matches', () => {
      const record = makeRecord({ role: VtFlowRole.Validator })
      expect(() => record.assertRole(VtFlowRole.Validator)).not.toThrow()
    })

    it('throws CredoError when the role mismatches', () => {
      const record = makeRecord({ role: VtFlowRole.Applicant })
      expect(() => record.assertRole(VtFlowRole.Validator)).toThrowError(CredoError)
    })
  })

  describe('assertState', () => {
    it('accepts a single expected state', () => {
      const record = makeRecord({ state: VtFlowState.OrSent })
      expect(() => record.assertState(VtFlowState.OrSent)).not.toThrow()
    })

    it('accepts an array of expected states', () => {
      const record = makeRecord({ state: VtFlowState.Validating })
      expect(() => record.assertState([VtFlowState.Validating, VtFlowState.Validated])).not.toThrow()
    })

    it('throws when no expected state matches', () => {
      const record = makeRecord({ state: VtFlowState.Completed })
      expect(() => record.assertState([VtFlowState.OrSent, VtFlowState.IrSent])).toThrowError(
        /invalid state|valid states/i,
      )
    })
  })

  describe('assertVariant', () => {
    it('accepts the matching variant', () => {
      const record = makeRecord({ variant: VtFlowVariant.DirectIssuance })
      expect(() => record.assertVariant(VtFlowVariant.DirectIssuance)).not.toThrow()
    })

    it('rejects a mismatched variant', () => {
      const record = makeRecord({ variant: VtFlowVariant.OnboardingProcess })
      expect(() => record.assertVariant(VtFlowVariant.DirectIssuance)).toThrow(CredoError)
    })
  })
})
