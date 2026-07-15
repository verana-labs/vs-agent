import { ApiProperty } from '@nestjs/swagger'
import { VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { IsEnum, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUrl } from 'class-validator'

export class ListFlowsQueryDto {
  @ApiProperty({ required: false, enum: VtFlowRole })
  @IsOptional()
  @IsEnum(VtFlowRole)
  role?: VtFlowRole

  @ApiProperty({ required: false, enum: ['NOT_CONNECTED', 'ESTABLISHED', 'TERMINATED'] })
  @IsOptional()
  @IsIn(['NOT_CONNECTED', 'ESTABLISHED', 'TERMINATED'])
  connectionState?: 'NOT_CONNECTED' | 'ESTABLISHED' | 'TERMINATED'

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
