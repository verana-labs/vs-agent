import type { EncodeObject } from '@cosmjs/proto-signing'
import type { StdFee } from '@cosmjs/stargate'
import type { VsAgent } from '../agent/VsAgent'
import type { FeeAllowance, VeranaChainService } from './VeranaChainService'

import { VtFlowTxReason } from '@verana-labs/credo-ts-didcomm-vt-flow'

export const FEE_DENOM = 'uvna'

export type FeePreflightResult = { fee: StdFee } | { reason: VtFlowTxReason; error: string }

type FeePreflightChain = Pick<
  VeranaChainService,
  'feeAllowance' | 'estimateFee' | 'getAccountBalance' | 'getBalance'
>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** What a broadcast throws when its fee payer cannot pay it, with the reason of [VSA-ADM-VT-FL-VALIDATE-9]. */
export class FeePreflightError extends Error {
  public constructor(
    public readonly reason: VtFlowTxReason,
    message: string,
  ) {
    super(message)
    this.name = 'FeePreflightError'
  }
}

/**
 * [VSA-VPR-TX-3]: the fee payer of a transaction that targets a `Participant` entry follows the
 * `ParticipantAuthorizationRecord` of that entry. With `with_feegrant`, the Corporation pays through
 * its fee grant, so the transaction names the Corporation as granter. Without it, the agent pays.
 * There is no silent fallback from one payer to the other: a missing allowance is a reported failure.
 */
export function feeGranterFor(
  agent: Pick<VsAgent, 'veranaChain' | 'authorizationService'>,
  participantId: number | null | undefined,
): string | undefined {
  const chain = agent.veranaChain
  if (!chain || participantId == null) return undefined
  const grant = agent.authorizationService?.getVsOperatorAuthorizationRecord(participantId)
  return grant?.withFeegrant ? chain.corporation : undefined
}

/**
 * [VSA-ADM-VT-FL-VALIDATE-6], applied to every transaction the agent signs ([VSA-VPR-TX-3]):
 * simulates the transaction as it will be broadcast, and checks that its fee payer can pay it.
 * Returns the fee to broadcast with, or the reason of [VSA-ADM-VT-FL-VALIDATE-9] that stops it.
 */
export async function preflightFee(
  chain: FeePreflightChain,
  message: EncodeObject,
  granter: string | undefined,
): Promise<FeePreflightResult> {
  const failed = (reason: VtFlowTxReason, error: string): FeePreflightResult => ({ reason, error })

  let allowance: FeeAllowance | undefined
  try {
    allowance = granter ? await chain.feeAllowance(granter, FEE_DENOM) : undefined
  } catch (error) {
    return failed(VtFlowTxReason.PreflightError, errorMessage(error))
  }
  if (granter && !allowance) {
    return failed(VtFlowTxReason.FeegrantExpired, 'the Corporation grants the agent no active fee allowance')
  }

  let fee: StdFee
  try {
    fee = await chain.estimateFee([message], granter)
  } catch (error) {
    return failed(VtFlowTxReason.PreflightError, errorMessage(error))
  }
  const amount = BigInt(fee.amount.find(coin => coin.denom === FEE_DENOM)?.amount ?? '0')

  if (granter && allowance) {
    if (!allowance.unlimited && allowance.remaining < amount) {
      return failed(
        VtFlowTxReason.FeegrantExhausted,
        `the fee allowance has ${allowance.remaining}${FEE_DENOM} left`,
      )
    }
    let corporation: bigint
    try {
      corporation = BigInt((await chain.getAccountBalance(granter, FEE_DENOM)).amount)
    } catch (error) {
      return failed(VtFlowTxReason.PreflightError, errorMessage(error))
    }
    if (corporation < amount) {
      return failed(
        VtFlowTxReason.InsufficientFundsCorporation,
        `the Corporation holds ${corporation}${FEE_DENOM}`,
      )
    }
  } else {
    let own: bigint
    try {
      own = BigInt((await chain.getBalance(FEE_DENOM)).amount)
    } catch (error) {
      return failed(VtFlowTxReason.PreflightError, errorMessage(error))
    }
    if (own < amount) {
      return failed(VtFlowTxReason.InsufficientFundsAgent, `the agent account holds ${own}${FEE_DENOM}`)
    }
  }
  return { fee }
}
