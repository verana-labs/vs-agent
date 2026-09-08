import type { VeranaChainService } from '../src/blockchain/VeranaChainService'
import type { VeranaIndexerService } from '../src/blockchain/VeranaIndexerService'

import { describe, expect, it, vi } from 'vitest'

import { AuthorizationService } from '../src/blockchain/AuthorizationService'

const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'
const PP_START_OP = '/verana.pp.v1.MsgStartParticipantOP'

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never

function makeChain(overrides: Partial<Record<'vsoas' | 'oas', unknown[]>> = {}) {
  const listVsOperatorAuthorizations = vi.fn().mockResolvedValue(overrides.vsoas ?? [])
  const listOperatorAuthorizations = vi.fn().mockResolvedValue(overrides.oas ?? [])
  const chain = { address: 'verana1agent' } as unknown as VeranaChainService
  const indexer = {
    listVsOperatorAuthorizations,
    listOperatorAuthorizations,
  } as unknown as VeranaIndexerService
  return { chain, indexer, listVsOperatorAuthorizations, listOperatorAuthorizations }
}

function makeAuthz(chain: VeranaChainService, indexer: VeranaIndexerService) {
  return new AuthorizationService({ chain, indexer, logger, minRefreshIntervalMs: 0 })
}

const future = new Date(Date.now() + 3_600_000)
const past = new Date(Date.now() - 1_000)

