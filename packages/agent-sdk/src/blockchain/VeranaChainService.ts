/* eslint-disable @typescript-eslint/no-var-requires */
import { encodeSecp256k1Pubkey } from '@cosmjs/amino'
import { DirectSecp256k1HdWallet, encodePubkey, type EncodeObject } from '@cosmjs/proto-signing'
import {
  SigningStargateClient,
  GasPrice,
  QueryClient,
  assertIsDeliverTxSuccess,
  calculateFee,
  setupFeegrantExtension,
  type DeliverTxResponse,
  type StdFee,
} from '@cosmjs/stargate'
import type { Coin as ProtoCoin } from 'cosmjs-types/cosmos/base/v1beta1/coin'
import {
  AllowedMsgAllowance,
  BasicAllowance,
  PeriodicAllowance,
} from 'cosmjs-types/cosmos/feegrant/v1beta1/feegrant'
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing'
import { SimulateRequest, SimulateResponse } from 'cosmjs-types/cosmos/tx/v1beta1/service'
import { AuthInfo, Fee, Tx, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import type { Any } from 'cosmjs-types/google/protobuf/any'
import type { Timestamp } from 'cosmjs-types/google/protobuf/timestamp'
import { connectComet } from '@cosmjs/tendermint-rpc'
import { createVeranaRegistry, createVeranaAminoTypes, veranaTypeUrls } from '@verana-labs/verana-types'

import {
  Coin,
  CreateOrUpdateParticipantSessionParams,
  SelfCreateParticipantParams,
  SetParticipantOPToValidatedParams,
  StartParticipantOPParams,
  VERANA_BECH32_PREFIX,
  VeranaChainConfig,
} from './types'

const {
  MsgSetParticipantOPToValidated,
  MsgCreateOrUpdateParticipantSession,
  MsgTriggerResolver,
  MsgStartParticipantOP,
  MsgStartParticipantOPResponse,
  MsgRenewParticipantOP,
  MsgCancelParticipantOPLastRequest,
  MsgSelfCreateParticipant,
  MsgSelfCreateParticipantResponse,
} = require('@verana-labs/verana-types/codec/verana/pp/v1/tx')

export type FeeAllowance = { unlimited: true } | { unlimited: false; remaining: bigint }

const ALLOWED_MSG_ALLOWANCE = '/cosmos.feegrant.v1beta1.AllowedMsgAllowance'
const BASIC_ALLOWANCE = '/cosmos.feegrant.v1beta1.BasicAllowance'
const PERIODIC_ALLOWANCE = '/cosmos.feegrant.v1beta1.PeriodicAllowance'

function hasPassed(timestamp: Timestamp | undefined, now: number): boolean {
  return timestamp !== undefined && Number(timestamp.seconds) * 1000 <= now
}

function amountOf(coins: ProtoCoin[], denom: string): bigint {
  return BigInt(coins.find(coin => coin.denom === denom)?.amount ?? '0')
}

// An empty spend_limit on a BasicAllowance means no limit, while an empty period_can_spend on a
// PeriodicAllowance means nothing left. verana-node v0.10.1 grants a BasicAllowance, the VPR of
// 2026-09-16 (MOD-DE-MSG-5-5) a PeriodicAllowance, so both are read.
export function feeAllowanceOf(
  allowance: Any | undefined,
  denom: string,
  now = Date.now(),
): FeeAllowance | undefined {
  const granted =
    allowance?.typeUrl === ALLOWED_MSG_ALLOWANCE
      ? AllowedMsgAllowance.decode(allowance.value).allowance
      : allowance
  if (granted?.typeUrl === BASIC_ALLOWANCE) {
    const basic = BasicAllowance.decode(granted.value)
    if (hasPassed(basic.expiration, now)) return undefined
    return basic.spendLimit.length === 0
      ? { unlimited: true }
      : { unlimited: false, remaining: amountOf(basic.spendLimit, denom) }
  }
  if (granted?.typeUrl === PERIODIC_ALLOWANCE) {
    const periodic = PeriodicAllowance.decode(granted.value)
    if (hasPassed(periodic.basic?.expiration, now)) return undefined
    const inPeriod = amountOf(
      hasPassed(periodic.periodReset, now) ? periodic.periodSpendLimit : periodic.periodCanSpend,
      denom,
    )
    const overall = periodic.basic?.spendLimit ?? []
    const remaining =
      overall.length === 0 ? inPeriod : [inPeriod, amountOf(overall, denom)].reduce((a, b) => (a < b ? a : b))
    return { unlimited: false, remaining }
  }
  return undefined
}

// A simulation signs with an empty signature and runs against the state of the moment, so it
// reports less gas than the delivery consumes. Cosmos SDK 0.47 made the difference larger (see
// cosmos-sdk#16020), and cosmjs answers it with a default multiplier of 1.4. Not always enough.
const DEFAULT_GAS_ADJUSTMENT = 1.5

export class VeranaChainService {
  private signingClient!: SigningStargateClient
  private operatorAddress!: string
  private chainId!: string
  private corporationAddress!: string
  private gasAdjustment!: number
  private gasPrice!: GasPrice
  private operatorPubkey!: Uint8Array
  private queryClient!: QueryClient & ReturnType<typeof setupFeegrantExtension>

  constructor(private readonly config: VeranaChainConfig) {}

  get address(): string {
    return this.operatorAddress
  }

  get getChainId(): string {
    return this.chainId
  }

  get corporation(): string {
    return this.corporationAddress
  }

  get autoTriggerResolverEnabled(): boolean {
    return this.config.autoTriggerResolver !== false
  }

  async start(): Promise<void> {
    const { rpcUrl, mnemonic, chainId, logger, gasPrice } = this.config

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: VERANA_BECH32_PREFIX,
    })
    const [account] = await wallet.getAccounts()
    this.operatorAddress = account.address
    this.operatorPubkey = account.pubkey
    this.corporationAddress = this.config.corporationAddress ?? account.address
    logger.info(
      `[VeranaChain] vs_operator address: ${this.operatorAddress} (fund this address with VNA to enable on-chain operations)`,
    )

    this.gasAdjustment = this.config.gasAdjustment ?? DEFAULT_GAS_ADJUSTMENT
    this.gasPrice = GasPrice.fromString(gasPrice ?? '1uvna')
    const cometClient = await connectComet(rpcUrl)
    this.signingClient = await SigningStargateClient.createWithSigner(cometClient, wallet, {
      registry: createVeranaRegistry(),
      aminoTypes: createVeranaAminoTypes(),
      gasPrice: this.gasPrice,
    })
    this.queryClient = QueryClient.withExtensions(cometClient, setupFeegrantExtension)

    this.chainId = await this.signingClient.getChainId()
    if (chainId && this.chainId !== chainId) {
      throw new Error(`[VeranaChain] Chain ID mismatch: expected "${chainId}", got "${this.chainId}"`)
    }
    logger.info(`[VeranaChain] Connected to chain: ${this.chainId}`)
  }

  // [VSA-VPR-QRY]: the one read left on the ledger, the indexer serves no account balance.
  async getBalance(denom = 'uvna'): Promise<Coin> {
    return this.signingClient.getBalance(this.operatorAddress, denom)
  }

  // Transaction API (signed)
  async startParticipantOP(
    params: StartParticipantOPParams,
  ): Promise<{ participantId: number; txHash: string }> {
    const value = MsgStartParticipantOP.fromPartial({
      corporation: this.corporationAddress,
      operator: this.operatorAddress,
      role: params.role,
      validatorParticipantId: params.validatorParticipantId,
      did: params.did,
      validationFees: params.validationFees,
      issuanceFees: params.issuanceFees,
      verificationFees: params.verificationFees,
      vsOperator: params.vsOperator ?? '',
      vsOperatorAuthzMsgTypes: params.vsOperatorAuthzMsgTypes ?? [],
    })
    const result = await this.broadcastMsg({ typeUrl: veranaTypeUrls.MsgStartParticipantOP, value })
    const participantId = Number(
      MsgStartParticipantOPResponse.decode(result.msgResponses[0].value).participantId,
    )
    return { participantId, txHash: result.transactionHash }
  }

  async renewParticipantOP(id: number): Promise<{ txHash: string }> {
    const value = MsgRenewParticipantOP.fromPartial({
      corporation: this.corporationAddress,
      operator: this.operatorAddress,
      id,
    })
    const result = await this.broadcastMsg({ typeUrl: veranaTypeUrls.MsgRenewParticipantOP, value })
    return { txHash: result.transactionHash }
  }

  async cancelParticipantOPLastRequest(id: number): Promise<{ txHash: string }> {
    const value = MsgCancelParticipantOPLastRequest.fromPartial({
      corporation: this.corporationAddress,
      operator: this.operatorAddress,
      id,
    })
    const result = await this.broadcastMsg({
      typeUrl: veranaTypeUrls.MsgCancelParticipantOPLastRequest,
      value,
    })
    return { txHash: result.transactionHash }
  }

  async selfCreateParticipant(
    params: SelfCreateParticipantParams,
  ): Promise<{ participantId: number; txHash: string }> {
    const value = MsgSelfCreateParticipant.fromPartial({
      corporation: this.corporationAddress,
      operator: this.operatorAddress,
      role: params.role,
      validatorParticipantId: params.validatorParticipantId,
      did: params.did,
      effectiveFrom: params.effectiveFrom,
      effectiveUntil: params.effectiveUntil,
      validationFees: params.validationFees ?? 0,
      verificationFees: params.verificationFees ?? 0,
      vsOperator: params.vsOperator ?? '',
      vsOperatorAuthzMsgTypes: params.vsOperatorAuthzMsgTypes ?? [],
      vsOperatorAuthzSpendLimit: params.vsOperatorAuthzSpendLimit ?? [],
      vsOperatorAuthzWithFeegrant: params.vsOperatorAuthzWithFeegrant ?? false,
      vsOperatorAuthzFeeSpendLimit: params.vsOperatorAuthzFeeSpendLimit ?? [],
      vsOperatorAuthzPeriod: params.vsOperatorAuthzPeriod,
    })
    const result = await this.broadcastMsg({ typeUrl: veranaTypeUrls.MsgSelfCreateParticipant, value })
    const participantId = Number(MsgSelfCreateParticipantResponse.decode(result.msgResponses[0].value).id)
    return { participantId, txHash: result.transactionHash }
  }

  setParticipantOPToValidatedMsg(params: SetParticipantOPToValidatedParams): EncodeObject {
    return {
      typeUrl: veranaTypeUrls.MsgSetParticipantOPToValidated,
      value: MsgSetParticipantOPToValidated.fromPartial({
        corporation: this.corporationAddress,
        operator: this.operatorAddress,
        id: params.id,
        effectiveUntil: params.effectiveUntil,
        validationFees: params.validationFees ?? 0,
        issuanceFees: params.issuanceFees ?? 0,
        verificationFees: params.verificationFees ?? 0,
        opSummaryDigest: params.opSummaryDigest,
        issuanceFeeDiscount: params.issuanceFeeDiscount ?? 0,
        verificationFeeDiscount: params.verificationFeeDiscount ?? 0,
      }),
    }
  }

  // The simulation carries the granter too: a Corporation-paid fee also rewrites its allowance at
  // delivery, and that write is gas a simulation without the granter never counts.
  async estimateFee(messages: EncodeObject[], granter?: string): Promise<StdFee> {
    const { sequence } = await this.signingClient.getSequence(this.operatorAddress)
    const tx = Tx.fromPartial({
      authInfo: AuthInfo.fromPartial({
        fee: Fee.fromPartial({ granter }),
        signerInfos: [
          {
            publicKey: encodePubkey(encodeSecp256k1Pubkey(this.operatorPubkey)),
            sequence: BigInt(sequence),
            modeInfo: { single: { mode: SignMode.SIGN_MODE_UNSPECIFIED } },
          },
        ],
      }),
      body: TxBody.fromPartial({
        messages: messages.map(message => this.signingClient.registry.encodeAsAny(message)),
      }),
      signatures: [new Uint8Array()],
    })
    const request = SimulateRequest.encode(
      SimulateRequest.fromPartial({ txBytes: Tx.encode(tx).finish() }),
    ).finish()
    const response = await this.queryClient.queryAbci('/cosmos.tx.v1beta1.Service/Simulate', request)
    const gas = Number(SimulateResponse.decode(response.value).gasInfo?.gasUsed ?? 0)
    const fee = calculateFee(Math.ceil(gas * this.gasAdjustment), this.gasPrice)
    return granter ? { ...fee, granter } : fee
  }

  // Returns once the node accepted the transaction into its mempool, without waiting for a block.
  async broadcastWithoutWaiting(messages: EncodeObject[], fee: StdFee): Promise<string> {
    return this.signingClient.signAndBroadcastSync(this.operatorAddress, messages, fee)
  }

  async findTx(hash: string): Promise<{ code: number; height: number; rawLog: string } | undefined> {
    const tx = await this.signingClient.getTx(hash)
    return tx ? { code: tx.code, height: tx.height, rawLog: tx.rawLog } : undefined
  }

  async getAccountBalance(address: string, denom = 'uvna'): Promise<Coin> {
    return this.signingClient.getBalance(address, denom)
  }

  // The aggregate VS operator allowance of MOD-DE-MSG-5-5.
  async feeAllowance(granter: string, denom = 'uvna'): Promise<FeeAllowance | undefined> {
    const response = await this.queryClient.feegrant
      .allowance(granter, this.operatorAddress)
      .catch((error: unknown) => {
        // verana-node v0.10.1 answers a missing grant with "fee-grant not found".
        if (error instanceof Error && error.message.includes('fee-grant not found')) return undefined
        throw error
      })
    return feeAllowanceOf(response?.allowance?.allowance, denom)
  }

  async setParticipantOPToValidated(params: SetParticipantOPToValidatedParams): Promise<{ txHash: string }> {
    const value = MsgSetParticipantOPToValidated.fromPartial({
      corporation: this.corporationAddress,
      operator: this.operatorAddress,
      id: params.id,
      effectiveUntil: params.effectiveUntil,
      validationFees: params.validationFees ?? 0,
      issuanceFees: params.issuanceFees ?? 0,
      verificationFees: params.verificationFees ?? 0,
      opSummaryDigest: params.opSummaryDigest,
      issuanceFeeDiscount: params.issuanceFeeDiscount ?? 0,
      verificationFeeDiscount: params.verificationFeeDiscount ?? 0,
    })
    const result = await this.broadcastMsg({ typeUrl: veranaTypeUrls.MsgSetParticipantOPToValidated, value })
    return { txHash: result.transactionHash }
  }

  async createOrUpdateParticipantSession(
    params: CreateOrUpdateParticipantSessionParams,
  ): Promise<{ txHash: string }> {
    const value = MsgCreateOrUpdateParticipantSession.fromPartial({
      corporation: this.corporationAddress,
      operator: this.operatorAddress,
      id: params.id,
      issuerParticipantId: params.issuerParticipantId,
      verifierParticipantId: params.verifierParticipantId,
      agentParticipantId: params.agentParticipantId,
      walletAgentParticipantId: params.walletAgentParticipantId,
      digest: params.digest,
    })
    const result = await this.broadcastMsg({
      typeUrl: veranaTypeUrls.MsgCreateOrUpdateParticipantSession,
      value,
    })
    return { txHash: result.transactionHash }
  }

  async triggerResolver(participantId: number): Promise<{ txHash: string }> {
    const value = MsgTriggerResolver.fromPartial({
      corporation: this.corporationAddress,
      operator: this.operatorAddress,
      id: participantId,
    })
    const result = await this.broadcastMsg({ typeUrl: veranaTypeUrls.MsgTriggerResolver, value })
    return { txHash: result.transactionHash }
  }

  private async broadcastMsg(options: { typeUrl: string; value: object }): Promise<DeliverTxResponse> {
    const { typeUrl, value } = options
    const msg = { typeUrl, value }
    this.config.logger.debug(`[VeranaChain] Broadcasting ${typeUrl} as ${this.operatorAddress}`)
    const result = await this.signingClient.signAndBroadcast(this.operatorAddress, [msg], this.gasAdjustment)
    assertIsDeliverTxSuccess(result)
    this.config.logger.info(`[VeranaChain] Tx success: ${result.transactionHash}`)
    return result
  }

  async extractIdFromEvent(
    txHashOrResult: string | DeliverTxResponse,
    eventType: string,
    attrKey: string,
  ): Promise<number> {
    let events: readonly { type: string; attributes: readonly { key: string; value: string }[] }[]
    let txRef: string
    if (typeof txHashOrResult === 'string') {
      const tx = await this.signingClient.getTx(txHashOrResult)
      if (!tx) {
        throw new Error(`[VeranaChain] tx ${txHashOrResult} not found`)
      }
      events = tx.events
      txRef = txHashOrResult
    } else {
      events = txHashOrResult.events
      txRef = txHashOrResult.transactionHash
    }
    const event = events.find(e => e.type === eventType)
    if (!event) {
      throw new Error(`[VeranaChain] tx ${txRef} missing '${eventType}' event`)
    }
    const attr = event.attributes.find(a => a.key === attrKey)
    if (!attr) {
      throw new Error(`[VeranaChain] tx ${txRef} missing '${attrKey}' in '${eventType}' event`)
    }
    const id = Number(attr.value)
    if (!Number.isFinite(id)) {
      throw new Error(`[VeranaChain] tx ${txRef} has non-numeric ${attrKey}=${attr.value}`)
    }
    return id
  }
}
