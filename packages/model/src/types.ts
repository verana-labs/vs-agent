import { JsonObject } from '@credo-ts/core'
import {
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
  DidCommHandshakeProtocol,
  DidCommProofState,
  DidCommVersion,
  OutOfBandDidCommService,
  ReceiveOutOfBandInvitationConfig,
} from '@credo-ts/didcomm'

import { Claim, ClaimOptions } from './messages/CredentialIssuanceMessage'

export interface VsAgentInfo {
  label: string
  endpoints: string[]
  isInitialized: boolean
  publicDid?: string
}

export interface AgentMessageType {
  '@id': string
  '@type': string
  [key: string]: unknown
}

export interface CreateCredentialTypeOptions {
  name: string
  version: string
  attributes: string[]
  schemaId?: string
  supportRevocation?: boolean
  relatedJsonSchemaCredentialId?: string
}

export interface CredentialIssuanceRequest {
  format: 'jsonld' | 'anoncreds'
  jsonSchemaCredentialId: string
  claims: JsonObject
  did?: string
  participantSessionId?: string
  agentParticipantId?: number
  walletAgentParticipantId?: number
}

export interface CredentialIssuanceResponse {
  status: number
  didcommInvitationUrl?: string
  jsonSchemaCredentialId?: string
  credential?: Record<string, unknown>
  digestJCS?: string
}

export interface CredentialRevocationRequest {
  format: 'jsonld' | 'anoncreds'
  anoncredsRevocationRegistryDefinitionId?: string
  anoncredsRevocationRegistryIndex?: number
}

export interface CredentialRevocationResponse {
  status: number
}

export interface ImportCredentialTypeOptions {
  id: string
  data: {
    name: string
    version: string
    credentialDefinition: JsonObject
    credentialDefinitionPrivate: JsonObject
    keyCorrectnessProof: JsonObject
    schema?: JsonObject
  }
}

export interface CredentialTypeInfo extends CreateCredentialTypeOptions {
  id: string
}

export interface CredentialTypeResult extends Omit<CredentialTypeInfo, 'supportRevocation'> {
  revocationSupported: boolean
  relatedJsonSchemaCredentialId?: string
}

export interface RevocationRegistryInfo {
  credentialDefinitionId: string
  maximumCredentialNumber: number
}

export interface CreatePresentationRequestOptions {
  ref?: string
  callbackUrl?: string
  requestedCredentials: RequestedCredential[]
  requireNonRevocation?: boolean
}

export type RequestedCredential = {
  credentialDefinitionId?: string
  jsonSchemaCredentialId?: string
  attributes?: string[]
}

export interface CreatePresentationRequestResult {
  proofExchangeId: string
  url: string
  shortUrl: string
}

export interface CreateInvitationResult {
  url: string
}

export interface SendInvitationOptions {
  connectionId: string
  did?: string
  label?: string
  imageUrl?: string
  goal?: string
  goalCode?: string
}

export interface SendInvitationResult {
  id: string
  outOfBandId?: string
}

export interface ConnectionRecord {
  id: string
  state: DidCommDidExchangeState
  role: DidCommDidExchangeRole
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
  createdAt: Date
  updatedAt: Date
}

export interface PresentationData {
  requestedCredentials: RequestedCredential[]
  claims: Claim[]
  verified: boolean
  state: DidCommProofState
  proofExchangeId: string
  threadId: string
  updatedAt: Date | undefined
}

export interface CreateCredentialOfferOptions {
  credentialDefinitionId: string
  claims: ClaimOptions[]
}

export interface CreateCredentialOfferResult {
  credentialExchangeId: string
  url: string
  shortUrl: string
}

type ReceiveOutOfBandInvitationProps = Omit<ReceiveOutOfBandInvitationConfig, 'routing'>

export interface ReceiveInvitationProps extends ReceiveOutOfBandInvitationProps {
  invitation: Omit<OutOfBandInvitationSchema, 'appendedAttachments'>
}

export interface ReceiveInvitationByUrlProps extends ReceiveOutOfBandInvitationProps {
  invitationUrl: string
}

export interface AcceptInvitationConfig {
  autoAcceptConnection?: boolean
  reuseConnection?: boolean
  label?: string
  alias?: string
  imageUrl?: string
  mediatorId?: string
}

export interface OutOfBandInvitationSchema {
  '@id'?: string
  '@type': string
  label: string
  goalCode?: string
  goal?: string
  accept?: string[]
  handshake_protocols?: DidCommHandshakeProtocol[]
  services: Array<OutOfBandDidCommService | string>
  imageUrl?: string
}

export interface ReceiveInvitationResult {
  outOfBandId: string
  connectionId?: string
}
