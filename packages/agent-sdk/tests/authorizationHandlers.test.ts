import type { AuthorizationService } from '../src/blockchain/AuthorizationService'

import { describe, expect, it, vi } from 'vitest'

import {
  IndexerHandlerContext,
  IndexerHandlerRegistry,
} from '../src/blockchain/handlers/IndexerHandlerRegistry'
import { registerAuthorizationHandlers } from '../src/blockchain/handlers/authorizationHandlers'
import { IndexerActivity } from '../src/blockchain/types'

function makeContext(): IndexerHandlerContext {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    agent: { config: { logger } } as unknown as IndexerHandlerContext['agent'],
    blockHeight: 100,
    operatorAddress: 'verana1operator',
    state: { lastBlockHeight: 0, ecosystems: {}, credentialSchemas: {}, participants: {} },
    txHash: 'TXHASH',
  }
}

function makeActivity(msg: string, entityId = '10'): IndexerActivity {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    block_height: 100,
    entity_type: 'Participant',
    entity_id: entityId,
    msg,
    changes: {},
  }
}

function makeAuthz() {
  return {
    refreshForOperator: vi.fn().mockResolvedValue(undefined),
    invalidateParticipant: vi.fn(),
  } as unknown as AuthorizationService
}

describe('registerAuthorizationHandlers', () => {
  it('preserves the original handler and refreshes the cache after it', async () => {
    const registry = new IndexerHandlerRegistry()
    const calls: string[] = []
    registry.register({
      msg: 'StartParticipantOP',
      handle: async () => {
        calls.push('original')
      },
    })
    const authz = makeAuthz()
    ;(authz.refreshForOperator as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('refresh')
    })

    registerAuthorizationHandlers(registry, authz)
    await registry.dispatch(makeActivity('StartParticipantOP'), makeContext())

    expect(calls).toEqual(['original', 'refresh'])
  })

  it('invalidates the participant before refreshing on revoke events', async () => {
    const registry = new IndexerHandlerRegistry()
    const authz = makeAuthz()
    const calls: string[] = []
    ;(authz.invalidateParticipant as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
      calls.push(`invalidate:${id}`)
    })
    ;(authz.refreshForOperator as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('refresh')
    })
    registerAuthorizationHandlers(registry, authz)

    await registry.dispatch(makeActivity('RevokeParticipant', '42'), makeContext())

    expect(calls).toEqual(['invalidate:42', 'refresh'])
  })

  it('registers the spec delegation handlers even without defaults', async () => {
    const registry = new IndexerHandlerRegistry()
    const authz = makeAuthz()
    registerAuthorizationHandlers(registry, authz)

    for (const msg of [
      'GrantOperatorAuthorization',
      'RevokeOperatorAuthorization',
      'GrantVSOperatorAuthorization',
      'RevokeVSOperatorAuthorization',
      'GrantFeeAllowance',
      'RevokeFeeAllowance',
    ]) {
      expect(registry.has(msg), `missing handler for ${msg}`).toBe(true)
      await registry.dispatch(makeActivity(msg), makeContext())
    }
    expect(authz.refreshForOperator).toHaveBeenCalledTimes(6)
  })

  it('swallows refresh failures so the dispatch chain is not broken', async () => {
    const registry = new IndexerHandlerRegistry()
    const authz = makeAuthz()
    ;(authz.refreshForOperator as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('chain down'))
    registerAuthorizationHandlers(registry, authz)

    const ctx = makeContext()
    await expect(registry.dispatch(makeActivity('SetParticipantOPToValidated'), ctx)).resolves.toBeUndefined()
    expect(ctx.agent.config.logger.error).toHaveBeenCalled()
  })
})
