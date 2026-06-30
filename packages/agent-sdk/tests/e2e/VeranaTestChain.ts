// e2e chain bootstrap helper for a local V4 node (corporation, ecosystem, schema, participants).
// Test-only scaffolding kept separate from the production VeranaChainService.
/* eslint-disable @typescript-eslint/no-var-requires */

import { DirectSecp256k1HdWallet, type EncodeObject, type Registry } from '@cosmjs/proto-signing'
import {
  GasPrice,
  SigningStargateClient,
  assertIsDeliverTxSuccess,
  type DeliverTxResponse,
} from '@cosmjs/stargate'
import { connectComet } from '@cosmjs/tendermint-rpc'
import { createVeranaRegistry, veranaTypeUrls } from '@verana-labs/verana-types'
import { Exec, MsgExec, MsgSubmitProposal, MsgVote } from 'cosmjs-types/cosmos/group/v1/tx'
import { ThresholdDecisionPolicy } from 'cosmjs-types/cosmos/group/v1/types'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { createHash } from 'node:crypto'

const VERANA_BECH32_PREFIX = 'verana'
const GAS_PRICE = process.env.FLOW_GAS_PRICE || '0.3uvna'
const CORP_FUNDING = process.env.FLOW_CORP_FUNDING || '100000000000'

const GROUP_SUBMIT_PROPOSAL = '/cosmos.group.v1.MsgSubmitProposal'
const GROUP_VOTE = '/cosmos.group.v1.MsgVote'
const GROUP_EXEC = '/cosmos.group.v1.MsgExec'

const { MsgCreateCorporation, MsgCreateCorporationResponse } =
  require('@verana-labs/verana-types/codec/verana/co/v1/tx') as any
const { MsgCreateEcosystem, MsgCreateEcosystemResponse } =
  require('@verana-labs/verana-types/codec/verana/ec/v1/tx') as any
const { MsgGrantOperatorAuthorization } = require('@verana-labs/verana-types/codec/verana/de/v1/tx') as any
const { MsgCreateCredentialSchema } = require('@verana-labs/verana-types/codec/verana/cs/v1/tx') as any
const {
  MsgCreateRootParticipant,
  MsgCreateRootParticipantResponse,
  MsgStartParticipantOP,
  MsgStartParticipantOPResponse,
} = require('@verana-labs/verana-types/codec/verana/pp/v1/tx') as any

const PP_START_OP = '/verana.pp.v1.MsgStartParticipantOP'
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

export const PARTICIPANT_ROLE_ISSUER = 1

const OPERATOR_GRANT_MSG_TYPES = [
  veranaTypeUrls.MsgCreateEcosystem,
  veranaTypeUrls.MsgUpdateEcosystem,
  veranaTypeUrls.MsgArchiveEcosystem,
  veranaTypeUrls.MsgCreateCredentialSchema,
  veranaTypeUrls.MsgCreateRootParticipant,
  PP_START_OP,
  PP_VALIDATE,
]

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

export interface CorporationResult {
  corporationId: number
  policyAddress: string
  txHash: string
}

export interface EcosystemResult {
  ecosystemId: number
  txHash: string
}

function sri(input: string): string {
  return `sha384-${createHash('sha384').update(input).digest('base64')}`
}

export class VeranaTestChain {
  private constructor(
    private readonly client: SigningStargateClient,
    private readonly registry: Registry,
    readonly address: string,
    readonly chainId: string,
  ) {}

