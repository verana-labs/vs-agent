import { DidCommProblemReportMessage, ImpactStatus, WhoRetriesStatus } from '@credo-ts/didcomm'

import { VT_FLOW_ERROR_INFO, VtFlowErrorCode } from './VtFlowErrorCode'

/** Inputs to `buildVtFlowProblemReport`; `enDescription`/`whoRetries`/`impact` default to per-code values from `VT_FLOW_ERROR_INFO`. */
export interface BuildVtFlowProblemReportOptions {
  code: VtFlowErrorCode
  threadId: string
  enDescription?: string
  fixHintEn?: string
  whoRetries?: WhoRetriesStatus
  impact?: ImpactStatus
}

const whoRetriesMap: Record<'you' | 'me' | 'both' | 'none', WhoRetriesStatus> = {
  you: WhoRetriesStatus.You,
  me: WhoRetriesStatus.Me,
  both: WhoRetriesStatus.Both,
  none: WhoRetriesStatus.None,
}

const impactMap: Record<'message' | 'thread' | 'connection', ImpactStatus> = {
  message: ImpactStatus.Message,
  thread: ImpactStatus.Thread,
  connection: ImpactStatus.Connection,
}

/** Build a problem-report with a `VtFlowErrorCode` description and `who_retries`/`impact` pulled from `VT_FLOW_ERROR_INFO`; caller drives dispatch and terminal-state transition. */
export function buildVtFlowProblemReport(
  options: BuildVtFlowProblemReportOptions,
): DidCommProblemReportMessage {
  const info = VT_FLOW_ERROR_INFO[options.code]

  const message = new DidCommProblemReportMessage({
    description: {
      code: options.code,
      en: options.enDescription ?? defaultEnglishDescription(options.code),
    },
    whoRetries: options.whoRetries ?? whoRetriesMap[info.whoRetries],
    impact: options.impact ?? impactMap[info.impact],
    fixHint: options.fixHintEn ? { en: options.fixHintEn } : undefined,
  })

  message.setThread({ threadId: options.threadId })

  return message
}

function defaultEnglishDescription(code: VtFlowErrorCode): string {
  switch (code) {
    case VtFlowErrorCode.VrRequired:
      return 'A validation-request was expected for this session.'
    case VtFlowErrorCode.IrRequired:
      return 'An issuance-request was expected for this session.'
    case VtFlowErrorCode.UnsupportedMessage:
      return 'The received message is not supported in the current state.'
    case VtFlowErrorCode.InvalidPermId:
      return 'The supplied perm_id is invalid for this Validator.'
    case VtFlowErrorCode.InvalidSchemaId:
      return 'The supplied schema_id is not supported by this Validator.'
    case VtFlowErrorCode.InvalidAgentPermId:
      return 'The supplied agent_perm_id did not resolve on-chain.'
    case VtFlowErrorCode.InvalidWalletAgentPermId:
      return 'The supplied wallet_agent_perm_id did not resolve on-chain.'
    case VtFlowErrorCode.InvalidClaims:
      return 'The submitted claims do not satisfy the schema.'
    case VtFlowErrorCode.InvalidSessionUuid:
      return 'The supplied session_uuid is invalid or conflicts with an existing session.'
    case VtFlowErrorCode.NotAVerifiableService:
      return "The peer's DID does not identify a Verifiable Service."
    case VtFlowErrorCode.ValidationFailed:
      return 'Off-chain validation of the submitted documentation failed.'
    case VtFlowErrorCode.OobExpired:
      return 'The OOB link expired before the Applicant completed it.'
    case VtFlowErrorCode.SessionTerminated:
      return 'The session was terminated by the peer.'
    case VtFlowErrorCode.InternalError:
      return 'An internal error occurred while processing the session.'
    default: {
      const _exhaustive: never = code
      void _exhaustive
      return 'Unknown vt-flow error.'
    }
  }
}
