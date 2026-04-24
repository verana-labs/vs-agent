import type { VtFlowRecord } from './repository/VtFlowRecord'
import type { AgentContext } from '@credo-ts/core'
import type { DidCommCredentialExchangeRecord } from '@credo-ts/didcomm'

export interface VtFlowCredentialLifecycleContext {
  agentContext: AgentContext
  record: VtFlowRecord
  credentialExchangeRecord: DidCommCredentialExchangeRecord
}

/** Applicant hook fired on `credential-received`; return `true` to auto-Ack, `false`/omit to leave the Ack to the caller. */
export type VtFlowVerifyCredentialHook = (ctx: VtFlowCredentialLifecycleContext) => Promise<boolean>

/** Fired on COMPLETED on both sides; typical applicant use is to link the credential to its DID Document. */
export type VtFlowOnCompletedHook = (ctx: VtFlowCredentialLifecycleContext) => Promise<void>

export interface VtFlowBuildCredentialOfferContext {
  agentContext: AgentContext
  record: VtFlowRecord
}

export interface VtFlowCredentialOfferPayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  credentialFormats: any
  comment?: string
  goal?: string
  goalCode?: string
}

/** Validator hook that builds the credential offer payload; return `null` to suppress the auto-offer for a record. */
export type VtFlowBuildCredentialOfferHook = (
  ctx: VtFlowBuildCredentialOfferContext,
) => Promise<VtFlowCredentialOfferPayload | null>

/** Options accepted by VtFlowModule; all flags default to false, `oobExpirationDays` defaults to 7, `terminalRetentionDays` to 90. */
export interface VtFlowModuleConfigOptions {
  oobExpirationDays?: number
  terminalRetentionDays?: number
  autoAcceptValidationRequest?: boolean
  autoAcceptIssuanceRequest?: boolean
  verifyCredential?: VtFlowVerifyCredentialHook
  onCompleted?: VtFlowOnCompletedHook
  autoMarkValidated?: boolean
  autoOfferCredential?: boolean
  buildCredentialOffer?: VtFlowBuildCredentialOfferHook
  autoAcceptCredentialOffer?: boolean
  autoIssueCredentialOnRequest?: boolean
}

/** Read-only view over VtFlowModuleConfigOptions with defaults applied. */
export class VtFlowModuleConfig {
  private readonly options: VtFlowModuleConfigOptions

  public constructor(options: VtFlowModuleConfigOptions = {}) {
    this.options = options
  }

  public get oobExpirationDays(): number {
    return this.options.oobExpirationDays ?? 7
  }

  public get terminalRetentionDays(): number {
    return this.options.terminalRetentionDays ?? 90
  }

  public get autoAcceptValidationRequest(): boolean {
    return this.options.autoAcceptValidationRequest ?? false
  }

  public get autoAcceptIssuanceRequest(): boolean {
    return this.options.autoAcceptIssuanceRequest ?? false
  }

  public get verifyCredential(): VtFlowVerifyCredentialHook | undefined {
    return this.options.verifyCredential
  }

  public get onCompleted(): VtFlowOnCompletedHook | undefined {
    return this.options.onCompleted
  }

  public get autoMarkValidated(): boolean {
    return this.options.autoMarkValidated ?? false
  }

  public get autoOfferCredential(): boolean {
    return this.options.autoOfferCredential ?? false
  }

  public get buildCredentialOffer(): VtFlowBuildCredentialOfferHook | undefined {
    return this.options.buildCredentialOffer
  }

  public get autoAcceptCredentialOffer(): boolean {
    return this.options.autoAcceptCredentialOffer ?? false
  }

  public get autoIssueCredentialOnRequest(): boolean {
    return this.options.autoIssueCredentialOnRequest ?? false
  }
}