  static async connect(rpcUrl: string, mnemonic: string): Promise<VeranaTestChain> {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: VERANA_BECH32_PREFIX,
    })
    const [account] = await wallet.getAccounts()

    const registry = createVeranaRegistry() as Registry
    registry.register(GROUP_SUBMIT_PROPOSAL, MsgSubmitProposal)
    registry.register(GROUP_VOTE, MsgVote)
    registry.register(GROUP_EXEC, MsgExec)

    const cometClient = await connectComet(rpcUrl)
    const client = await SigningStargateClient.createWithSigner(cometClient, wallet, {
      registry,
      gasPrice: GasPrice.fromString(GAS_PRICE),
    })
    return new VeranaTestChain(client, registry, account.address, await client.getChainId())
  }

  disconnect(): void {
    this.client.disconnect()
  }

  private async broadcast(messages: EncodeObject[]): Promise<DeliverTxResponse> {
    const result = await this.client.signAndBroadcast(this.address, messages, 'auto')
    assertIsDeliverTxSuccess(result)
    return result
  }

  async createCorporation(params: { did: string; language?: string }): Promise<CorporationResult> {
    const { did, language = 'en' } = params
    const decisionPolicy = Any.fromPartial({
      typeUrl: '/cosmos.group.v1.ThresholdDecisionPolicy',
      value: ThresholdDecisionPolicy.encode(
        ThresholdDecisionPolicy.fromPartial({
          threshold: '1',
          windows: {
            votingPeriod: { seconds: BigInt(60), nanos: 0 },
            minExecutionPeriod: { seconds: BigInt(0), nanos: 0 },
          },
        }),
      ).finish(),
    })

    const msg = {
      typeUrl: veranaTypeUrls.MsgCreateCorporation,
      value: MsgCreateCorporation.fromPartial({
        signer: this.address,
        members: [{ address: this.address, weight: '1', metadata: 'founder' }],
        groupMetadata: `corporation:${did}`,
        groupPolicyMetadata: `policy:${did}`,
        decisionPolicy,
        did,
        language,
        docUrl: 'https://example.com/governance-framework.json',
        docDigestSri: sri('corp cgf v1'),
      }),
    }

    const res = await this.broadcast([msg])
    const decoded = MsgCreateCorporationResponse.decode(res.msgResponses[0].value)
    return {
      corporationId: Number(decoded.corporationId),
      policyAddress: decoded.policyAddress,
      txHash: res.transactionHash,
    }
  }

  async fundCorporation(policyAddress: string): Promise<void> {
    await this.client.sendTokens(
      this.address,
      policyAddress,
      [{ denom: 'uvna', amount: CORP_FUNDING }],
      'auto',
    )
  }

  async grantOperatorAuthorization(policyAddress: string): Promise<void> {
    const grant = {
      typeUrl: veranaTypeUrls.MsgGrantOperatorAuthorization,
      value: MsgGrantOperatorAuthorization.fromPartial({
        corporation: policyAddress,
        operator: '',
        grantee: this.address,
        msgTypes: OPERATOR_GRANT_MSG_TYPES,
      }),
    }

    const submit = {
      typeUrl: GROUP_SUBMIT_PROPOSAL,
      value: MsgSubmitProposal.fromPartial({
        groupPolicyAddress: policyAddress,
        proposers: [this.address],
        metadata: 'grant-operator-authz',
        messages: [this.registry.encodeAsAny(grant)],
        exec: Exec.EXEC_TRY,
        title: 'Grant operator authz',
        summary: 'Authorize the operator to manage ecosystems on behalf of the corporation',
      }),
    }

    await this.broadcast([submit])
  }

  async createEcosystem(
    policyAddress: string,
    params: { did: string; language?: string },
  ): Promise<EcosystemResult> {
    const { did, language = 'en' } = params
    const msg = {
      typeUrl: veranaTypeUrls.MsgCreateEcosystem,
      value: MsgCreateEcosystem.fromPartial({
        corporation: policyAddress,
        operator: this.address,
        did,
        language,
        docUrl: 'https://example.com/governance-framework.json',
        docDigestSri: sri('eco gf v1'),
      }),
    }

    const res = await this.broadcast([msg])
    const decoded = MsgCreateEcosystemResponse.decode(res.msgResponses[0].value)
    return { ecosystemId: Number(decoded.ecosystemId), txHash: res.transactionHash }
  }

  /** A second funded account used as the agent's session vs_operator (VSOA), distinct from the OA operator. */
  async createFundedOperator(amount = '50000000000'): Promise<{ mnemonic: string; address: string }> {
    const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: VERANA_BECH32_PREFIX })
    const [account] = await wallet.getAccounts()
    await this.client.sendTokens(this.address, account.address, [{ denom: 'uvna', amount }], 'auto')
    return { mnemonic: wallet.mnemonic, address: account.address }
  }

  async createCredentialSchema(
    policyAddress: string,
    params: { ecosystemId: number; jsonSchema: string },
  ): Promise<{ schemaId: number; txHash: string }> {
    const msg = {
      typeUrl: veranaTypeUrls.MsgCreateCredentialSchema,
      value: MsgCreateCredentialSchema.fromPartial({
        corporation: policyAddress,
        operator: this.address,
        ecosystemId: params.ecosystemId,
        jsonSchema: params.jsonSchema,
        issuerGrantorValidationValidityPeriod: { value: 365 },
        verifierGrantorValidationValidityPeriod: { value: 365 },
        issuerValidationValidityPeriod: { value: 365 },
        verifierValidationValidityPeriod: { value: 365 },
        holderValidationValidityPeriod: { value: 365 },
        issuerOnboardingMode: 2,
        verifierOnboardingMode: 2,
        holderOnboardingMode: 1,
        pricingAssetType: 1,
        pricingAsset: 'tu',
        digestAlgorithm: 'sha384',
      }),
    }
    const res = await this.broadcast([msg])
    const raw = res.events
      .find(e => e.type === 'create_credential_schema')
      ?.attributes.find(a => a.key === 'credential_schema_id')
      ?.value?.replace(/"/g, '')
    return { schemaId: Number(raw), txHash: res.transactionHash }
  }

  async createRootParticipant(
    policyAddress: string,
    params: { schemaId: number; did: string },
  ): Promise<{ participantId: number; txHash: string }> {
    const msg = {
      typeUrl: veranaTypeUrls.MsgCreateRootParticipant,
      value: MsgCreateRootParticipant.fromPartial({
        corporation: policyAddress,
        operator: this.address,
        schemaId: params.schemaId,
        did: params.did,
        effectiveFrom: new Date(Date.now() + 5_000),
        effectiveUntil: new Date(Date.now() + 3_153_600_000_000),
      }),
    }
    const res = await this.broadcast([msg])
    const participantId = Number(MsgCreateRootParticipantResponse.decode(res.msgResponses[0].value).id)
    return { participantId, txHash: res.transactionHash }
  }

  /** Creates the applicant participant and grants `vsOperator` an inline VSOA for the session. */
  async startParticipantOp(
    policyAddress: string,
    params: { role: number; validatorParticipantId: number; did: string; vsOperator: string },
  ): Promise<{ participantId: number; txHash: string }> {
    const msg = {
      typeUrl: veranaTypeUrls.MsgStartParticipantOP,
      value: MsgStartParticipantOP.fromPartial({
        corporation: policyAddress,
        operator: this.address,
        role: params.role,
        validatorParticipantId: params.validatorParticipantId,
        did: params.did,
        vsOperator: params.vsOperator,
        vsOperatorAuthzMsgTypes: [PP_SESSION],
      }),
    }
    // The root validator has a future effective_from; retry until it is ACTIVE.
    let lastErr: unknown
    for (let i = 0; i < 12; i++) {
      try {
        const res = await this.broadcast([msg])
        const participantId = Number(
          MsgStartParticipantOPResponse.decode(res.msgResponses[0].value).participantId,
        )
        return { participantId, txHash: res.transactionHash }
      } catch (e) {
        lastErr = e
        if (!String((e as Error).message).includes('not yet effective')) throw e
        await delay(3_000)
      }
    }
    throw lastErr
  }
}
