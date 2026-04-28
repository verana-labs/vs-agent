// Types: enums, events, API option interfaces
export {
  VtFlowEventTypes,
  VtFlowRole,
  VtFlowState,
  VtFlowTerminalStates,
  VtFlowVariant,
  isVtFlowTerminalState,
} from './types'
export type {
  NotifyCredentialStateChangeOptions,
  OfferCredentialForSessionOptions,
  ProblemReportDispatchOptions,
  SendIssuanceRequestOptions,
  SendOobLinkOptions,
  SendValidationRequestOptions,
  VtFlowStateChangedEvent,
} from './types'

// Wire messages
export {
  VT_FLOW_PROTOCOL_URI,
  VT_FLOW_VALIDATION_REQUEST_TYPE,
  VT_FLOW_ISSUANCE_REQUEST_TYPE,
  VT_FLOW_OOB_LINK_TYPE,
  VT_FLOW_VALIDATING_TYPE,
  VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE,
  ValidationRequestMessage,
  IssuanceRequestMessage,
  OobLinkMessage,
  ValidatingMessage,
  CredentialStateChangeMessage,
  VtCredentialState,
} from './messages'
export type {
  ValidationRequestMessageOptions,
  IssuanceRequestMessageOptions,
  OobLinkMessageOptions,
  ValidatingMessageOptions,
  CredentialStateChangeMessageOptions,
} from './messages'

// Errors
export { VT_FLOW_ERROR_INFO, VtFlowErrorCode, buildVtFlowProblemReport, isVtFlowErrorCode } from './errors'
export type { BuildVtFlowProblemReportOptions, ErrorImpact, VtFlowErrorInfo, WhoRetries } from './errors'

// Record + Repository
export { VtFlowRecord, VtFlowRepository } from './repository'
export type { CustomVtFlowTags, DefaultVtFlowTags, VtFlowStorageProps, VtFlowTags } from './repository'

// Service
export { VtFlowService } from './services'
export type { CreateIssuanceRequestParams, CreateValidationRequestParams } from './services'

// Handlers
export {
  CredentialStateChangeHandler,
  IssuanceRequestHandler,
  OobLinkHandler,
  ValidatingHandler,
  ValidationRequestHandler,
} from './handlers'

// Module surface
export { VtFlowModuleConfig } from './VtFlowModuleConfig'
export type {
  VtFlowAssertVerifiableServiceContext,
  VtFlowAssertVerifiableServiceHook,
  VtFlowBuildCredentialOfferContext,
  VtFlowBuildCredentialOfferHook,
  VtFlowCredentialLifecycleContext,
  VtFlowCredentialOfferPayload,
  VtFlowModuleConfigOptions,
  VtFlowOnCompletedHook,
  VtFlowVerifyCredentialHook,
} from './VtFlowModuleConfig'

export { VtFlowModule } from './VtFlowModule'
export { VtFlowApi } from './VtFlowApi'

export { setupVtFlow } from './setupVtFlow'
export type { VtFlowSetup } from './setupVtFlow'
