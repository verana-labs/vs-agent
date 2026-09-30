import { VtFlowTxReason } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { FeePreflightError } from '../src/blockchain/feePreflight'
import {
  flushPendingTriggerResolvers,
  scheduleTriggerResolverForOwnDid,
  triggerResolver,
  triggerResolverForOwnDid,
} from '../src/blockchain/triggerResolver'

const past = '2026-01-01T00:00:00Z'

function makeAgent(
  options: {
    grant?: { withFeegrant: boolean } | null
    participants?: Record<string, unknown>[]
    canSign?: (id: number) => boolean
  } = {},
) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  // the fee pre-flight belongs to the broadcast, so the chain either answers or throws it back
  const chain = {
    corporation: 'verana1corp',
    triggerResolver: vi.fn(async () => ({ txHash: 'AB12' })),
  }
  const grant = options.grant === undefined ? { withFeegrant: false } : options.grant
  const agent = {
    did: 'did:web:agent.example',
    config: { logger },
    veranaChain: chain,
    authorizationService: grant
      ? {
          getVsOperatorAuthorizationRecord: vi.fn(() => grant),
          canSign: vi.fn((id: number) => options.canSign?.(id) ?? true),
        }
      : undefined,
    indexer: { listParticipants: vi.fn(async () => options.participants ?? []) },
  }
  return { agent: agent as never, chain, logger }
}

describe('triggerResolver', () => {
  it('names the Corporation as fee granter when the entry has with_feegrant, and logs the hash', async () => {
    const { agent, chain, logger } = makeAgent({ grant: { withFeegrant: true } })

    await triggerResolver(agent, 42, 'test')

    expect(chain.triggerResolver).toHaveBeenCalledWith(42, { granter: 'verana1corp' })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('tx AB12, fee granter verana1corp'))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('names no granter without a grant, so the agent account pays', async () => {
    const { agent, chain } = makeAgent()

    await triggerResolver(agent, 42, 'test')

    expect(chain.triggerResolver).toHaveBeenCalledWith(42, { granter: undefined })
  })

  it('logs the reason of a fee the payer cannot pay, instead of throwing', async () => {
    const { agent, chain, logger } = makeAgent()
    chain.triggerResolver.mockRejectedValue(
      new FeePreflightError(VtFlowTxReason.InsufficientFundsAgent, 'the agent account holds 100uvna'),
    )

    await expect(triggerResolver(agent, 42, 'the credential was published')).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      '[TriggerResolver] TriggerResolver for participant 42 (the credential was published) not sent: INSUFFICIENT_FUNDS_AGENT: the agent account holds 100uvna',
    )
  })

  it('logs an error when the chain rejects the transaction', async () => {
    const rejected = makeAgent()
    rejected.chain.triggerResolver.mockRejectedValue(new Error('code 5: unauthorized'))
    await triggerResolver(rejected.agent, 42, 'test')
    expect(rejected.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed: code 5: unauthorized'),
    )
  })
})

describe('triggerResolverForOwnDid', () => {
  const holder = {
    id: 7,
    did: 'did:web:agent.example',
    effective_from: past,
    effective_until: null,
    revoked: null,
    slashed: null,
  }
  const expired = { ...holder, id: 5, effective_until: past }
  const issuer = { ...holder, id: 9 }

  it('targets the active entry the agent may sign for, or else the first active one', async () => {
    const authorized = makeAgent({ participants: [expired, issuer, holder], canSign: id => id === 7 })
    await triggerResolverForOwnDid(authorized.agent, 'test')
    expect(authorized.chain.triggerResolver).toHaveBeenCalledWith(7, { granter: undefined })

    const unauthorized = makeAgent({ participants: [expired, issuer, holder], canSign: () => false })
    await triggerResolverForOwnDid(unauthorized.agent, 'test')
    expect(unauthorized.chain.triggerResolver).toHaveBeenCalledWith(9, { granter: undefined })
  })

  it('warns when the agent has no active entry, and logs an error when the indexer fails', async () => {
    const none = makeAgent({ participants: [expired] })
    await triggerResolverForOwnDid(none.agent, 'test')
    expect(none.chain.triggerResolver).not.toHaveBeenCalled()
    expect(none.logger.warn).toHaveBeenCalledWith(expect.stringContaining('no active Participant entry'))

    const down = makeAgent()
    ;(
      down.agent as { indexer: { listParticipants: ReturnType<typeof vi.fn> } }
    ).indexer.listParticipants.mockRejectedValue(new Error('indexer down'))
    await expect(triggerResolverForOwnDid(down.agent, 'test')).resolves.toBeUndefined()
    expect(down.logger.error).toHaveBeenCalledWith(expect.stringContaining('indexer down'))
  })
})

// [IDX-VT-EVAL-3]: the trigger is the only signal of a publication change, so the window must not
// swallow one when the agent stops
describe('flushPendingTriggerResolvers', () => {
  const holder = {
    id: 7,
    did: 'did:web:agent.example',
    effective_from: past,
    effective_until: null,
    revoked: null,
    slashed: null,
  }

  it('sends the trigger a coalescing window still holds, once for a burst of writes', async () => {
    const { agent, chain } = makeAgent({ participants: [holder] })

    scheduleTriggerResolverForOwnDid(agent, 'the first write')
    scheduleTriggerResolverForOwnDid(agent, 'the second write')
    expect(chain.triggerResolver).not.toHaveBeenCalled()

    await flushPendingTriggerResolvers()

    expect(chain.triggerResolver).toHaveBeenCalledOnce()
  })

  it('sends nothing when no window holds a trigger', async () => {
    const { chain } = makeAgent({ participants: [holder] })

    await flushPendingTriggerResolvers()

    expect(chain.triggerResolver).not.toHaveBeenCalled()
  })
})
