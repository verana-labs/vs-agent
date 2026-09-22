import { ApiProperty } from '@nestjs/swagger'
import {
  VtFlowPendingAction,
  VtFlowRole,
  VtFlowVariant,
  type VtFlowIssuance,
  type VtFlowState,
  type VtFlowValidation,
} from '@verana-labs/credo-ts-didcomm-vt-flow'

import { VT_CONNECTION_STATES, type VtConnectionState } from '../../v2/vt/dto'

export class VtFlowRecordDto {
  @ApiProperty() id!: string
  @ApiProperty() threadId!: string
  @ApiProperty() participantSessionId!: string
  @ApiProperty() connectionId!: string
  @ApiProperty({ enum: VtFlowRole }) role!: VtFlowRole
  @ApiProperty({ enum: VtFlowVariant }) variant!: VtFlowVariant
  @ApiProperty() state!: VtFlowState
  @ApiProperty() agentParticipantId!: string
  @ApiProperty() walletAgentParticipantId!: string
  @ApiProperty({ required: false }) applicantParticipantId?: string
  @ApiProperty({ required: false }) validatorParticipantId?: string
  @ApiProperty({ required: false }) schemaId?: string
  @ApiProperty({ required: false, type: Object }) claims?: Record<string, unknown>
  @ApiProperty({ required: false }) credentialExchangeRecordId?: string
  @ApiProperty({ required: false }) subprotocolThid?: string
  @ApiProperty({ required: false, type: Object })
  oobLink?: { url: string; description: string; expiresAt?: string; at: string }

  @ApiProperty({ required: false, type: [Object] })
  messages?: { type: string; text: string; at: string; url?: string }[]

  @ApiProperty({ enum: VtFlowPendingAction }) pendingAction!: VtFlowPendingAction
  @ApiProperty({ required: false, type: Object }) validation?: VtFlowValidation
  @ApiProperty({ required: false, type: Object }) issuance?: VtFlowIssuance
  @ApiProperty({ required: false, type: [Object] }) proofs?: unknown[]
  @ApiProperty({ required: false }) credentialDigest?: string
  @ApiProperty({ required: false }) peerDid?: string
  @ApiProperty({ enum: VT_CONNECTION_STATES }) connectionState!: VtConnectionState
  @ApiProperty({ required: false }) errorMessage?: string
  @ApiProperty() createdAt!: Date
  @ApiProperty() updatedAt!: Date
  @ApiProperty() lastEventAt!: Date
}
