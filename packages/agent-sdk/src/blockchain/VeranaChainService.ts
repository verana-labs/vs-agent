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
  ArchiveTrustRegistryParams,
  CreateCredentialSchemaParams,
  CreateOrUpdatePermissionSessionParams,
  CreateRootPermissionParams,
  CreateTrustRegistryParams,
  CredentialSchema,
  CsQueryClient,
  GrantOperatorAuthorizationParams,
  ListCredentialSchemasParams,
  ListTrustRegistriesParams,
  Permission,
  PermQueryClient,
  SelfCreatePermissionParams,
  SetPermissionVPToValidatedParams,
  StartPermissionVPParams,
  TrQueryClient,
  TrustRegistry,
  VERANA_BECH32_PREFIX,
  VeranaChainConfig,
} from './types'

const { QueryClientImpl: CsQueryClientImpl } = require('@verana-labs/verana-types/codec/verana/cs/v1/query')
const {
  MsgCreateCredentialSchema,
  MsgCreateCredentialSchemaResponse,
} = require('@verana-labs/verana-types/codec/verana/cs/v1/tx')
const { MsgGrantOperatorAuthorization } = require('@verana-labs/verana-types/codec/verana/de/v1/tx')
const {
  QueryClientImpl: PermQueryClientImpl,
} = require('@verana-labs/verana-types/codec/verana/perm/v1/query')
const {
  MsgStartPermissionVP,
  MsgStartPermissionVPResponse,
  MsgRenewPermissionVP,
  MsgSetPermissionVPToValidated,
  MsgCancelPermissionVPLastRequest,
  MsgCreateOrUpdatePermissionSession,
  MsgCreateRootPermission,
  MsgCreateRootPermissionResponse,
  MsgSelfCreatePermission,
  MsgSelfCreatePermissionResponse,
} = require('@verana-labs/verana-types/codec/verana/perm/v1/tx')
const { QueryClientImpl: TrQueryClientImpl } = require('@verana-labs/verana-types/codec/verana/tr/v1/query')
const {
  MsgArchiveTrustRegistry,
  MsgCreateTrustRegistry,
} = require('@verana-labs/verana-types/codec/verana/tr/v1/tx')

export class VeranaChainService {
  private signingClient!: SigningStargateClient
  private operatorAddress!: string
  private chainId!: string

