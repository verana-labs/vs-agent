import { CredoError, utils } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import { VtFlowRole, VtFlowState, VtFlowVariant } from '../src'
import { VtFlowRecord } from '../src/repository'

function makeRecord(overrides: Partial<ConstructorParameters<typeof VtFlowRecord>[0]> = {}) {
  return new VtFlowRecord({
    threadId: utils.uuid(),
    sessionUuid: utils.uuid(),
    connectionId: utils.uuid(),
    role: VtFlowRole.Applicant,
    state: VtFlowState.VrSent,
    variant: VtFlowVariant.ValidationProcess,
    agentPermId: 'agent-perm-1',
    walletAgentPermId: 'wallet-agent-perm-1',
    permId: 'perm-42',
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
    expect(record.sessionUuid).toBeDefined()
    expect(record.connectionId).toBeDefined()
    expect(record.role).toBe(VtFlowRole.Applicant)
    expect(record.state).toBe(VtFlowState.VrSent)
    expect(record.variant).toBe(VtFlowVariant.ValidationProcess)
    expect(record.agentPermId).toBe('agent-perm-1')
    expect(record.walletAgentPermId).toBe('wallet-agent-perm-1')
    expect(record.permId).toBe('perm-42')
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
      expect(tags.sessionUuid).toBe(record.sessionUuid)
      expect(tags.connectionId).toBe(record.connectionId)
      expect(tags.role).toBe(VtFlowRole.Applicant)
      expect(tags.flowState).toBe(VtFlowState.VrSent)
      expect(tags.flowVariant).toBe(VtFlowVariant.ValidationProcess)
      expect(tags.permId).toBe('perm-42')
      expect(tags.schemaId).toBeUndefined()
      expect(tags.credentialExchangeRecordId).toBe('cred-xchg-99')
      expect(tags.subprotocolThid).toBe('sub-thid-99')
    })

    it('surfaces variant-specific identifiers correctly', () => {
      const valProc = makeRecord({
        variant: VtFlowVariant.ValidationProcess,
        permId: 'perm-abc',
        schemaId: undefined,
      })
      expect(valProc.getTags().permId).toBe('perm-abc')
      expect(valProc.getTags().schemaId).toBeUndefined()

      const direct = makeRecord({
        variant: VtFlowVariant.DirectIssuance,
        state: VtFlowState.IrSent,
        permId: undefined,
        schemaId: 'vpr:schema:xyz',
      })
      expect(direct.getTags().permId).toBeUndefined()
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
      const record = makeRecord({ state: VtFlowState.VrSent })
      expect(() => record.assertState(VtFlowState.VrSent)).not.toThrow()
    })

    it('accepts an array of expected states', () => {
      const record = makeRecord({ state: VtFlowState.Validating })
      expect(() => record.assertState([VtFlowState.Validating, VtFlowState.Validated])).not.toThrow()
    })

    it('throws when no expected state matches', () => {
      const record = makeRecord({ state: VtFlowState.Completed })
      expect(() => record.assertState([VtFlowState.VrSent, VtFlowState.IrSent])).toThrowError(
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
      const record = makeRecord({ variant: VtFlowVariant.ValidationProcess })
      expect(() => record.assertVariant(VtFlowVariant.DirectIssuance)).toThrow(CredoError)
    })
  })
})
