import { ApiProperty } from '@nestjs/swagger'
import { VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { IsEnum, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUrl } from 'class-validator'

import { PaginationQueryDto } from '../../../../common'
import { VT_CONNECTION_STATES, type VtConnectionState } from '../../v2/vt/dto'

export class ListFlowsQueryDto {
  @ApiProperty({ required: false, enum: VtFlowRole })
  @IsOptional()
  @IsEnum(VtFlowRole)
  role?: VtFlowRole

  @ApiProperty({ required: false, enum: VT_CONNECTION_STATES })
  @IsOptional()
  @IsIn([...VT_CONNECTION_STATES])
  connectionState?: VtConnectionState

  @ApiProperty({ required: false, enum: VtFlowState })
  @IsOptional()
  @IsEnum(VtFlowState)
  flowState?: VtFlowState

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  peerDID?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  participant_id?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  schema_id?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  participant_session_id?: string
}

export class ListFlowsV2QueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, enum: VtFlowRole })
  @IsOptional()
  @IsEnum(VtFlowRole)
  role?: VtFlowRole

  @ApiProperty({ required: false, enum: VT_CONNECTION_STATES })
  @IsOptional()
  @IsIn([...VT_CONNECTION_STATES])
  connectionState?: VtConnectionState

  @ApiProperty({ required: false, enum: VtFlowState })
  @IsOptional()
  @IsEnum(VtFlowState)
  flowState?: VtFlowState

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  peerDid?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  participantId?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  schemaId?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  participantSessionId?: string
}

export class EditClaimsDto {
  @ApiProperty({ type: Object })
  @IsObject()
  claims!: Record<string, unknown>
}

export class SendOobLinkDto {
  @ApiProperty()
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @IsNotEmpty()
  url!: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string
}

export class RevokeFlowCredentialDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string
}
