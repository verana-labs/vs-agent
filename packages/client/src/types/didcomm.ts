import {
  BasicMessageRole,
  Claim,
  CredentialRole,
  CredentialState,
  DidCommVersion,
  DidExchangeRole,
  DidExchangeState,
  PaginationQuery,
  ProofRole,
  ProofState,
  RequestedCredential,
} from './common'

export interface ProtocolModule {
  module: string
  protocols: string[]
}

export interface ConnectionRecord {
  id: string
  state: DidExchangeState
  role: DidExchangeRole
  did?: string
  theirDid?: string
  theirLabel?: string
  alias?: string
  threadId?: string
  imageUrl?: string
  outOfBandId: string | null
  parentConnectionId: string | null
  invitationDid?: string
  didcommVersion?: DidCommVersion
  mediatorId?: string
  previousDids?: string[]
  previousTheirDids?: string[]
  createdAt: string
  updatedAt: string
}

export interface ListConnectionsQuery extends PaginationQuery {
  outOfBandId?: string
  parentConnectionId?: string
  state?: DidExchangeState
  role?: DidExchangeRole
  did?: string
  theirDid?: string
  threadId?: string
  invitationDid?: string
  didcommVersion?: DidCommVersion
  mediatorId?: string
}

export interface SendInvitationBody {
  connectionId: string
  did?: string
  label?: string
  imageUrl?: string
  goal?: string
  goalCode?: string
}

export interface SendInvitationResponse {
  id: string
  outOfBandId?: string
}

export interface SendBasicMessageBody {
  connectionId: string
  content: string
}

export interface ListBasicMessagesQuery extends PaginationQuery {
  connectionId?: string
  role?: BasicMessageRole
}

export interface BasicMessageRecord {
  id: string
  connectionId: string
  role: BasicMessageRole
  content: string
  sentTime: string
  createdAt: string
}

export type MessageState = 'created' | 'submitted' | 'received' | 'viewed' | 'deleted'

export interface MessageReceipt {
  messageId: string
  state: MessageState
  timestamp?: string
}

export interface SendReceiptsBody {
  connectionId: string
  receipts: MessageReceipt[]
}

export type MessageReactionAction = 'react' | 'unreact'

export interface MessageReaction {
  messageId: string
  emoji: string
  action: MessageReactionAction
  timestamp?: string
}

export interface SendReactionsBody {
  connectionId: string
  reactions: MessageReaction[]
}

export interface ProfilePicture {
  mimeType?: string
  links?: string[]
  base64?: string
}

export interface UserProfile {
  displayName?: string
  displayPicture?: ProfilePicture
  displayIcon?: ProfilePicture
  description?: string
  preferredLanguage?: string
}

export interface SendProfileBody {
  connectionId: string
  profile?: UserProfile
  sendBackYours?: boolean
  threadId?: string
}

export interface RequestProfileBody {
  connectionId: string
  query?: string[]
}

export interface MediaCiphering {
  algorithm: string
  parameters: Record<string, unknown>
}

export interface SharedMediaItem {
  id?: string
  uri: string
  mimeType: string
  fileName?: string
  description?: string
  byteCount?: number
  ciphering?: MediaCiphering
  metadata?: Record<string, unknown>
}

export interface ShareMediaBody {
  connectionId: string
  description?: string
  threadId?: string
  items: SharedMediaItem[]
}

export type CallType = 'audio' | 'video' | 'service'

export interface OfferCallBody {
  connectionId: string
  callType: CallType
  parameters: Record<string, unknown>
  description?: string
  offerStartTime?: string
  offerExpirationTime?: string
}

export interface CallThreadBody {
  connectionId: string
  threadId: string
}

export interface AcceptCallBody extends CallThreadBody {
  parameters: Record<string, unknown>
}

export type ActionMenuFormInputType = 'text'

export interface ActionMenuFormParameter {
  name: string
  title: string
  description: string
  default?: string
  required?: boolean
  type?: ActionMenuFormInputType
}

export interface ActionMenuForm {
  description: string
  submitLabel: string
  params: ActionMenuFormParameter[]
}

export interface ActionMenuOption {
  name: string
  title: string
  description: string
  disabled?: boolean
  form?: ActionMenuForm
}

export interface ActionMenu {
  title: string
  description: string
  options: ActionMenuOption[]
}

export interface SendMenuBody {
  connectionId: string
  menu: ActionMenu
}

export interface ValidResponse {
  text: string
}

export interface SendQuestionBody {
  connectionId: string
  question: string
  validResponses: ValidResponse[]
  detail?: string
}

export interface RequestMrtdBody {
  connectionId: string
}

export interface PresentationRecord {
  proofExchangeId: string
  state: ProofState
  role: ProofRole
  connectionId?: string
  requestedCredentials: RequestedCredential[]
  claims: Claim[]
  verified: boolean
  threadId?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export interface RequestedCredentialInput {
  credentialDefinitionId?: string
  jsonSchemaCredentialId?: string
  attributes?: string[]
}

export interface CreatePresentationRequestBody {
  requestedCredentials: RequestedCredentialInput[]
  requireNonRevocation?: boolean
  autoAccept?: boolean
  useLegacyDid?: boolean
  didcommVersion?: DidCommVersion
}

export interface CreatePresentationRequestResponse {
  proofExchangeId: string
  invitation: Record<string, unknown>
  shortUrl: string
}

export interface DeclineExchangeBody {
  reason?: string
}

export interface CredentialExchangeRecord {
  credentialExchangeId: string
  state: CredentialState
  role: CredentialRole
  threadId: string
  connectionId?: string
  credentialDefinitionId?: string
  schemaId?: string
  claims: Claim[]
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export interface CreateCredentialOfferBody {
  credentialDefinitionId: string
  claims: Claim[]
  revocationRegistryDefinitionId?: string
  revocationRegistryIndex?: number
  autoAccept?: boolean
  useLegacyDid?: boolean
  didcommVersion?: DidCommVersion
}

export interface CreateCredentialOfferResponse {
  credentialExchangeId: string
  invitation: Record<string, unknown>
  shortUrl: string
}
