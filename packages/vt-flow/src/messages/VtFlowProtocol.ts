/** Canonical URIs for the five vt-flow superprotocol messages. */
export const VT_FLOW_PROTOCOL_URI = 'https://didcomm.org/vt-flow/1.0' as const

export const VT_FLOW_VALIDATION_REQUEST_TYPE = `${VT_FLOW_PROTOCOL_URI}/validation-request` as const
export const VT_FLOW_ISSUANCE_REQUEST_TYPE = `${VT_FLOW_PROTOCOL_URI}/issuance-request` as const
export const VT_FLOW_OOB_LINK_TYPE = `${VT_FLOW_PROTOCOL_URI}/oob-link` as const
export const VT_FLOW_VALIDATING_TYPE = `${VT_FLOW_PROTOCOL_URI}/validating` as const
export const VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE = `${VT_FLOW_PROTOCOL_URI}/credential-state-change` as const
