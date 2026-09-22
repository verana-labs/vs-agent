import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { VtFlowRole, VtFlowState, VtFlowVariant } from '@verana-labs/credo-ts-didcomm-vt-flow'

import { PageDto } from '../../../../../common'

/**
 * Connection State values of [VSA-VTI-FLOW-STATE] Flow State.
 */
export const VT_CONNECTION_STATES = ['NOT_CONNECTED', 'ESTABLISHED', 'TERMINATED'] as const

export type VtConnectionState = (typeof VT_CONNECTION_STATES)[number]

/**
 * One credential acquisition flow record of [VSA-ADM-VT-FL-LIST] listFlows.
 * [VSA-ADM-VT-FL-GET] getFlow returns one record of this shape.
 */
export class V2VtFlowOobLinkDto {
  @ApiProperty() url!: string
  @ApiProperty() description!: string
  @ApiPropertyOptional({ description: 'expires_time of the message, when the sender set one.' })
  expiresAt?: string
  @ApiProperty({ description: 'When the agent sent or received the message.' }) at!: string
}

export class V2VtFlowMessageDto {
  @ApiProperty({ enum: ['oob-link', 'validating', 'problem-report'] }) type!: string
  @ApiProperty() text!: string
  @ApiProperty() at!: string
  @ApiPropertyOptional({ description: 'Set for an oob-link only.' }) url?: string
}

export class V2VtFlowRecordDto {
  @ApiProperty({ description: 'Identifier of the flow record.' })
  id!: string

  @ApiProperty({ description: 'DIDComm session identifier of the flow.' })
  participantSessionId!: string

  @ApiProperty({ description: 'Current Flow State.', enum: VtFlowState })
  flowState!: VtFlowState

  @ApiProperty({
    description: 'Current Connection State.',
    enum: VT_CONNECTION_STATES,
  })
  connectionState!: VtConnectionState

  @ApiProperty({
    description: 'Role of the agent in the flow.',
    enum: VtFlowRole,
  })
  role!: VtFlowRole

  @ApiProperty({
    description: 'Flow variant that the agent runs.',
    enum: VtFlowVariant,
  })
  variant!: VtFlowVariant

  @ApiProperty({ description: 'DIDComm thread identifier of the flow.' })
  threadId!: string

  @ApiProperty({
    description: 'Identifier of the DIDComm connection of the flow.',
  })
  connectionId!: string

  @ApiProperty({ description: 'Participant identifier of this agent.' })
  agentParticipantId!: string

  @ApiProperty({
    description: 'Participant identifier of the wallet agent of this agent.',
  })
  walletAgentParticipantId!: string

  @ApiPropertyOptional({ description: 'DID of the remote peer.' })
  peerDid?: string

  @ApiPropertyOptional({
    description: 'Participant identifier of the applicant entry being onboarded.',
  })
  applicantParticipantId?: string

  @ApiPropertyOptional({
    description: 'Participant identifier of the validator entry the applicant is onboarding under.',
  })
  validatorParticipantId?: string

  @ApiPropertyOptional({
    description: 'Credential schema identifier of the flow.',
  })
  schemaId?: string

  @ApiPropertyOptional({
    description: 'Credential claims that the applicant submitted.',
    type: Object,
  })
  claims?: Record<string, unknown>

  @ApiPropertyOptional({
    description: 'Proofs that the applicant submitted.',
    type: [Object],
  })
  proofs?: unknown[]

  @ApiPropertyOptional({
    description:
      'The outstanding oob-link, when one exists. Cleared on every transition out of OOB_PENDING. ' +
      'An expired link stays on the record until then and pendingAction reports it.',
  })
  oobLink?: V2VtFlowOobLinkDto

  @ApiPropertyOptional({
    description:
      'Human-readable messages of the flow, in order. A validator lists what it sent, an applicant what it received.',
    type: [V2VtFlowMessageDto],
  })
  messages?: V2VtFlowMessageDto[]

  @ApiPropertyOptional({
    description: 'Identifier of the credential exchange of the offered credential.',
  })
  credentialExchangeRecordId?: string

  @ApiPropertyOptional({ description: 'digestJCS of the offered credential.' })
  credentialDigest?: string

  @ApiPropertyOptional({
    description: 'DIDComm thread identifier of the subprotocol in flight.',
  })
  subprotocolThid?: string

  @ApiPropertyOptional({
    description: 'Message of the error that stopped the flow.',
  })
  errorMessage?: string

  @ApiProperty({ description: 'Time when the agent created the flow.' })
  createdAt!: Date

  @ApiProperty({ description: 'Time when the agent last changed the flow.' })
  updatedAt!: Date

  @ApiProperty({ description: 'Time of the last event of the flow.' })
  lastEventAt!: Date
}

export const V2VtFlowRecordPageDto = PageDto(V2VtFlowRecordDto)
