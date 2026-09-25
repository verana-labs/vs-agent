/** Canonical URIs for the five vt-flow superprotocol messages and the adopted problem-report. */
export const VT_FLOW_PROTOCOL_URI = 'https://didcomm.org/vt-flow/1.0' as const

export const VT_FLOW_ONBOARDING_REQUEST_TYPE = `${VT_FLOW_PROTOCOL_URI}/onboarding-request` as const
export const VT_FLOW_ISSUANCE_REQUEST_TYPE = `${VT_FLOW_PROTOCOL_URI}/issuance-request` as const
export const VT_FLOW_OOB_LINK_TYPE = `${VT_FLOW_PROTOCOL_URI}/oob-link` as const
export const VT_FLOW_VALIDATING_TYPE = `${VT_FLOW_PROTOCOL_URI}/validating` as const
export const VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE = `${VT_FLOW_PROTOCOL_URI}/credential-state-change` as const

/** The adopted problem-report of the spec, which is not under the vt-flow protocol URI. */
export const VT_FLOW_PROBLEM_REPORT_TYPE = 'https://didcomm.org/report-problem/1.0/problem-report' as const
