import type { VtFlowRecord } from './repository/VtFlowRecord'
import type { AgentContext } from '@credo-ts/core'
import type { DidCommCredentialExchangeRecord } from '@credo-ts/didcomm'

export interface VtFlowCredentialLifecycleContext {
  agentContext: AgentContext
  record: VtFlowRecord
  credentialExchangeRecord: DidCommCredentialExchangeRecord
}

/**
 * Applicant hook fired on `credential-received`. Return `true` to auto-Ack;
 * `false` (or omit) to leave the Ack to the caller.
 */
export type VtFlowVerifyCredentialHook = (ctx: VtFlowCredentialLifecycleContext) => Promise<boolean>

/** Fired on COMPLETED. Typical applicant use: link the credential to the DID Doc. */
export type VtFlowOnCompletedHook = (ctx: VtFlowCredentialLifecycleContext) => Promise<void>

export interface VtFlowBuildCredentialOfferContext {
  agentContext: AgentContext
  record: VtFlowRecord
}

export interface VtFlowCredentialOfferPayload {
  // biome-ignore lint/suspicious/noExplicitAny: format depends on host agent registrations.
  credentialFormats: any
  comment?: string
  goal?: string
  goalCode?: string
}

/**
 * Validator hook that builds the credential offer payload. Return `null`
 * to suppress the auto-offer for a record.
 */
export type VtFlowBuildCredentialOfferHook = (
  ctx: VtFlowBuildCredentialOfferContext,
) => Promise<VtFlowCredentialOfferPayload | null>

export interface VtFlowModuleConfigOptions {
  /** @default 7 */
  oobExpirationDays?: number

  /** @default 90 */
  terminalRetentionDays?: number

  /** Validator: auto-accept VR (AWAITING_VR => VALIDATING). @default false */
  autoAcceptValidationRequest?: boolean

  /** Validator: auto-accept IR (AWAITING_IR => VALIDATING). @default false */
  autoAcceptIssuanceRequest?: boolean

  verifyCredential?: VtFlowVerifyCredentialHook

  onCompleted?: VtFlowOnCompletedHook

  /** Validator, §5.1: auto-mark VALIDATED on VALIDATING. Demo-only. @default false */
  autoMarkValidated?: boolean

  /** Validator: auto-fire offerCredentialForSession when ready. Demo-only. @default false */
  autoOfferCredential?: boolean

  buildCredentialOffer?: VtFlowBuildCredentialOfferHook

  /** Applicant: auto-accept issuer-initiated offers (Credo's ContentApproved skips these). @default false */
  autoAcceptCredentialOffer?: boolean

  /** Validator: auto-accept the applicant's request and issue. @default false */
  autoIssueCredentialOnRequest?: boolean
}

/** Read-only view over {@link VtFlowModuleConfigOptions} with defaults applied. */
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
