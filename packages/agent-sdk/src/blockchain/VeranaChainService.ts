/* eslint-disable @typescript-eslint/no-var-requires */
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import {
  SigningStargateClient,
  GasPrice,
  assertIsDeliverTxSuccess,
  QueryClient,
  createProtobufRpcClient,
  type DeliverTxResponse,
} from '@cosmjs/stargate'
import { connectComet } from '@cosmjs/tendermint-rpc'
import { createVeranaRegistry, createVeranaAminoTypes, veranaTypeUrls } from '@verana-labs/verana-types'

import {
  Coin,
  CreateOrUpdateParticipantSessionParams,
  CredentialSchema,
  Ecosystem,
  OperatorAuthorization,
  Participant,
  RawParticipant,
  SelfCreateParticipantParams,
  SetParticipantOPToValidatedParams,
  StartParticipantOPParams,
  StoredDigest,
  VERANA_BECH32_PREFIX,
  VeranaChainConfig,
  VsOperatorAuthorization,
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

// ParticipantRole.HOLDER (x/pp/types); the only role whose vs_operator may send TriggerResolver (chain Path 1).
const _PARTICIPANT_ROLE_HOLDER = 6
const _PARTICIPANT_ROLE_ISSUER = 1

// QueryListParticipantsRequest.response_max_size caps at 1024 and defaults to 64. The node applies
// the other filters loosely, so ask for the largest page and match the fields again here.
const _PARTICIPANT_QUERY_MAX_SIZE = 1024

// A simulation signs with an empty signature and runs against the state of the moment, so it
// reports less gas than the delivery consumes. Cosmos SDK 0.47 made the difference larger (see
// cosmos-sdk#16020), and cosmjs answers it with a default multiplier of 1.4. Not always enough.
const DEFAULT_GAS_ADJUSTMENT = 1.5

// the chain answers a query for an unknown record with a NotFound error, not with an empty result
function _isNotFoundError(error: unknown): boolean {
  return /not found|NotFound|key not found/i.test((error as Error)?.message ?? '')
}

function _mapParticipant(p: RawParticipant): Participant {
  return {
    id: p.id,
    schemaId: p.schemaId,
    role: p.role,
    did: p.did,
    corporation: p.corporationId != null ? String(p.corporationId) : '',
    validatorParticipantId: p.validatorParticipantId,
    opState: p.opState as unknown as Participant['opState'],
    opSummaryDigest: p.opSummaryDigest ?? '',
    revoked: p.revoked,
    slashed: p.slashed,
  }
}

export class VeranaChainService {
  private signingClient!: SigningStargateClient
  private operatorAddress!: string
  private chainId!: string
  private corporationAddress!: string
  private gasAdjustment!: number

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
    this.corporationAddress = this.config.corporationAddress ?? account.address
    logger.info(
      `[VeranaChain] vs_operator address: ${this.operatorAddress} (fund this address with VNA to enable on-chain operations)`,
    )

    this.gasAdjustment = this.config.gasAdjustment ?? DEFAULT_GAS_ADJUSTMENT
    const cometClient = await connectComet(rpcUrl)
    this.signingClient = await SigningStargateClient.createWithSigner(cometClient, wallet, {
      registry: createVeranaRegistry(),
      aminoTypes: createVeranaAminoTypes(),
      gasPrice: GasPrice.fromString(gasPrice ?? '1uvna'),
    })

    this.chainId = await this.signingClient.getChainId()
    if (chainId && this.chainId !== chainId) {
      throw new Error(`[VeranaChain] Chain ID mismatch: expected "${chainId}", got "${this.chainId}"`)
    }
    logger.info(`[VeranaChain] Connected to chain: ${this.chainId}`)
  }

  // Query API (unsigned)
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