  private permQuery!: PermQueryClient
  private trQuery!: TrQueryClient
  private csQuery!: CsQueryClient

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
      gasPrice: GasPrice.fromString(gasPrice ?? '1uvna'), // TODO: consider minium gas price
    })

    this.chainId = await this.signingClient.getChainId()
    if (chainId && this.chainId !== chainId) {
      throw new Error(`[VeranaChain] Chain ID mismatch: expected "${chainId}", got "${this.chainId}"`)
    }
    logger.info(`[VeranaChain] Connected to chain: ${this.chainId}`)

    const queryClient = new QueryClient(cometClient)
    const rpc = createProtobufRpcClient(queryClient)
    this.permQuery = new PermQueryClientImpl(rpc) as PermQueryClient
    this.trQuery = new TrQueryClientImpl(rpc) as TrQueryClient
    this.csQuery = new CsQueryClientImpl(rpc) as CsQueryClient
  }

  // Query API (unsigned)
  async getPermission(id: number): Promise<Permission | undefined> {
    const result = await this.permQuery.GetPermission({ id })
    return result.permission
  }

  async findPermissionsWithDID(params: object): Promise<Permission[]> {
    const result = await this.permQuery.FindPermissionsWithDID(params)
    return result.permissions ?? []
  }

  async getPermissionSession(uuid: string): Promise<unknown> {
    return this.permQuery.GetPermissionSession({ id: uuid })
  }

  // Transaction API (signed)
  async startPermissionVP(
    params: StartPermissionVPParams,
  ): Promise<{ txHash: string; permissionId: number }> {
    const value = MsgStartPermissionVP.fromPartial({
      corporation: this.operatorAddress,
      operator: this.operatorAddress,
      vsOperator: this.operatorAddress,
      type: params.type,
      validatorPermId: params.validatorPermId,
      did: params.did,
      validationFees: params.validationFees,
      issuanceFees: params.issuanceFees,
      verificationFees: params.verificationFees,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgStartPermissionVP, value)
    const responseBytes = result.msgResponses[0]?.value
    if (!responseBytes) {
      throw new Error('[VeranaChain] start-perm-vp tx response missing msgResponses[0]')
    }
    const response = MsgStartPermissionVPResponse.decode(responseBytes)
    return { txHash: result.transactionHash, permissionId: Number(response.permissionId) }
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
      corporation: this.operatorAddress,
      operator: this.operatorAddress,
      id: params.id,
      effectiveUntil: params.effectiveUntil,
      validationFees: params.validationFees ?? 0,
      issuanceFees: params.issuanceFees ?? 0,
      verificationFees: params.verificationFees ?? 0,
      vpSummaryDigest: params.vpSummaryDigest,
      issuanceFeeDiscount: params.issuanceFeeDiscount ?? 0,
      verificationFeeDiscount: params.verificationFeeDiscount ?? 0,
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
      corporation: this.operatorAddress,
      operator: this.operatorAddress,
      id: params.id,
      issuerPermId: params.issuerPermId,
      verifierPermId: params.verifierPermId,
      agentPermId: params.agentPermId,
      walletAgentPermId: params.walletAgentPermId,
      digest: params.digest,
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

  // Dev helpers
  async grantOperatorAuthorization(params: GrantOperatorAuthorizationParams): Promise<{ txHash: string }> {
    const value = MsgGrantOperatorAuthorization.fromPartial({
      corporation: this.operatorAddress,
      // operator: this.operatorAddress,
      grantee: params.grantee,
      msgTypes: params.msgTypes,
      expiration: params.expiration,
      authzSpendLimit: params.authzSpendLimit ?? [],
      authzSpendLimitPeriod: params.authzSpendLimitPeriod,
      withFeegrant: params.withFeegrant ?? false,
      feegrantSpendLimit: params.feegrantSpendLimit ?? [],
      feegrantSpendLimitPeriod: params.feegrantSpendLimitPeriod,
      feeSpendLimit: params.feeSpendLimit ?? [],
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgGrantOperatorAuthorization, value)
    return { txHash: result.transactionHash }
  }

  async createTrustRegistry(params: CreateTrustRegistryParams): Promise<{ txHash: string }> {
    const value = MsgCreateTrustRegistry.fromPartial({
      corporation: this.operatorAddress,
      operator: this.operatorAddress,
      did: params.did,
      aka: params.aka ?? '',
      language: params.language,
      docUrl: params.docUrl,
      docDigestSri: params.docDigestSri,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgCreateTrustRegistry, value)
    return { txHash: result.transactionHash }
  }

  async archiveTrustRegistry(params: ArchiveTrustRegistryParams): Promise<{ txHash: string }> {
    const value = MsgArchiveTrustRegistry.fromPartial({
      corporation: this.operatorAddress,
      operator: this.operatorAddress,
      trId: params.trId,
      archive: params.archive,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgArchiveTrustRegistry, value)
    return { txHash: result.transactionHash }
  }

  async listTrustRegistries(params: ListTrustRegistriesParams = {}): Promise<TrustRegistry[]> {
    const result = await this.trQuery.ListTrustRegistries({
      corporation: params.corporation ?? '',
      modifiedAfter: params.modifiedAfter,
      activeGfOnly: params.activeGfOnly ?? false,
      preferredLanguage: params.preferredLanguage ?? '',
      responseMaxSize: params.responseMaxSize ?? 0,
    } as ListTrustRegistriesParams)
    return result.trustRegistries ?? []
  }

  async createCredentialSchema(
    params: CreateCredentialSchemaParams,
  ): Promise<{ txHash: string; schemaId: number }> {
    const value = MsgCreateCredentialSchema.fromPartial({
      corporation: this.operatorAddress,
      operator: this.operatorAddress,
      trId: params.trId,
      jsonSchema: params.jsonSchema,
      issuerGrantorValidationValidityPeriod: params.issuerGrantorValidationValidityPeriod ?? { value: 0 },
      verifierGrantorValidationValidityPeriod: params.verifierGrantorValidationValidityPeriod ?? { value: 0 },
      issuerValidationValidityPeriod: params.issuerValidationValidityPeriod ?? { value: 365 },
      verifierValidationValidityPeriod: params.verifierValidationValidityPeriod ?? { value: 0 },
      holderValidationValidityPeriod: params.holderValidationValidityPeriod ?? { value: 0 },
      issuerOnboardingMode: params.issuerOnboardingMode ?? 1,
      verifierOnboardingMode: params.verifierOnboardingMode ?? 1,
      holderOnboardingMode: params.holderOnboardingMode ?? 1,
      pricingAssetType: params.pricingAssetType ?? 1,
      pricingAsset: params.pricingAsset ?? 'tu',
      digestAlgorithm: params.digestAlgorithm ?? 'sha384',
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgCreateCredentialSchema, value)
    const responseBytes = result.msgResponses[0]?.value
    if (!responseBytes) {
      throw new Error('[VeranaChain] create-credential-schema tx response missing msgResponses[0]')
    }
    const response = MsgCreateCredentialSchemaResponse.decode(responseBytes)
    return { txHash: result.transactionHash, schemaId: Number(response.id) }
  }

  async listCredentialSchemas(params: ListCredentialSchemasParams = {}): Promise<CredentialSchema[]> {
    const result = await this.csQuery.ListCredentialSchemas({
      trId: params.trId ?? 0,
      modifiedAfter: params.modifiedAfter,
      responseMaxSize: params.responseMaxSize ?? 0,
      onlyActive: params.onlyActive ?? false,
      issuerOnboardingMode: params.issuerOnboardingMode ?? 0,
      verifierOnboardingMode: params.verifierOnboardingMode ?? 0,
      holderOnboardingMode: params.holderOnboardingMode ?? 0,
    } as ListCredentialSchemasParams)
    return result.schemas ?? []
  }

  async createRootPermission(
    params: CreateRootPermissionParams,
  ): Promise<{ txHash: string; permissionId: number }> {
    const value = MsgCreateRootPermission.fromPartial({
      corporation: this.operatorAddress,
      operator: this.operatorAddress,
      schemaId: params.schemaId,
      did: params.did,
      effectiveFrom: params.effectiveFrom,
      effectiveUntil: params.effectiveUntil,
      validationFees: params.validationFees ?? 0,
      issuanceFees: params.issuanceFees ?? 0,
      verificationFees: params.verificationFees ?? 0,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgCreateRootPermission, value)
    const responseBytes = result.msgResponses[0]?.value
    if (!responseBytes) {
      throw new Error('[VeranaChain] create-root-permission tx response missing msgResponses[0]')
    }
    const response = MsgCreateRootPermissionResponse.decode(responseBytes)
    return { txHash: result.transactionHash, permissionId: Number(response.id) }
  }

  async selfCreatePermission(
    params: SelfCreatePermissionParams,
  ): Promise<{ txHash: string; permissionId: number }> {
    const value = MsgSelfCreatePermission.fromPartial({
      corporation: this.operatorAddress,
      operator: this.operatorAddress,
      type: params.type,
      validatorPermId: params.validatorPermId,
      did: params.did,
      effectiveFrom: params.effectiveFrom,
      effectiveUntil: params.effectiveUntil,
      validationFees: params.validationFees ?? 0,
      verificationFees: params.verificationFees ?? 0,
      vsOperator: params.vsOperator ?? '',
      vsOperatorAuthzEnabled: params.vsOperatorAuthzEnabled ?? false,
      vsOperatorAuthzSpendLimit: params.vsOperatorAuthzSpendLimit ?? [],
      vsOperatorAuthzWithFeegrant: params.vsOperatorAuthzWithFeegrant ?? false,
      vsOperatorAuthzFeeSpendLimit: params.vsOperatorAuthzFeeSpendLimit ?? [],
      vsOperatorAuthzSpendPeriod: params.vsOperatorAuthzSpendPeriod,
    })
    const result = await this.broadcastMsg(veranaTypeUrls.MsgSelfCreatePermission, value)
    const responseBytes = result.msgResponses[0]?.value
    if (!responseBytes) {
      throw new Error('[VeranaChain] self-create-permission tx response missing msgResponses[0]')
    }
    const response = MsgSelfCreatePermissionResponse.decode(responseBytes)
    return { txHash: result.transactionHash, permissionId: Number(response.id) }
  }
}
