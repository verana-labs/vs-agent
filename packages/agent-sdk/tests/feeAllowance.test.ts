import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { BroadcastTxError } from '@cosmjs/stargate'
import {
  AllowedMsgAllowance,
  BasicAllowance,
  PeriodicAllowance,
} from 'cosmjs-types/cosmos/feegrant/v1beta1/feegrant'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VeranaChainService, feeAllowanceOf } from '../src/blockchain/VeranaChainService'
import { preflightFailureReason, preflightFee } from '../src/blockchain/feePreflight'
import { fetchJson } from '../src/utils/util'

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

  it('stops after 4 attempts that wait 0.5 s, 1 s and 2 s, and reports SERVICE_UNAVAILABLE', async () => {
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
      reason: 'SERVICE_UNAVAILABLE',
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
  ])('does not retry %s, and reports PREFLIGHT_ERROR', async (_case, error) => {
    const chain = chainWith()
    chain.estimateFee.mockRejectedValue(error)

    await expect(run(chain)).resolves.toEqual({ reason: 'PREFLIGHT_ERROR', error: error.message })
    expect(chain.estimateFee).toHaveBeenCalledTimes(1)
  })

  it('does not retry a timeout of the response, and reports SERVICE_UNAVAILABLE', async () => {
    const chain = chainWith()
    const error = socket('UND_ERR_HEADERS_TIMEOUT')
    chain.estimateFee.mockRejectedValue(error)

    await expect(run(chain)).resolves.toEqual({ reason: 'SERVICE_UNAVAILABLE', error: error.message })
    expect(chain.estimateFee).toHaveBeenCalledTimes(1)
  })
})

describe('VeranaChainService.broadcastWithoutWaiting', () => {
  const fee = { amount: [{ denom: 'uvna', amount: '500' }], gas: '200000' }
  const messages = [{ typeUrl: '/verana.pp.v1.MsgSetParticipantOPToValidated', value: {} }]
  const signed = TxRaw.fromPartial({
    bodyBytes: Uint8Array.of(1, 2),
    authInfoBytes: Uint8Array.of(3),
    signatures: [Uint8Array.of(4)],
  })
  const bytes = TxRaw.encode(signed).finish()
  const httpStatus = (status: number) =>
    Object.assign(new Error(`Bad status on response: ${status}`), { cause: { status, body: '' } })

  function chainWith() {
    const sign = vi.fn(async () => signed)
    const broadcastTxSync = vi.fn(async () => 'AB12')
    const chain = new VeranaChainService({} as never)
    Object.assign(chain, { operatorAddress: 'verana1agent', signingClient: { sign, broadcastTxSync } })
    return { chain, sign, broadcastTxSync }
  }

  async function run(chain: VeranaChainService) {
    const result = chain.broadcastWithoutWaiting(messages, fee)
    result.catch(() => undefined)
    await vi.runAllTimersAsync()
    return result
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs again after an HTTP 502 on the read before the signature', async () => {
    const { chain, sign, broadcastTxSync } = chainWith()
    sign.mockRejectedValueOnce(httpStatus(502))

    await expect(run(chain)).resolves.toBe('AB12')
    expect(sign).toHaveBeenCalledTimes(2)
    expect(sign).toHaveBeenCalledWith('verana1agent', messages, fee, '')
    expect(broadcastTxSync).toHaveBeenCalledTimes(1)
  })

  it('sends the same signed bytes again after an HTTP 502 on the broadcast', async () => {
    const { chain, sign, broadcastTxSync } = chainWith()
    broadcastTxSync.mockRejectedValueOnce(httpStatus(502))

    await expect(run(chain)).resolves.toBe('AB12')
    expect(sign).toHaveBeenCalledTimes(1)
    expect(broadcastTxSync.mock.calls).toEqual([[bytes], [bytes]])
  })

  it('takes a transaction the node already holds as accepted, under the hash of its bytes', async () => {
    const { chain, broadcastTxSync } = chainWith()
    broadcastTxSync
      .mockRejectedValueOnce(httpStatus(502))
      .mockRejectedValueOnce(
        new Error(
          JSON.stringify({ code: -32603, message: 'Internal error', data: 'tx already exists in cache' }),
        ),
      )

    await expect(run(chain)).resolves.toBe(toHex(sha256(bytes)).toUpperCase())
    expect(broadcastTxSync).toHaveBeenCalledTimes(2)
  })

  it('returns the hash of the bytes when no attempt of the broadcast gets a valid answer', async () => {
    const { chain, sign, broadcastTxSync } = chainWith()
    broadcastTxSync.mockRejectedValue(httpStatus(502))

    await expect(run(chain)).resolves.toBe(toHex(sha256(bytes)).toUpperCase())
    expect(sign).toHaveBeenCalledTimes(1)
    expect(broadcastTxSync.mock.calls).toEqual([[bytes], [bytes], [bytes], [bytes]])
  })

  it('throws when the read before the signature gets no valid answer, as nothing was sent', async () => {
    const { chain, sign, broadcastTxSync } = chainWith()
    sign.mockRejectedValue(httpStatus(502))

    await expect(run(chain)).rejects.toThrow('Bad status on response: 502')
    expect(broadcastTxSync).not.toHaveBeenCalled()
  })

  it('throws a broadcast that the node rejects, without sending it again', async () => {
    const { chain, broadcastTxSync } = chainWith()
    broadcastTxSync.mockRejectedValueOnce(new BroadcastTxError(32, 'sdk', 'account sequence mismatch'))

    await expect(run(chain)).rejects.toBeInstanceOf(BroadcastTxError)
    expect(broadcastTxSync).toHaveBeenCalledTimes(1)
  })
})

describe('preflightFailureReason', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const indexerError = async (status: number) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status, statusText: 'Status' })),
    )
    return fetchJson('https://idx.example/v4/di/get/abc').catch((error: unknown) => error)
  }

  it('gives SERVICE_UNAVAILABLE for an indexer answer with an HTTP status of 500 or more', async () => {
    expect(preflightFailureReason(await indexerError(502))).toBe('SERVICE_UNAVAILABLE')
  })

  it('gives PREFLIGHT_ERROR for an indexer answer with an HTTP status below 500', async () => {
    expect(preflightFailureReason(await indexerError(400))).toBe('PREFLIGHT_ERROR')
  })

  it('gives SERVICE_UNAVAILABLE when the indexer cannot be reached', () => {
    const unreachable = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })

    expect(preflightFailureReason(unreachable)).toBe('SERVICE_UNAVAILABLE')
  })

  it('gives SERVICE_UNAVAILABLE when the request to the indexer times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () => reject(init.signal.reason)),
          ),
      ),
    )
    const timedOut = await fetchJson('https://idx.example/v4/di/get/abc', 1).catch((error: unknown) => error)

    expect((timedOut as Error).name).toBe('AbortError')
    expect(preflightFailureReason(timedOut)).toBe('SERVICE_UNAVAILABLE')
  })

  it.each([
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
  ])('gives SERVICE_UNAVAILABLE when the request ends with %s', code => {
    const timedOut = Object.assign(new TypeError('fetch failed'), { cause: { code } })

    expect(preflightFailureReason(timedOut)).toBe('SERVICE_UNAVAILABLE')
  })

  it('gives SERVICE_UNAVAILABLE for the TimeoutError of an AbortSignal.timeout', async () => {
    const timedOut = await new Promise(resolve =>
      AbortSignal.timeout(1).addEventListener('abort', event =>
        resolve((event.target as AbortSignal).reason),
      ),
    )

    expect(preflightFailureReason(timedOut)).toBe('SERVICE_UNAVAILABLE')
  })
})
