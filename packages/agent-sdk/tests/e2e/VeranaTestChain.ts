/* eslint-disable @typescript-eslint/no-var-requires */

import { DirectSecp256k1HdWallet, type EncodeObject, type Registry } from '@cosmjs/proto-signing'
import {
  GasPrice,
  SigningStargateClient,
  assertIsDeliverTxSuccess,
  type DeliverTxResponse,
} from '@cosmjs/stargate'
import { connectComet } from '@cosmjs/tendermint-rpc'
import { createVeranaRegistry, veranaTypeUrls } from '@verana-labs/verana-types-next'
import { Exec, MsgExec, MsgSubmitProposal, MsgVote } from 'cosmjs-types/cosmos/group/v1/tx'
import { ThresholdDecisionPolicy } from 'cosmjs-types/cosmos/group/v1/types'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { createHash } from 'node:crypto'

const VERANA_BECH32_PREFIX = 'verana'
const GAS_PRICE = process.env.FLOW_GAS_PRICE || '0.3uvna'
// 100 VNA: enough to cover the trust deposits + fees the ecosystem path requires.
const CORP_FUNDING = process.env.FLOW_CORP_FUNDING || '100000000000'

const GROUP_SUBMIT_PROPOSAL = '/cosmos.group.v1.MsgSubmitProposal'
const GROUP_VOTE = '/cosmos.group.v1.MsgVote'
const GROUP_EXEC = '/cosmos.group.v1.MsgExec'

// Verana protobuf codecs (CommonJS require mirrors VeranaChainService).
const { MsgCreateCorporation, MsgCreateCorporationResponse } =
  require('@verana-labs/verana-types-next/codec/verana/co/v1/tx') as any
const { MsgCreateEcosystem, MsgCreateEcosystemResponse } =
  require('@verana-labs/verana-types-next/codec/verana/ec/v1/tx') as any
const { MsgGrantOperatorAuthorization } =
  require('@verana-labs/verana-types-next/codec/verana/de/v1/tx') as any

// Message types the corporation authorizes its operator (cooluser) to run.
const OPERATOR_GRANT_MSG_TYPES = [
  veranaTypeUrls.MsgCreateEcosystem,
  veranaTypeUrls.MsgUpdateEcosystem,
  veranaTypeUrls.MsgArchiveEcosystem,
]

export interface CorporationResult {
  corporationId: number
  policyAddress: string
}

export interface EcosystemResult {
  ecosystemId: number
}

/** Compute a valid sha384 Subresource Integrity digest (replaces the in-container python). */
function sri(input: string): string {
  return `sha384-${createHash('sha384').update(input).digest('base64')}`
}

/**
 * Thin, typed CosmJS driver that exercises the Verana chain end-to-end from
 * TypeScript — no `docker exec`, no bash. Mirrors the patterns in
 * `VeranaChainService` but targets the corporation / ecosystem modules.
 */
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
    // x/group proposal messages are not part of the default registry.
    registry.register(GROUP_SUBMIT_PROPOSAL, MsgSubmitProposal)
    registry.register(GROUP_VOTE, MsgVote)
    registry.register(GROUP_EXEC, MsgExec)

    const cometClient = await connectComet(rpcUrl)
    const client = await SigningStargateClient.createWithSigner(cometClient, wallet, {
      registry,
      gasPrice: GasPrice.fromString(GAS_PRICE),
    })
    const chainId = await client.getChainId()
    return new VeranaTestChain(client, registry, account.address, chainId)
  }

  disconnect(): void {
    this.client.disconnect()
  }

  private async broadcast(messages: EncodeObject[]): Promise<DeliverTxResponse> {
    const result = await this.client.signAndBroadcast(this.address, messages, 'auto')
    assertIsDeliverTxSuccess(result)
    return result
  }

  /** Creates a Corporation (self-administered x/group policy) and returns its policy address. */
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
    return { corporationId: Number(decoded.corporationId), policyAddress: decoded.policyAddress }
  }

  /** Funds a corporation policy account so it can pay trust deposits + fees. */
  async fundCorporation(policyAddress: string): Promise<void> {
    await this.client.sendTokens(
      this.address,
      policyAddress,
      [{ denom: 'uvna', amount: CORP_FUNDING }],
      'auto',
    )
  }

  /**
   * Corporation grants operator authorization to the test wallet via an x/group
   * proposal executed immediately (EXEC_TRY: the sole proposer counts as YES).
   */
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

  /** Creates an Ecosystem on behalf of the (funded, granting) corporation. */
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
    return { ecosystemId: Number(decoded.ecosystemId) }
  }
}