describe('AuthorizationService', () => {
  it('caches VSOA records per participant and gates canSign on msg type and expiration', async () => {
    const { chain, indexer } = makeChain({
      vsoas: [
        {
          id: 1,
          corporationId: 7,
          vsOperator: 'verana1agent',
          records: [
            {
              participantId: 10,
              msgTypes: [PP_VALIDATE, PP_SESSION],
              withFeegrant: false,
              expiration: future,
            },
            { participantId: 11, msgTypes: [PP_SESSION], withFeegrant: true, expiration: past },
            { participantId: 12, msgTypes: [PP_SESSION], withFeegrant: false, expiration: undefined },
          ],
        },
      ],
    })
    const authz = makeAuthz(chain, indexer)
    await authz.refreshForOperator()

    expect(authz.canSign(10, PP_VALIDATE)).toBe(true)
    expect(authz.canSign(10, PP_SESSION)).toBe(true)
    expect(authz.canSign(10, PP_START_OP)).toBe(false)
    // Record 11 is disabled: StartParticipantOP grants expire immediately until validated.
    expect(authz.canSign(11, PP_SESSION)).toBe(false)
    expect(authz.canSign(12, PP_SESSION)).toBe(false)
    expect(authz.canSign(99, PP_SESSION)).toBe(false)
    expect(authz.getVsOperatorAuthorizationRecord(10)?.corporationId).toBe(7)
    expect(authz.listVsOperatorAuthorizationRecords()).toHaveLength(3)
  })

  it('treats a lapsed record with a period as active (chain auto-renews at check time)', async () => {
    const { chain, indexer } = makeChain({
      vsoas: [
        {
          id: 1,
          corporationId: 7,
          vsOperator: 'verana1agent',
          records: [
            {
              participantId: 10,
              msgTypes: [PP_SESSION],
              withFeegrant: true,
              expiration: past,
              period: { seconds: 3600 },
            },
            {
              participantId: 11,
              msgTypes: [PP_SESSION],
              withFeegrant: true,
              expiration: past,
              period: { seconds: 0 },
            },
          ],
        },
      ],
    })
    const authz = makeAuthz(chain, indexer)
    await authz.refreshForOperator()

    expect(authz.canSign(10, PP_SESSION)).toBe(true)
    expect(authz.hasFeegrant(10)).toBe(false)
    expect(authz.canSign(11, PP_SESSION)).toBe(false)
    expect(authz.hasFeegrant(11)).toBe(false)
  })

  it('drops revoked records on refresh and immediately on invalidateParticipant', async () => {
    const { chain, indexer, listVsOperatorAuthorizations } = makeChain()
    listVsOperatorAuthorizations.mockResolvedValueOnce([
      {
        id: 1,
        corporationId: 7,
        vsOperator: 'verana1agent',
        records: [{ participantId: 10, msgTypes: [PP_SESSION], withFeegrant: false, expiration: future }],
      },
    ])
    const authz = makeAuthz(chain, indexer)
    await authz.refreshForOperator()
    expect(authz.canSign(10, PP_SESSION)).toBe(true)

    authz.invalidateParticipant(10)
    expect(authz.canSign(10, PP_SESSION)).toBe(false)

    listVsOperatorAuthorizations.mockResolvedValueOnce([])
    await authz.refreshForOperator()
    expect(authz.getVsOperatorAuthorizationRecord(10)).toBeUndefined()
  })

  it('skips refreshes inside the configured interval', async () => {
    const { chain, indexer, listVsOperatorAuthorizations } = makeChain()
    const authz = new AuthorizationService({ chain, indexer, logger, minRefreshIntervalMs: 60_000 })
    await authz.refreshForOperator()
    await authz.refreshForOperator()
    expect(listVsOperatorAuthorizations).toHaveBeenCalledTimes(1)
  })

  it('asks the indexer for the block of the event that triggered the refresh', async () => {
    const { chain, indexer, listVsOperatorAuthorizations } = makeChain()
    const authz = makeAuthz(chain, indexer)

    await authz.refreshForOperator(412)

    expect(listVsOperatorAuthorizations).toHaveBeenCalledWith('verana1agent', 412)
  })

  it('refreshes inside the interval when the cache has not covered the requested block', async () => {
    const { chain, indexer, listVsOperatorAuthorizations } = makeChain()
    const authz = new AuthorizationService({ chain, indexer, logger, minRefreshIntervalMs: 60_000 })

    await authz.refreshForOperator(412)
    await authz.refreshForOperator(412)
    expect(listVsOperatorAuthorizations).toHaveBeenCalledTimes(1)

    // a revoke one block later must not be swallowed by the throttle
    await authz.refreshForOperator(413)
    expect(listVsOperatorAuthorizations).toHaveBeenCalledTimes(2)
  })

  it('reports feegrant presence only for active with_feegrant records', async () => {
    const { chain, indexer } = makeChain({
      vsoas: [
        {
          id: 1,
          corporationId: 7,
          vsOperator: 'verana1agent',
          records: [
            { participantId: 10, msgTypes: [PP_SESSION], withFeegrant: true, expiration: future },
            { participantId: 11, msgTypes: [PP_SESSION], withFeegrant: true, expiration: past },
            { participantId: 12, msgTypes: [PP_SESSION], withFeegrant: false, expiration: future },
          ],
        },
      ],
    })
    const authz = makeAuthz(chain, indexer)
    await authz.refreshForOperator()

    expect(authz.hasFeegrant(10)).toBe(true)
    expect(authz.hasFeegrant(11)).toBe(false)
    expect(authz.hasFeegrant(12)).toBe(false)
  })

  it('checks operator and vs-operator grants on demand for the given account', async () => {
    const { chain, indexer, listOperatorAuthorizations } = makeChain()
    const authz = makeAuthz(chain, indexer)

    listOperatorAuthorizations.mockResolvedValueOnce([
      { id: 3, corporationId: 7, operator: 'verana1agent', msgTypes: [PP_START_OP], expiration: future },
    ])
    await expect(authz.agentHoldsOperatorGrant(PP_START_OP)).resolves.toBe(true)
    expect(listOperatorAuthorizations).toHaveBeenLastCalledWith('verana1agent')

    listOperatorAuthorizations.mockResolvedValueOnce([
      { id: 4, corporationId: 7, operator: 'verana1caller', msgTypes: [PP_VALIDATE], expiration: undefined },
    ])
    await expect(authz.callerHoldsOperatorGrant('verana1caller', PP_VALIDATE)).resolves.toBe(true)
    expect(listOperatorAuthorizations).toHaveBeenLastCalledWith('verana1caller')
  })

  it('fails closed on a blank caller account without querying the chain', async () => {
    const { chain, indexer, listOperatorAuthorizations, listVsOperatorAuthorizations } = makeChain({
      oas: [{ id: 3, corporationId: 7, operator: 'verana1other', msgTypes: [PP_VALIDATE] }],
    })
    const authz = makeAuthz(chain, indexer)

    await expect(authz.callerHoldsOperatorGrant('', PP_VALIDATE)).resolves.toBe(false)
    await expect(authz.callerHoldsOperatorGrant('   ', PP_VALIDATE)).resolves.toBe(false)
    expect(listOperatorAuthorizations).not.toHaveBeenCalled()
    expect(listVsOperatorAuthorizations).not.toHaveBeenCalled()
  })
})
