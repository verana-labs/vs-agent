import { DidCommDidExchangeState } from '@credo-ts/didcomm'
import { describe, expect, it } from 'vitest'

import {
  VtFlowConnectionState,
  VtFlowRole,
  VtFlowState,
  VtFlowTerminalStates,
  VtFlowVariant,
  connectionStateFromDidExchangeState,
  isVtFlowTerminalState,
} from '../src'

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

describe('VtFlowConnectionState', () => {
  it('defines the three-value abstraction from the spec', () => {
    expect(Object.values(VtFlowConnectionState).sort()).toEqual([
      'ESTABLISHED',
      'NOT_CONNECTED',
      'TERMINATED',
    ])
  })

  // The mapping table below mirrors `doc/vt-flow-implementation.md` §Connection
  // state mapping. Any divergence between this test and that document is a
  // spec bug in one or the other — fix them together.
  const cases: Array<[DidCommDidExchangeState, VtFlowConnectionState]> = [
    [DidCommDidExchangeState.Start, VtFlowConnectionState.NotConnected],
    [DidCommDidExchangeState.InvitationSent, VtFlowConnectionState.NotConnected],
    [DidCommDidExchangeState.InvitationReceived, VtFlowConnectionState.NotConnected],
    [DidCommDidExchangeState.RequestSent, VtFlowConnectionState.NotConnected],
    [DidCommDidExchangeState.RequestReceived, VtFlowConnectionState.NotConnected],
    [DidCommDidExchangeState.ResponseSent, VtFlowConnectionState.NotConnected],
    [DidCommDidExchangeState.ResponseReceived, VtFlowConnectionState.NotConnected],
    [DidCommDidExchangeState.Abandoned, VtFlowConnectionState.Terminated],
    [DidCommDidExchangeState.Completed, VtFlowConnectionState.Established],
  ]

  it.each(cases)('maps %s to %s', (didExchange, expected) => {
    expect(connectionStateFromDidExchangeState(didExchange)).toBe(expected)
  })

  it('covers every DidCommDidExchangeState value (forward-compat audit)', () => {
    const covered = new Set(cases.map(([state]) => state))
    for (const state of Object.values(DidCommDidExchangeState)) {
      expect(covered.has(state)).toBe(true)
    }
  })
})
