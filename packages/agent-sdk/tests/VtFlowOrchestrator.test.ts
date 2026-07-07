import { VtFlowRole } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it } from 'vitest'

import { VtFlowOrchestrator } from '../src/vtFlow/VtFlowOrchestrator'

const record = {
  id: 'rec-1',
  role: VtFlowRole.Applicant,
  participantSessionId: 'sess-1',
  credentialExchangeRecordId: 'cx-1',
  schemaId: '5',
}

const activeIssuer = { id: 10, role: 'ISSUER', participant_state: 'ACTIVE', schema_id: 5 }

function verify(indexer: Record<string, unknown>) {
  const agent = {
    dependencyManager: { resolve: () => ({ findById: async () => record }) },
    didcomm: { credentials: { getFormatData: async () => ({ credential: { jsonld: {} } }) } },
  } as never
  const defaults = {
    getParticipantSession: async () => ({ session_records: [{ issuer_participant_id: 10 }] }),
    getParticipant: async () => activeIssuer,
    getDigest: async () => ({ digest: 'sha384-anchored' }),
  }
  return new VtFlowOrchestrator(agent, {
    indexer: { ...defaults, ...indexer } as never,
  }).verifyOfferedCredential('rec-1')
}

describe('VtFlowOrchestrator.verifyOfferedCredential', () => {
  it('accepts a credential issued by an active ISSUER for the schema and anchored on-chain', async () => {
    await expect(verify({})).resolves.toBeUndefined()
  })

  it('rejects when the validator is not an ISSUER', async () => {
    await expect(
      verify({ getParticipant: async () => ({ ...activeIssuer, role: 'VERIFIER' }) }),
    ).rejects.toThrow(/is not an ISSUER/)
  })

  it('rejects when the validator participant is not active', async () => {
    await expect(
      verify({ getParticipant: async () => ({ ...activeIssuer, participant_state: 'REVOKED' }) }),
    ).rejects.toThrow(/is not active/)
  })

  it('rejects when the participant schema does not match the credential schema', async () => {
    await expect(
      verify({ getParticipant: async () => ({ ...activeIssuer, schema_id: 99 }) }),
    ).rejects.toThrow(/does not match credential schema/)
  })

  it('rejects when the credential digest is not anchored on-chain', async () => {
    await expect(verify({ getDigest: async () => undefined })).rejects.toThrow(/not anchored on-chain/)
  })
})
