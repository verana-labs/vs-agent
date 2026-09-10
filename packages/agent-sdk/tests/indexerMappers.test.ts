import { describe, expect, it } from 'vitest'

import { toCredentialSchema, toParticipant } from '../src/blockchain/indexerMappers'
import { ParticipantRole, ValidationState } from '../src/blockchain/types'
import {
  HOLDER_PARTICIPANT_TYPE,
  ISSUER_GRANTOR_PARTICIPANT_TYPE,
  ISSUER_PARTICIPANT_TYPE,
  VERIFIER_GRANTOR_PARTICIPANT_TYPE,
  VERIFIER_PARTICIPANT_TYPE,
} from '../src/types'

describe('indexer to ledger shape', () => {
  it('maps every role to the number the callers compare against', () => {
    const role = (r: ParticipantRole) =>
      toParticipant({ id: 1, schema_id: 2, did: 'did:web:x', role: r, revoked: null, slashed: null } as never)
        .role
    expect(role(ParticipantRole.Issuer)).toBe(ISSUER_PARTICIPANT_TYPE)
    expect(role(ParticipantRole.Verifier)).toBe(VERIFIER_PARTICIPANT_TYPE)
    expect(role(ParticipantRole.IssuerGrantor)).toBe(ISSUER_GRANTOR_PARTICIPANT_TYPE)
    expect(role(ParticipantRole.VerifierGrantor)).toBe(VERIFIER_GRANTOR_PARTICIPANT_TYPE)
    expect(role(ParticipantRole.Ecosystem)).toBe(5)
    expect(role(ParticipantRole.Holder)).toBe(HOLDER_PARTICIPANT_TYPE)
  })

  it('maps op state, revocation and the validator id the ledger returned as numbers', () => {
    const p = toParticipant({
      id: 7,
      schema_id: 4,
      did: 'did:web:x',
      role: ParticipantRole.Holder,
      op_state: 'VALIDATED',
      validator_participant_id: 9,
      op_summary_digest: 'sha384-abc',
      revoked: '2026-09-01T00:00:00Z',
      slashed: null,
    } as never)
    expect(p.opState).toBe(ValidationState.VALIDATED)
    expect(p.validatorParticipantId).toBe(9)
    expect(p.revoked).toEqual(new Date('2026-09-01T00:00:00Z'))
    expect(p.slashed).toBeUndefined()

    const absent = toParticipant({ id: 1, schema_id: 1, did: null, role: ParticipantRole.Holder } as never)
    expect(absent.opState).toBeUndefined()
    expect(absent.validatorParticipantId).toBe(0)
    expect(absent.did).toBe('')
  })

  it('maps the onboarding modes the bootstrap branches on', () => {
    const mode = (m: string) =>
      toCredentialSchema({ id: 5, ecosystem_id: 1, issuer_onboarding_mode: m } as never).issuerOnboardingMode
    expect(mode('OPEN')).toBe(1)
    expect(mode('ECOSYSTEM_ONBOARDING_PROCESS')).toBe(2)
    expect(mode('GRANTOR_ONBOARDING_PROCESS')).toBe(3)
    expect(toCredentialSchema({ id: 5, ecosystem_id: 1 } as never).issuerOnboardingMode).toBe(0)
  })
})
