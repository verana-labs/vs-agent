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
import Long from 'long'

import {
  CreateOrUpdatePermissionSessionParams,
  PermQueryClient,
  SetPermissionVPToValidatedParams,
  StartPermissionVPParams,
  VERANA_BECH32_PREFIX,
  VeranaChainConfig,
} from './types'

const {
  QueryClientImpl: PermQueryClientImpl,
} = require('@verana-labs/verana-types/codec/verana/perm/v1/query')
const {
  MsgStartPermissionVP,
  MsgRenewPermissionVP,
  MsgSetPermissionVPToValidated,
  MsgCancelPermissionVPLastRequest,
  MsgCreateOrUpdatePermissionSession,
} = require('@verana-labs/verana-types/codec/verana/perm/v1/tx')

export class VeranaChainService {
  private signingClient!: SigningStargateClient
  private operatorAddress!: string
  private chainId!: string

  private permQuery!: PermQueryClient

  constructor(private readonly config: VeranaChainConfig) {}

  get address(): string {
    return this.operatorAddress
  }

  get getChainId(): string {
    return this.chainId
  }

  async start(): Promise<void> {
    const { rpcUrl, mnemonic, chainId, logger, gasPrice } = this.config

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: VERANA_BECH32_PREFIX,
    })
    const [account] = await wallet.getAccounts()
    this.operatorAddress = account.address
    logger.info(
      `[VeranaChain] vs_operator address: ${this.operatorAddress} (fund this address with VNA to enable on-chain operations)`,
    )

    const cometClient = await connectComet(rpcUrl)
    this.signingClient = await SigningStargateClient.createWithSigner(cometClient, wallet, {
      registry: createVeranaRegistry(),
      aminoTypes: createVeranaAminoTypes(),
      gasPrice: GasPrice.fromString(gasPrice ?? '0uvna'), // TODO: consider minium gas price
    })

    this.chainId = await this.signingClient.getChainId()
    if (chainId && this.chainId !== chainId) {
      throw new Error(`[VeranaChain] Chain ID mismatch: expected "${chainId}", got "${this.chainId}"`)
    }
    logger.info(`[VeranaChain] Connected to chain: ${this.chainId}`)

    const queryClient = new QueryClient(cometClient)
    const rpc = createProtobufRpcClient(queryClient)
    this.permQuery = new PermQueryClientImpl(rpc) as PermQueryClient
  }

  // Query API (No signed)
  async getPermission(id: Long): Promise<unknown> {
    return this.permQuery.GetPermission({ id })
  }

  async findPermissionsWithDID(params: object): Promise<unknown[]> {
    const result = await this.permQuery.FindPermissionsWithDID(params)
    return result.permissions ?? []
  }

  async getPermissionSession(uuid: string): Promise<unknown> {
    return this.permQuery.GetPermissionSession({ id: uuid })
  }

  // Transaction API (Signed)
  async startPermissionVP(params: StartPermissionVPParams): Promise<{ txHash: string }> {
    const value = MsgStartPermissionVP.fromPartial({
      creator: this.operatorAddress,
      type: params.type,
      validatorPermId: params.validatorPermId,
      country: params.country,
      did: params.did,
      validationFees: params.validationFees,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgStartPermissionVP, value)
    return { txHash: result.transactionHash }
  }

  async renewPermissionVP(id: Long): Promise<{ txHash: string }> {
    const value = MsgRenewPermissionVP.fromPartial({
      creator: this.operatorAddress,
      id,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgRenewPermissionVP, value)
    return { txHash: result.transactionHash }
  }

  async setPermissionVPToValidated(params: SetPermissionVPToValidatedParams): Promise<{ txHash: string }> {
    const value = MsgSetPermissionVPToValidated.fromPartial({
      creator: this.operatorAddress,
      id: params.id,
      effectiveUntil: params.effectiveUntil,
      validationFees: params.validationFees,
      issuanceFees: params.issuanceFees,
      verificationFees: params.verificationFees,
      country: params.country,
      vpSummaryDigestSri: params.vpSummaryDigestSri,
      issuanceFeeDiscount: params.issuanceFeeDiscount,
      verificationFeeDiscount: params.verificationFeeDiscount,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgSetPermissionVPToValidated, value)
    return { txHash: result.transactionHash }
  }

  async cancelPermissionVPLastRequest(id: Long): Promise<{ txHash: string }> {
    const value = MsgCancelPermissionVPLastRequest.fromPartial({
      creator: this.operatorAddress,
      id,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgCancelPermissionVPLastRequest, value)
    return { txHash: result.transactionHash }
  }

  async createOrUpdatePermissionSession(
    params: CreateOrUpdatePermissionSessionParams,
  ): Promise<{ txHash: string }> {
    const value = MsgCreateOrUpdatePermissionSession.fromPartial({
      creator: this.operatorAddress,
      id: params.id,
      issuerPermId: params.issuerPermId,
      verifierPermId: params.verifierPermId,
      agentPermId: params.agentPermId,
      walletAgentPermId: params.walletAgentPermId,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgCreateOrUpdatePermissionSession, value)
    return { txHash: result.transactionHash }
  }

  private async broadcastMsg(typeUrl: string, value: object): Promise<DeliverTxResponse> {
    const msg = { typeUrl, value }
    this.config.logger.debug(`[VeranaChain] Broadcasting ${typeUrl}`)
    const result = await this.signingClient.signAndBroadcast(this.operatorAddress, [msg], 'auto')
    assertIsDeliverTxSuccess(result)
    this.config.logger.info(`[VeranaChain] Tx success: ${result.transactionHash}`)
    return result
  }
}
