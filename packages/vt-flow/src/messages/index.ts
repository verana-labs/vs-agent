// Wire message classes for the vt-flow superprotocol. See
// `doc/vt-flow-protocol.md` §Messages for the canonical message inventory.

export {
  VT_FLOW_PROTOCOL_URI,
  VT_FLOW_VALIDATION_REQUEST_TYPE,
  VT_FLOW_ISSUANCE_REQUEST_TYPE,
  VT_FLOW_OOB_LINK_TYPE,
  VT_FLOW_VALIDATING_TYPE,
  VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE,
} from './VtFlowProtocol'

export { ValidationRequestMessage } from './ValidationRequestMessage'
export type { ValidationRequestMessageOptions } from './ValidationRequestMessage'

export { IssuanceRequestMessage } from './IssuanceRequestMessage'
export type { IssuanceRequestMessageOptions } from './IssuanceRequestMessage'

export { OobLinkMessage } from './OobLinkMessage'
export type { OobLinkMessageOptions } from './OobLinkMessage'

export { ValidatingMessage } from './ValidatingMessage'
export type { ValidatingMessageOptions } from './ValidatingMessage'

export { CredentialStateChangeMessage, VtCredentialState } from './CredentialStateChangeMessage'
export type { CredentialStateChangeMessageOptions } from './CredentialStateChangeMessage'
