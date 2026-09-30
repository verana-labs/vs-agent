import { describe, expect, it, vi } from 'vitest'

import { triggerResolver, triggerResolverForOwnDid } from '../src/blockchain/triggerResolver'

const TRIGGER = '/verana.pp.v1.MsgTriggerResolver'
const past = '2026-01-01T00:00:00Z'

function makeAgent(
  options: {
    grant?: { withFeegrant: boolean } | null
    balance?: string
    participants?: Record<string, unknown>[]
    canSign?: (id: number) => boolean
  } = {},
) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const chain = {
    corporation: 'verana1corp',
    triggerResolverMsg: vi.fn((id: number) => ({ typeUrl: TRIGGER, value: { id } })),
    triggerResolver: vi.fn(async () => ({ txHash: 'AB12' })),
    feeAllowance: vi.fn(async () => ({ unlimited: true })),
    estimateFee: vi.fn(async () => ({ amount: [{ denom: 'uvna', amount: '500' }], gas: '200000' })),
    getAccountBalance: vi.fn(async () => ({ denom: 'uvna', amount: '100000' })),
    getBalance: vi.fn(async () => ({ denom: 'uvna', amount: options.balance ?? '1000' })),
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

    expect(chain.estimateFee).toHaveBeenCalledWith([{ typeUrl: TRIGGER, value: { id: 42 } }], 'verana1corp')
    expect(chain.getBalance).not.toHaveBeenCalled()
    expect(chain.triggerResolver).toHaveBeenCalledWith(42, { granter: 'verana1corp' })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('tx AB12, fee granter verana1corp'))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('lets the agent pay without a grant, and logs an error with the reason instead of throwing', async () => {
    const { agent, chain, logger } = makeAgent({ balance: '100' })

    await expect(triggerResolver(agent, 42, 'the credential was published')).resolves.toBeUndefined()

    expect(chain.estimateFee).toHaveBeenCalledWith(expect.anything(), undefined)
    expect(chain.triggerResolver).not.toHaveBeenCalled()
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
