import { ApiProperty } from '@nestjs/swagger'
import { VtFlowRole, VtFlowVariant, type VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'

export class VtFlowRecordDto {
  @ApiProperty() vtFlowRecordId!: string
  @ApiProperty() threadId!: string
  @ApiProperty() sessionUuid!: string
  @ApiProperty() connectionId!: string
  @ApiProperty({ enum: VtFlowRole }) role!: VtFlowRole
  @ApiProperty({ enum: VtFlowVariant }) variant!: VtFlowVariant
  @ApiProperty() state!: VtFlowState
  @ApiProperty() agentPermId!: string
  @ApiProperty() walletAgentPermId!: string
  @ApiProperty({ required: false }) permId?: string
  @ApiProperty({ required: false }) schemaId?: string
  @ApiProperty({ required: false, type: Object }) claims?: Record<string, unknown>
  @ApiProperty({ required: false }) credentialExchangeRecordId?: string
  @ApiProperty({ required: false }) subprotocolThid?: string
  @ApiProperty({ required: false }) errorMessage?: string
  @ApiProperty() createdAt!: Date
  @ApiProperty() updatedAt!: Date
}
