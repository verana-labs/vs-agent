import { CredentialState, DidExchangeState, ProofState, VtFlowState } from './common'
import {
  BasicMessageRecord,
  ConnectionRecord,
  CredentialExchangeRecord,
  MessageReactionAction,
  MessageState,
  PresentationRecord,
  ProfilePicture,
  SharedMediaItem,
} from './didcomm'
import { VtFlowRecord } from './vt'

export type ConnectionStateUpdatedData = ConnectionRecord & { previousState: DidExchangeState | null }

export type PresentationStateUpdatedData = PresentationRecord & { previousState: ProofState | null }

export type CredentialExchangeStateUpdatedData = CredentialExchangeRecord & {
  previousState: CredentialState | null
}

export type VtFlowStateUpdatedData = VtFlowRecord & { previousState: VtFlowState | null }

export interface MessageReceiptsReceivedData {
  connectionId: string
  receipts?: { messageId: string; state: MessageState; timestamp: string }[]
}

export interface MessageReactionsReceivedData {
  connectionId: string
  reactions?: { messageId: string; emoji: string; action: MessageReactionAction; timestamp: string }[]
}

export interface ReceivedUserProfile {
  displayName?: string
  displayPicture?: ProfilePicture | null | ''
  displayIcon?: ProfilePicture | null | ''
  description?: string
  preferredLanguage?: string
}

export interface ProfileReceivedData {
  connectionId: string
  threadId?: string
  profile: ReceivedUserProfile
  sendBackYours: boolean
}

export interface RequestProfileReceivedData {
  connectionId: string
  threadId: string
  query?: string[]
}

export interface ShareMediaReceivedData {
  connectionId: string
  threadId?: string
  description?: string
  items?: (SharedMediaItem & { id: string })[]
}

export interface RequestMediaReceivedData {
  connectionId: string
  threadId: string
  description?: string
  itemIds: string[]
}

export interface CallOfferReceivedData {
  connectionId: string
  threadId: string
  callType: string
  parameters: Record<string, unknown>
  description?: string
  offerStartTime?: string
  offerExpirationTime?: string
}

export interface CallAcceptReceivedData {
  connectionId: string
  threadId: string
  parameters: Record<string, unknown>
}

export interface CallThreadData {
  connectionId: string
  threadId: string
}

export interface MenuRequestReceivedData {
  connectionId: string
  threadId: string
}

export interface PerformReceivedData {
  connectionId: string
  threadId: string
  name: string
  params?: Record<string, string>
}

export interface AnswerReceivedData {
  connectionId: string
  threadId: string
  response: string
}

export interface MrzDataReceivedData {
  connectionId: string
  threadId: string
  mrzData: {
    raw: string | string[]
    parsed: { format?: string; fields: Partial<Record<string, string | null>>; valid: boolean }
  }
}

export interface EmrtdDataReceivedData {
  connectionId: string
  threadId: string
  dataGroups: {
    raw: Record<string, string>
    parsed: { fields?: Record<string, unknown>; valid: boolean }
    verification?: { authenticity: boolean; integrity: boolean; details?: string }
  }
}

export type MrtdProblemReportReason =
  | 'e.p.mrz-refused'
  | 'e.p.emrtd-refused'
  | 'e.p.mrz-timeout'
  | 'e.p.emrtd-timeout'

export interface MrtdProblemReportReceivedData {
  connectionId: string
  threadId: string
  reason: MrtdProblemReportReason
}

export interface VprNotificationPayload {
  module: string
  action: string
  messageType: string
  txIndex: number
  messageIndex: number
  sender: string
  relatedDids: string[]
  entityType?: string
  entityId?: string
}

export interface VprNotificationData {
  timestamp: string
  eventType: string
  did: string
  blockHeight: number
  txHash: string
  payload: VprNotificationPayload
  changes?: Record<string, unknown>
}

export interface EventDataMap {
  'didcomm.connections.state-updated': ConnectionStateUpdatedData
  'didcomm.basic-messages.message-received': BasicMessageRecord
  'didcomm.receipts.message-receipts-received': MessageReceiptsReceivedData
  'didcomm.reactions.message-reactions-received': MessageReactionsReceivedData
  'didcomm.user-profile.profile-received': ProfileReceivedData
  'didcomm.user-profile.request-profile-received': RequestProfileReceivedData
  'didcomm.media-sharing.share-media-received': ShareMediaReceivedData
  'didcomm.media-sharing.request-media-received': RequestMediaReceivedData
  'didcomm.calls.call-offer-received': CallOfferReceivedData
  'didcomm.calls.call-accept-received': CallAcceptReceivedData
  'didcomm.calls.call-reject-received': CallThreadData
  'didcomm.calls.call-end-received': CallThreadData
  'didcomm.action-menu.menu-request-received': MenuRequestReceivedData
  'didcomm.action-menu.perform-received': PerformReceivedData
  'didcomm.question-answer.answer-received': AnswerReceivedData
  'didcomm.mrtd.mrz-data-received': MrzDataReceivedData
  'didcomm.mrtd.emrtd-data-received': EmrtdDataReceivedData
  'didcomm.mrtd.problem-report-received': MrtdProblemReportReceivedData
  'didcomm.presentations.state-updated': PresentationStateUpdatedData
  'didcomm.credential-exchanges.state-updated': CredentialExchangeStateUpdatedData
  'vt.flows.state-updated': VtFlowStateUpdatedData
  'vpr.notification': VprNotificationData
}

export type EventType = keyof EventDataMap

export type EventEnvelope<T extends EventType = EventType> = T extends EventType
  ? { id: string; type: T; timestamp: string; data: EventDataMap[T] }
  : never

export interface UnknownEventEnvelope {
  id: string
  type: string
  timestamp: string
  data: unknown
}

export type EventHandlerFn<T extends EventType> = (
  data: EventDataMap[T],
  envelope: EventEnvelope<T>,
) => void | Promise<void>
