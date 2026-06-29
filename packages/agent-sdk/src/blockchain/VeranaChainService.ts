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
  Participant,
  ParticipantQueryClient,
  RawParticipant,
  SetParticipantOPToValidatedParams,
  VERANA_BECH32_PREFIX,
  VeranaChainConfig,
} from './types'

const { QueryClientImpl: PpQueryClientImpl } = require('@verana-labs/verana-types/codec/verana/pp/v1/query')
const {
  MsgSetParticipantOPToValidated,
  MsgCreateOrUpdateParticipantSession,
} = require('@verana-labs/verana-types/codec/verana/pp/v1/tx')

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
  private operatorAddress!: string
  private chainId!: string
  private corporationAddress!: string

  private ppQuery!: ParticipantQueryClient

  // FIXME(verana setValidated->AUTHZ-CHECK-3): temporary second account that signs the session only.
  private sessionSigningClient?: SigningStargateClient
  private sessionOperatorAddress?: string

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

    this.chainId = await this.signingClient.getChainId()
    if (chainId && this.chainId !== chainId) {
      throw new Error(`[VeranaChain] Chain ID mismatch: expected "${chainId}", got "${this.chainId}"`)
    }
    logger.info(`[VeranaChain] Connected to chain: ${this.chainId}`)

    // FIXME(verana setValidated->AUTHZ-CHECK-3): validating needs an OperatorAuthorization and the session
    // needs a mutually-exclusive VSOperatorAuthorization, so when configured the agent signs the session
    // with a second account. Remove once both are authorized under one vs_operator.
    if (this.config.sessionOperatorMnemonic) {
      const sessionWallet = await DirectSecp256k1HdWallet.fromMnemonic(this.config.sessionOperatorMnemonic, {
        prefix: VERANA_BECH32_PREFIX,
      })
      const [sessionAccount] = await sessionWallet.getAccounts()
      this.sessionOperatorAddress = sessionAccount.address
      this.sessionSigningClient = await SigningStargateClient.createWithSigner(cometClient, sessionWallet, {
        registry: createVeranaRegistry(),
        aminoTypes: createVeranaAminoTypes(),
        gasPrice: GasPrice.fromString(gasPrice ?? '1uvna'),
      })
      logger.info(`[VeranaChain] session vs_operator: ${this.sessionOperatorAddress}`)
    }

    const queryClient = new QueryClient(cometClient)
    const rpc = createProtobufRpcClient(queryClient)
    this.ppQuery = new PpQueryClientImpl(rpc) as ParticipantQueryClient
  }

  // Query API (unsigned)
  async getParticipant(id: number): Promise<Participant | undefined> {
    const result = await this.ppQuery.GetParticipant({ id })
    return result.participant ? mapParticipant(result.participant) : undefined
  }

  async getBalance(denom = 'uvna'): Promise<Coin> {
    return this.signingClient.getBalance(this.operatorAddress, denom)
  }

  // Transaction API (signed)
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
    // FIXME(verana setValidated->AUTHZ-CHECK-3): sign the session with the VSOA account when configured.
    const operator = this.sessionOperatorAddress ?? this.operatorAddress
    const value = MsgCreateOrUpdateParticipantSession.fromPartial({
      corporation: this.corporationAddress,
      operator,
      id: params.id,
      issuerParticipantId: params.issuerParticipantId,
      verifierParticipantId: params.verifierParticipantId,
      agentParticipantId: params.agentParticipantId,
      walletAgentParticipantId: params.walletAgentParticipantId,
      digest: params.digest,
    })
    const result = await this.broadcastMsg(
      veranaTypeUrls.MsgCreateOrUpdateParticipantSession,
      value,
      this.sessionSigningClient ?? this.signingClient,
      operator,
    )
    return { txHash: result.transactionHash }
  }

  private async broadcastMsg(
    typeUrl: string,
    value: object,
    client: SigningStargateClient = this.signingClient,
    signer: string = this.operatorAddress,
  ): Promise<DeliverTxResponse> {
    const msg = { typeUrl, value }
    this.config.logger.debug(`[VeranaChain] Broadcasting ${typeUrl}`)
    const result = await client.signAndBroadcast(signer, [msg], 'auto')
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
