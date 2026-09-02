import { CredoError } from '@credo-ts/core'
import { ConflictException } from '@nestjs/common'
import { VtCredentialState, VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { AdminApiError, AdminApiErrorCode } from '../src/common'
import { VtFlowsService } from '../src/controllers/admin/vt-flow/VtFlowsService'

function flowRecord(id: string, createdAtMs: number, state: VtFlowState = VtFlowState.Validating) {
  return {
    id,
    threadId: `thid-${id}`,
    participantSessionId: `sess-${id}`,
    connectionId: 'conn-1',
    role: VtFlowRole.Validator,
    state,
    createdAt: new Date(createdAtMs),
    assertState(expected: VtFlowState | VtFlowState[]) {
      const states = Array.isArray(expected) ? expected : [expected]
      if (!states.includes(this.state)) throw new CredoError(`state '${this.state}' not in [${states}]`)
    },
  }
}

function makeService(
  vtFlowApi: Record<string, unknown>,
  options: {
    credential?: unknown
    credentialTypesService?: Record<string, unknown>
    connection?: { isReady: boolean; theirDid?: string } | null
  } = {},
) {
  const connection =
    options.connection === undefined ? { isReady: true, theirDid: 'did:web:peer' } : options.connection
  const agent = {
    dependencyManager: { resolve: () => vtFlowApi },
    didcomm: {
      connections: { findById: vi.fn().mockResolvedValue(connection) },
      credentials: { findById: vi.fn().mockResolvedValue(options.credential ?? null) },
    },
  }
  return new VtFlowsService(
    { getAgent: async () => agent } as never,
    (options.credentialTypesService ?? {}) as never,
  )
}

describe('VtFlowsService v2 routes', () => {
  it('maps the camelCase v2 filters onto record tags', async () => {
    const findAllByQuery = vi.fn().mockResolvedValue([])
    const service = makeService({ findAllByQuery })

    await service.listFlowsPage({
      role: VtFlowRole.Validator,
      flowState: VtFlowState.Validating,
      participantId: '42',
      schemaId: '5',
      participantSessionId: 'sess-1',
    })

    expect(findAllByQuery).toHaveBeenCalledWith({
      role: VtFlowRole.Validator,
      flowState: VtFlowState.Validating,
      participantId: '42',
      schemaId: '5',
      participantSessionId: 'sess-1',
    })
  })

  it('walks the whole collection over the keyset cursor and ends with a null cursor', async () => {
    const records = [flowRecord('a', 1000), flowRecord('b', 2000), flowRecord('c', 3000)]
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue(records) })

    const first = await service.listFlowsPage({ limit: 2 })
    expect(first.items.map(item => item.id)).toEqual(['a', 'b'])
    expect(first.nextCursor).not.toBeNull()
    expect(first.items[0].lastEventAt).toEqual(new Date(1000))

    const second = await service.listFlowsPage({ limit: 2, cursor: first.nextCursor! })
    expect(second.items.map(item => item.id)).toEqual(['c'])
    expect(second.nextCursor).toBeNull()
  })

  it('rejects a cursor replayed against a different filter set with INVALID_CURSOR', async () => {
    const records = [flowRecord('a', 1000), flowRecord('b', 2000), flowRecord('c', 3000)]
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue(records) })

    const first = await service.listFlowsPage({ limit: 2 })
    await expect(
      service.listFlowsPage({ limit: 2, cursor: first.nextCursor!, role: VtFlowRole.Validator }),
    ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidCursor, status: 400 })

    await expect(service.listFlowsPage({ cursor: 'zzz' })).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidCursor,
      status: 400,
    })
  })

  it('returns the flow of a session with its flow state and connection state', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) })

    const flow = await service.getFlow('sess-a')

    expect(flow).toMatchObject({
      id: 'a',
      participantSessionId: 'sess-a',
      flowState: VtFlowState.Validating,
      connectionState: 'ESTABLISHED',
      peerDid: 'did:web:peer',
    })
  })

  it('reports the flow state and the connection state on every listed flow', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) })

    const page = await service.listFlowsPage({})

    expect(page.items[0]).toMatchObject({
      flowState: VtFlowState.Validating,
      connectionState: 'ESTABLISHED',
    })
  })

  it('reports NOT_CONNECTED while the connection of a live flow is not ready', async () => {
    const service = makeService(
      { findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) },
      { connection: { isReady: false, theirDid: 'did:web:peer' } },
    )

    await expect(service.getFlow('sess-a')).resolves.toMatchObject({
      connectionState: 'NOT_CONNECTED',
      flowState: VtFlowState.Validating,
    })
  })

  it('reports TERMINATED for a flow in a terminal state, and for a lost connection', async () => {
    const terminal = makeService({
      findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000, VtFlowState.TerminatedByValidator)]),
    })
    await expect(terminal.getFlow('sess-a')).resolves.toMatchObject({ connectionState: 'TERMINATED' })

    const lost = makeService(
      { findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) },
      { connection: null },
    )
    await expect(lost.getFlow('sess-a')).resolves.toMatchObject({
      connectionState: 'TERMINATED',
      peerDid: undefined,
    })
  })

  it('rejects an unknown participant session with UNKNOWN_ID and status 404', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([]) })

    const rejection = expect(service.getFlow('sess-missing')).rejects
    await rejection.toBeInstanceOf(AdminApiError)
    await rejection.toMatchObject({ code: AdminApiErrorCode.UnknownId, status: 404 })
  })

  it('revokes an AnonCreds credential through its registry before notifying the applicant', async () => {
    const completed = flowRecord('a', 1000, VtFlowState.Completed)
    ;(completed as Record<string, unknown>).credentialExchangeRecordId = 'cred-ex-1'
    const tags: Record<string, unknown> = {
      anonCredsRevocationRegistryId: 'rev-reg-1',
      anonCredsCredentialRevocationId: '7',
    }
    const notifyCredentialStateChange = vi.fn().mockResolvedValue(completed)
    const revokeCredential = vi.fn().mockResolvedValue(undefined)
    const service = makeService(
      { findAllByQuery: vi.fn().mockResolvedValue([completed]), notifyCredentialStateChange },
      {
        credential: { getTag: (name: string) => tags[name] },
        credentialTypesService: { revokeCredential },
      },
    )

    await service.revokeFlowCredential('sess-a', 'fraud')

    expect(revokeCredential).toHaveBeenCalledWith(expect.anything(), 'rev-reg-1', 7)
    expect(notifyCredentialStateChange).toHaveBeenCalledWith({
      vtFlowRecordId: 'a',
      state: VtCredentialState.Revoked,
      reason: 'fraud',
    })
  })

  it('rejects revocation of a credential without registry coordinates as UNSUPPORTED_FORMAT', async () => {
    const completed = flowRecord('a', 1000, VtFlowState.Completed)
    ;(completed as Record<string, unknown>).credentialExchangeRecordId = 'cred-ex-1'
    const service = makeService(
      { findAllByQuery: vi.fn().mockResolvedValue([completed]) },
      { credential: { getTag: () => undefined } },
    )

    const rejection = expect(service.revokeFlowCredential('sess-a')).rejects
    await rejection.toBeInstanceOf(AdminApiError)
    await rejection.toMatchObject({ code: 'UNSUPPORTED_FORMAT', status: 400 })
  })

  it('refuses revocation with 409 when the flow has no issued credential', async () => {
    const validating = flowRecord('a', 1000, VtFlowState.Validating)
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([validating]) })

    await expect(service.revokeFlowCredential('sess-a')).rejects.toThrow(ConflictException)
  })
})
