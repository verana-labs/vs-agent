import { CredoError } from '@credo-ts/core'
import { ConflictException, NotFoundException } from '@nestjs/common'
import {
  VtCredentialState,
  VtFlowPendingAction,
  VtFlowRole,
  VtFlowState,
  VtFlowTxStatus,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { VtFlowsService } from '../src/controllers/admin/vt-flow/VtFlowsService'

const record = {
  id: 'rec-1',
  threadId: 'thid-1',
  participantSessionId: 'sess-1',
  connectionId: 'conn-1',
  role: VtFlowRole.Validator,
  createdAt: new Date(0),
}

function makeService(
  vtFlowApi: Record<string, unknown>,
  connection: unknown = { isReady: true, theirDid: 'did:web:peer', previousTheirDids: [] },
) {
  const agent = {
    dependencyManager: { resolve: () => vtFlowApi },
    didcomm: { connections: { findById: vi.fn().mockResolvedValue(connection) } },
  }
  return new VtFlowsService({ getAgent: async () => agent } as never, undefined as never)
}

describe('VtFlowsService pendingAction', () => {
  async function pendingActionFor(overrides: Record<string, unknown>) {
    const service = makeService({
      findAllByQuery: vi.fn().mockResolvedValue([{ ...record, ...overrides }]),
    })
    const [flow] = await service.listFlows({})
    return flow.pendingAction
  }

  it('hands an expired oob-link back to the validator', async () => {
    const link = { url: 'https://collect.example/form', description: 'Upload', at: new Date(0).toISOString() }

    await expect(
      pendingActionFor({
        state: VtFlowState.OobPending,
        oobLink: { ...link, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      }),
    ).resolves.toBe(VtFlowPendingAction.Applicant)

    await expect(
      pendingActionFor({
        state: VtFlowState.OobPending,
        oobLink: { ...link, expiresAt: new Date(Date.now() - 60_000).toISOString() },
      }),
    ).resolves.toBe(VtFlowPendingAction.Validator)
  })

  it('hands CRED_OFFERED back to the validator when the anchoring transaction failed', async () => {
    await expect(pendingActionFor({ state: VtFlowState.CredOffered })).resolves.toBe(
      VtFlowPendingAction.Agent,
    )

    await expect(
      pendingActionFor({
        state: VtFlowState.CredOffered,
        issuance: { tx: { status: VtFlowTxStatus.Failed } },
      }),
    ).resolves.toBe(VtFlowPendingAction.Validator)
  })
})

describe('VtFlowsService flow admin routes', () => {
  it('maps the spec list filters onto record tags and enriches the peer DID', async () => {
    const findAllByQuery = vi.fn().mockResolvedValue([record])
    const service = makeService(
      { findAllByQuery },
      { isReady: true, theirDid: 'did:peer:2.Ez6Mk.Vz6Mk', previousTheirDids: ['did:web:peer'] },
    )

    const flows = await service.listFlows({
      role: VtFlowRole.Validator,
      flowState: VtFlowState.Validating,
      participant_id: '42',
      schema_id: '5',
      participant_session_id: 'sess-1',
    })

    expect(findAllByQuery).toHaveBeenCalledWith({
      role: VtFlowRole.Validator,
      flowState: VtFlowState.Validating,
      applicantParticipantId: '42',
      schemaId: '5',
      participantSessionId: 'sess-1',
    })
    expect(flows).toHaveLength(1)
    expect(flows[0].peerDid).toBe('did:web:peer')
  })

  it('returns 404 when the flow does not exist', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([]) })
    await expect(service.editCredentialClaims('missing', {})).rejects.toThrow(NotFoundException)
  })

  it('refuses oob-link and claim edits with 409 when the connection is not established', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([record]) }, { isReady: false })
    await expect(service.sendOobLink('sess-1', 'https://x')).rejects.toThrow(ConflictException)
    await expect(service.editCredentialClaims('sess-1', {})).rejects.toThrow(ConflictException)
  })

  it('revokes with the REVOKED credential state and maps vt-flow errors to 409', async () => {
    const notifyCredentialStateChange = vi.fn().mockResolvedValue(record)
    const service = makeService({
      findAllByQuery: vi.fn().mockResolvedValue([record]),
      notifyCredentialStateChange,
    })

    await service.revokeCredential('sess-1', 'fraud')
    expect(notifyCredentialStateChange).toHaveBeenCalledWith({
      vtFlowRecordId: 'rec-1',
      state: VtCredentialState.Revoked,
      reason: 'fraud',
    })

    notifyCredentialStateChange.mockRejectedValue(new CredoError('expected COMPLETED'))
    await expect(service.revokeCredential('sess-1')).rejects.toThrow(ConflictException)
  })
})
