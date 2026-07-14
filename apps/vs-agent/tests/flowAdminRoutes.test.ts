import { CredoError } from '@credo-ts/core'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { VtCredentialState, VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
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
  connection: unknown = { isReady: true, theirDid: 'did:web:peer' },
) {
  const agent = {
    dependencyManager: { resolve: () => vtFlowApi },
    didcomm: { connections: { findById: vi.fn().mockResolvedValue(connection) } },
  }
  return new VtFlowsService({ getAgent: async () => agent } as never)
}

describe('VtFlowsService flow admin routes', () => {
  it('maps the spec list filters onto record tags and enriches the peer DID', async () => {
    const findAllByQuery = vi.fn().mockResolvedValue([record])
    const service = makeService({ findAllByQuery })

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
      participantId: '42',
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

  it('refuses oob-link and claim edits when the connection is not established', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([record]) }, { isReady: false })
    await expect(service.sendOobLink('sess-1', 'https://x')).rejects.toThrow(BadRequestException)
    await expect(service.editCredentialClaims('sess-1', {})).rejects.toThrow(BadRequestException)
  })

  it('revokes with the REVOKED credential state and maps vt-flow errors to 400', async () => {
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
    await expect(service.revokeCredential('sess-1')).rejects.toThrow(BadRequestException)
  })
})
