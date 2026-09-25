import {
  AllowedMsgAllowance,
  BasicAllowance,
  PeriodicAllowance,
} from 'cosmjs-types/cosmos/feegrant/v1beta1/feegrant'
import { describe, expect, it, vi } from 'vitest'

import { VeranaChainService, feeAllowanceOf } from '../src/blockchain/VeranaChainService'

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
