import { describe, expect, it } from 'vitest'

import { VtFlowRole, VtFlowState, VtFlowTerminalStates, VtFlowVariant, isVtFlowTerminalState } from '../src'

describe('VtFlowRole', () => {
  it('defines the two party roles from the spec', () => {
    expect(Object.values(VtFlowRole).sort()).toEqual(['applicant', 'validator'])
  })
})

describe('VtFlowVariant', () => {
  it('defines the two flow variants from §5.1 and §5.2', () => {
    expect(Object.values(VtFlowVariant).sort()).toEqual(['direct-issuance', 'validation-process'])
  })
})

describe('VtFlowState', () => {
  // The spec lists these verbatim in `doc/vt-flow-protocol.md` §States => Flow
  // State. Keeping the test assertion explicit ensures any future addition
  // or rename is visible in the diff.
  const expectedFlowStates = [
    'AWAITING_VP',
    'VR_SENT',
    'AWAITING_VR',
    'IR_SENT',
    'AWAITING_IR',
    'OOB_PENDING',
    'VALIDATING',
    'VALIDATED',
    'CRED_OFFERED',
    'COMPLETED',
    'CRED_REVOKED',
    'TERMINATED_BY_VALIDATOR',
    'TERMINATED_BY_APPLICANT',
    'ERROR',
    'PERM_REVOKED',
    'PERM_SLASHED',
  ]

  it('enumerates every Flow State from the spec', () => {
    expect(Object.values(VtFlowState).sort()).toEqual(expectedFlowStates.slice().sort())
  })

  it('uses SCREAMING_SNAKE_CASE wire values', () => {
    for (const value of Object.values(VtFlowState)) {
      expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it('flags the five terminal states and only those', () => {
    const terminals = Array.from(VtFlowTerminalStates).sort()
    expect(terminals).toEqual(
      [
        VtFlowState.TerminatedByValidator,
        VtFlowState.TerminatedByApplicant,
        VtFlowState.Error,
        VtFlowState.PermRevoked,
        VtFlowState.PermSlashed,
      ].sort(),
    )
  })

  it.each([
    [VtFlowState.TerminatedByValidator, true],
    [VtFlowState.TerminatedByApplicant, true],
    [VtFlowState.Error, true],
    [VtFlowState.PermRevoked, true],
    [VtFlowState.PermSlashed, true],
    [VtFlowState.AwaitingVp, false],
    [VtFlowState.VrSent, false],
    [VtFlowState.Validating, false],
    [VtFlowState.Completed, false],
    [VtFlowState.CredRevoked, false],
  ])('isVtFlowTerminalState(%s) === %s', (state, expected) => {
    expect(isVtFlowTerminalState(state)).toBe(expected)
  })
})
