import {
  AllowedMsgAllowance,
  BasicAllowance,
  PeriodicAllowance,
} from 'cosmjs-types/cosmos/feegrant/v1beta1/feegrant'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VeranaChainService, feeAllowanceOf } from '../src/blockchain/VeranaChainService'
import { preflightFee } from '../src/blockchain/feePreflight'

const NOW = Date.parse('2026-09-23T12:00:00Z')
const at = (iso: string) => ({ seconds: BigInt(Date.parse(iso) / 1000), nanos: 0 })
const uvna = (amount: string) => [{ denom: 'uvna', amount }]

function wrapped(typeUrl: string, value: Uint8Array) {
  return {
    typeUrl: '/cosmos.feegrant.v1beta1.AllowedMsgAllowance',
    value: AllowedMsgAllowance.encode(
      AllowedMsgAllowance.fromPartial({
        allowance: { typeUrl, value },
        allowedMessages: ['/verana.pp.v1.MsgSetParticipantOPToValidated'],
      }),
    ).finish(),
  }
}

const basic = (allowance: BasicAllowance) =>
  wrapped('/cosmos.feegrant.v1beta1.BasicAllowance', BasicAllowance.encode(allowance).finish())

const periodic = (allowance: PeriodicAllowance) =>
  wrapped('/cosmos.feegrant.v1beta1.PeriodicAllowance', PeriodicAllowance.encode(allowance).finish())

describe('feeAllowanceOf', () => {
  it('reads an empty BasicAllowance spend limit as no limit, which verana-node v0.10.1 grants', () => {
    expect(
      feeAllowanceOf(
        basic(BasicAllowance.fromPartial({ expiration: at('2027-01-01T00:00:00Z') })),
        'uvna',
        NOW,
      ),
    ).toEqual({
      unlimited: true,
    })
    expect(
      feeAllowanceOf(basic(BasicAllowance.fromPartial({ spendLimit: uvna('700') })), 'uvna', NOW),
    ).toEqual({
      unlimited: false,
      remaining: BigInt(700),
    })
  })

  it('treats an expired allowance as none', () => {
    expect(
      feeAllowanceOf(
        basic(BasicAllowance.fromPartial({ expiration: at('2026-01-01T00:00:00Z') })),
        'uvna',
        NOW,
      ),
    ).toBeUndefined()
  })

  it('reads what is left in the period, and the full period budget once the period has reset', () => {
    const current = { periodSpendLimit: uvna('1000'), periodCanSpend: uvna('150') }

    expect(
      feeAllowanceOf(
        periodic(PeriodicAllowance.fromPartial({ ...current, periodReset: at('2026-09-24T00:00:00Z') })),
        'uvna',
        NOW,
      ),
    ).toEqual({ unlimited: false, remaining: BigInt(150) })
    expect(
      feeAllowanceOf(
        periodic(PeriodicAllowance.fromPartial({ ...current, periodReset: at('2026-09-22T00:00:00Z') })),
        'uvna',
        NOW,
      ),
    ).toEqual({ unlimited: false, remaining: BigInt(1000) })
  })

  it('caps the period budget by the overall spend limit of the allowance', () => {
    const allowance = periodic(
      PeriodicAllowance.fromPartial({
        basic: { spendLimit: uvna('90') },
        periodSpendLimit: uvna('1000'),
        periodCanSpend: uvna('500'),
        periodReset: at('2026-09-24T00:00:00Z'),
      }),
    )

    expect(feeAllowanceOf(allowance, 'uvna', NOW)).toEqual({ unlimited: false, remaining: BigInt(90) })
  })
})

describe('VeranaChainService.feeAllowance', () => {
  it('reads a missing grant as none, and throws when the allowance could not be read', async () => {
    const allowance = vi.fn()
    const chain = new VeranaChainService({} as never)
    Object.assign(chain, { operatorAddress: 'verana1agent', queryClient: { feegrant: { allowance } } })

    allowance.mockRejectedValueOnce(
      new Error(
        'Query failed with (6): rpc error: code = Internal desc = fee-grant not found: not found: unknown request',
      ),
    )
    await expect(chain.feeAllowance('verana1corp')).resolves.toBeUndefined()

    allowance.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(chain.feeAllowance('verana1corp')).rejects.toThrow('fetch failed')
  })
})

