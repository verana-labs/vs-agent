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
  CredentialSchemaQueryClient,
  DelegationQueryClient,
  Ecosystem,
  EcosystemQueryClient,
  OperatorAuthorization,
  Participant,
  ParticipantQueryClient,
  RawParticipant,
  SelfCreateParticipantParams,
  SetParticipantOPToValidatedParams,
  StartParticipantOPParams,
  VERANA_BECH32_PREFIX,
  VeranaChainConfig,
  VsOperatorAuthorization,
} from './types'

const { QueryClientImpl: CsQueryClientImpl } = require('@verana-labs/verana-types/codec/verana/cs/v1/query')
const { QueryClientImpl: DeQueryClientImpl } = require('@verana-labs/verana-types/codec/verana/de/v1/query')
const {
  QueryClientImpl: EcQueryClientImpl,
  QueryGetEcosystemRequest,
} = require('@verana-labs/verana-types/codec/verana/ec/v1/query')
const {
  QueryClientImpl: PpQueryClientImpl,
  QueryFindParticipantsWithDIDRequest,
} = require('@verana-labs/verana-types/codec/verana/pp/v1/query')
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
const PARTICIPANT_ROLE_HOLDER = 6

function mapParticipant(p: RawParticipant): Participant {
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
  private sessionSigningClient?: SigningStargateClient
  private operatorAddress!: string
  private sessionOperatorAddress?: string
  private chainId!: string
  private corporationAddress!: string

  private ppQuery!: ParticipantQueryClient
  private deQuery!: DelegationQueryClient
  private ecQuery!: EcosystemQueryClient
  private csQuery!: CredentialSchemaQueryClient

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

    const cometClient = await connectComet(rpcUrl)
    this.signingClient = await SigningStargateClient.createWithSigner(cometClient, wallet, {
      registry: createVeranaRegistry(),
      aminoTypes: createVeranaAminoTypes(),
      gasPrice: GasPrice.fromString(gasPrice ?? '1uvna'),
    })

    if (this.config.sessionOperatorMnemonic) {
      const sessionWallet = await DirectSecp256k1HdWallet.fromMnemonic(this.config.sessionOperatorMnemonic, {
        prefix: VERANA_BECH32_PREFIX,
      })
      const [sessionAccount] = await sessionWallet.getAccounts()
      this.sessionSigningClient = await SigningStargateClient.createWithSigner(cometClient, sessionWallet, {
        registry: createVeranaRegistry(),
        aminoTypes: createVeranaAminoTypes(),
        gasPrice: GasPrice.fromString(gasPrice ?? '1uvna'),
      })
      this.sessionOperatorAddress = sessionAccount.address
    }

    this.chainId = await this.signingClient.getChainId()
    if (chainId && this.chainId !== chainId) {
      throw new Error(`[VeranaChain] Chain ID mismatch: expected "${chainId}", got "${this.chainId}"`)
    }
    logger.info(`[VeranaChain] Connected to chain: ${this.chainId}`)

    const queryClient = new QueryClient(cometClient)
    const rpc = createProtobufRpcClient(queryClient)
    this.ppQuery = new PpQueryClientImpl(rpc) as ParticipantQueryClient
    this.deQuery = new DeQueryClientImpl(rpc) as DelegationQueryClient
    this.ecQuery = new EcQueryClientImpl(rpc) as EcosystemQueryClient
    this.csQuery = new CsQueryClientImpl(rpc) as CredentialSchemaQueryClient
  }

  // Query API (unsigned)
  async getParticipant(id: number): Promise<Participant | undefined> {
    const result = await this.ppQuery.GetParticipant({ id })
    return result.participant ? mapParticipant(result.participant) : undefined
  }

  async getBalance(denom = 'uvna'): Promise<Coin> {
    return this.signingClient.getBalance(this.operatorAddress, denom)
  }

  async hasVsOperatorAuthorization(): Promise<boolean> {
    return (await this.listVsOperatorAuthorizations()).length > 0
  }

  async listOperatorAuthorizations(): Promise<OperatorAuthorization[]> {
    const result = await this.deQuery.ListOperatorAuthorizations({
      corporationId: 0,
      operator: this.operatorAddress,
      responseMaxSize: 64,
    })
    return result.operatorAuthorizations.map(a => ({
      id: a.id,
      corporationId: a.corporationId,
      operator: a.operator,
      msgTypes: a.msgTypes,
    }))
  }

  async listVsOperatorAuthorizations(): Promise<VsOperatorAuthorization[]> {
    const result = await this.deQuery.ListVSOperatorAuthorizations({
      corporationId: 0,
      vsOperator: this.operatorAddress,
      responseMaxSize: 64,
    })
    return result.vsOperatorAuthorizations.map(a => ({
      id: a.id,
      corporationId: a.corporationId,
      vsOperator: a.vsOperator,
      records: a.records.map(r => ({ participantId: r.participantId, msgTypes: r.msgTypes })),
    }))
  }

  async getEcosystem(id: number): Promise<Ecosystem | undefined> {
    // fromPartial fills the unused request fields with defaults so the request encodes correctly.
    const result = await this.ecQuery.GetEcosystem(QueryGetEcosystemRequest.fromPartial({ id }))
    if (!result.ecosystem) return undefined
    const { id: ecosystemId, did, corporationId, archived, activeVersion } = result.ecosystem
    return { id: ecosystemId, did, corporationId, archived, activeVersion }
  }

  async getCredentialSchema(id: number): Promise<CredentialSchema | undefined> {
    const result = await this.csQuery.GetCredentialSchema({ id })
    if (!result.schema) return undefined
    const s = result.schema
    return {
      id: s.id,
      ecosystemId: s.ecosystemId,
      jsonSchema: s.jsonSchema,
      issuerOnboardingMode: s.issuerOnboardingMode,
      verifierOnboardingMode: s.verifierOnboardingMode,
      holderOnboardingMode: s.holderOnboardingMode,
      archived: s.archived,
    }
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
    const result = await this.broadcastMsg(veranaTypeUrls.MsgStartParticipantOP, value)
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
    const result = await this.broadcastMsg(veranaTypeUrls.MsgRenewParticipantOP, value)
    return { txHash: result.transactionHash }
  }

  async cancelParticipantOPLastRequest(id: number): Promise<{ txHash: string }> {
    const value = MsgCancelParticipantOPLastRequest.fromPartial({
      corporation: this.corporationAddress,
      operator: this.operatorAddress,
      id,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgCancelParticipantOPLastRequest, value)
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
    const result = await this.broadcastMsg(veranaTypeUrls.MsgSelfCreateParticipant, value)
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
    const result = await this.broadcastMsg(veranaTypeUrls.MsgSetParticipantOPToValidated, value)
    return { txHash: result.transactionHash }
  }

  async createOrUpdateParticipantSession(
    params: CreateOrUpdateParticipantSessionParams,
  ): Promise<{ txHash: string }> {
    const value = MsgCreateOrUpdateParticipantSession.fromPartial({
      corporation: this.corporationAddress,
      operator: this.sessionOperatorAddress ?? this.operatorAddress,
      id: params.id,
      issuerParticipantId: params.issuerParticipantId,
      verifierParticipantId: params.verifierParticipantId,
      agentParticipantId: params.agentParticipantId,
      walletAgentParticipantId: params.walletAgentParticipantId,
      digest: params.digest,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgCreateOrUpdateParticipantSession, value, true)
    return { txHash: result.transactionHash }
  }

  async findActiveHolderParticipantIdByDid(did: string): Promise<number | undefined> {
    // fromPartial fills the unused fields with defaults so the request encodes correctly.
    const request = QueryFindParticipantsWithDIDRequest.fromPartial({ did })
    const { participants } = await this.ppQuery.FindParticipantsWithDID(request)
    return participants.find(
      p => p.did === did && p.role === PARTICIPANT_ROLE_HOLDER && !p.revoked && !p.slashed,
    )?.id
  }

  async triggerResolver(participantId: number): Promise<{ txHash: string }> {
    const value = MsgTriggerResolver.fromPartial({
      corporation: this.corporationAddress,
      operator: this.sessionOperatorAddress ?? this.operatorAddress,
      id: participantId,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgTriggerResolver, value, true)
    return { txHash: result.transactionHash }
  }

  private async broadcastMsg(
    typeUrl: string,
    value: object,
    useSessionSigner = false,
  ): Promise<DeliverTxResponse> {
    const signingClient = useSessionSigner
      ? (this.sessionSigningClient ?? this.signingClient)
      : this.signingClient
    const signerAddress = useSessionSigner
      ? (this.sessionOperatorAddress ?? this.operatorAddress)
      : this.operatorAddress
    const msg = { typeUrl, value }
    this.config.logger.debug(`[VeranaChain] Broadcasting ${typeUrl} as ${signerAddress}`)
    const result = await signingClient.signAndBroadcast(signerAddress, [msg], 'auto')
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