describe('VeranaChainService.broadcastMsg', () => {
  const fee = { amount: [{ denom: 'uvna', amount: '500' }], gas: '200000', granter: 'verana1corp' }

  function chainWith(overrides: Record<string, unknown> = {}) {
    const signAndBroadcast = vi.fn(async () => ({ code: 0, transactionHash: 'AB12', msgResponses: [] }))
    const estimateFee = vi.fn(async () => fee)
    const chain = new VeranaChainService({ logger: { debug: vi.fn(), info: vi.fn() } } as never)
    Object.assign(chain, {
      operatorAddress: 'verana1agent',
      corporationAddress: 'verana1corp',
      signingClient: { signAndBroadcast },
      estimateFee,
      feeAllowance: async () => ({ unlimited: true }),
      getAccountBalance: async () => ({ denom: 'uvna', amount: '10000' }),
      getBalance: async () => ({ denom: 'uvna', amount: '10000' }),
      ...overrides,
    })
    return { chain, signAndBroadcast, estimateFee }
  }

  it('broadcasts with the simulated fee, and names the granter the caller gives', async () => {
    const { chain, signAndBroadcast, estimateFee } = chainWith()

    await expect(chain.triggerResolver(42, { granter: 'verana1corp' })).resolves.toEqual({ txHash: 'AB12' })
    expect(estimateFee).toHaveBeenCalledWith(
      [expect.objectContaining({ typeUrl: '/verana.pp.v1.MsgTriggerResolver' })],
      'verana1corp',
    )
    expect(signAndBroadcast).toHaveBeenCalledWith('verana1agent', expect.any(Array), fee)

    await chain.triggerResolver(42)
    expect(estimateFee).toHaveBeenLastCalledWith(expect.any(Array), undefined)
  })

  // [VSA-ADM-VT-FL-VALIDATE-6] on every transaction: no call site can reach the chain unchecked
  it('signs nothing when the fee payer cannot pay, and names the reason', async () => {
    const { chain, signAndBroadcast } = chainWith({
      getBalance: async () => ({ denom: 'uvna', amount: '0' }),
    })

    await expect(chain.triggerResolver(42)).rejects.toMatchObject({
      name: 'FeePreflightError',
      reason: 'INSUFFICIENT_FUNDS_AGENT',
      message: 'the agent account holds 0uvna',
    })
    expect(signAndBroadcast).not.toHaveBeenCalled()
  })

  it('signs nothing when the Corporation grants no active allowance', async () => {
    const { chain, signAndBroadcast } = chainWith({ feeAllowance: async () => undefined })

    await expect(chain.triggerResolver(42, { granter: 'verana1corp' })).rejects.toMatchObject({
      name: 'FeePreflightError',
      reason: 'FEEGRANT_EXPIRED',
    })
    expect(signAndBroadcast).not.toHaveBeenCalled()
  })
})

describe('preflightFee', () => {
  const fee = { amount: [{ denom: 'uvna', amount: '500' }], gas: '200000' }
  const message = { typeUrl: '/verana.pp.v1.MsgTriggerResolver', value: {} }
  const httpStatus = (status: number) =>
    Object.assign(new Error(`Bad status on response: ${status}`), { cause: { status, body: '' } })
  const socket = (code: string) =>
    Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) })

  function chainWith() {
    return {
      feeAllowance: vi.fn(async () => ({ unlimited: true, remaining: BigInt(0) })),
      estimateFee: vi.fn(async () => fee),
      getAccountBalance: vi.fn(async () => ({ denom: 'uvna', amount: '10000' })),
      getBalance: vi.fn(async () => ({ denom: 'uvna', amount: '10000' })),
    }
  }

  async function run(chain: ReturnType<typeof chainWith>, granter?: string) {
    const result = preflightFee(chain as never, message, granter)
    await vi.runAllTimersAsync()
    return result
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['feeAllowance', 'verana1corp'],
    ['estimateFee', undefined],
    ['getAccountBalance', 'verana1corp'],
    ['getBalance', undefined],
  ] as const)('retries %s after an HTTP 502 and returns the fee', async (read, granter) => {
    const chain = chainWith()
    chain[read].mockRejectedValueOnce(httpStatus(502))

    await expect(run(chain, granter)).resolves.toEqual({ fee })
    expect(chain[read]).toHaveBeenCalledTimes(2)
  })

  it('stops after 4 attempts that wait 0.5 s, 1 s and 2 s, and reports PREFLIGHT_ERROR', async () => {
    const chain = chainWith()
    chain.estimateFee.mockRejectedValue(httpStatus(503))

    const result = preflightFee(chain as never, message, undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(chain.estimateFee).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(chain.estimateFee).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(chain.estimateFee).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(2000)

    await expect(result).resolves.toEqual({
      reason: 'PREFLIGHT_ERROR',
      error: 'Bad status on response: 503',
    })
    expect(chain.estimateFee).toHaveBeenCalledTimes(4)
  })

  it.each(['ECONNRESET', 'EAI_AGAIN'])('retries a transport failure with the code %s', async code => {
    const chain = chainWith()
    chain.getBalance.mockRejectedValueOnce(socket(code))

    await expect(run(chain)).resolves.toEqual({ fee })
    expect(chain.getBalance).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['an HTTP 4xx', httpStatus(429)],
    ['a chain rejection with no cause', new Error('Query failed with (18): account sequence mismatch')],
    ['a timeout of the response headers', socket('UND_ERR_HEADERS_TIMEOUT')],
  ])('does not retry %s', async (_case, error) => {
    const chain = chainWith()
    chain.estimateFee.mockRejectedValue(error)

    await expect(run(chain)).resolves.toEqual({ reason: 'PREFLIGHT_ERROR', error: error.message })
    expect(chain.estimateFee).toHaveBeenCalledTimes(1)
  })
})
