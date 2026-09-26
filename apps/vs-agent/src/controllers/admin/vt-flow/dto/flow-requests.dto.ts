import { ApiProperty } from '@nestjs/swagger'
import { VtFlowErrorCode, VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator'

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
  applicantParticipantId?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  validatorParticipantId?: string

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

export class SendOobLinkV2Dto {
  @ApiProperty({ description: 'Absolute https:// URL where the applicant completes the step.' })
  @IsUrl({ require_tld: false, protocols: ['https'], require_protocol: true })
  url!: string

  @ApiProperty({ description: 'The text the applicant reads.' })
  @IsString()
  @IsNotEmpty()
  description!: string

  @ApiProperty({ required: false, description: 'ISO 8601 UTC datetime, the expires_time of the message.' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string
}

export class StartValidationDto {
  @ApiProperty({ required: false, description: 'The text the applicant reads.' })
  @IsOptional()
  @IsString()
  comment?: string
}

const TERMINATED_BY_VALIDATOR_CODES = [
  VtFlowErrorCode.ValidationRefused,
  VtFlowErrorCode.SessionTerminated,
  VtFlowErrorCode.OobExpired,
]

export class RejectFlowDto {
  @ApiProperty({
    required: false,
    enum: TERMINATED_BY_VALIDATOR_CODES,
    default: VtFlowErrorCode.ValidationRefused,
  })
  @IsOptional()
  @IsIn(TERMINATED_BY_VALIDATOR_CODES)
  code?: VtFlowErrorCode

  @ApiProperty({ description: 'The reason, sent to the applicant in the problem-report.' })
  @IsString()
  @IsNotEmpty()
  description!: string
}

export class RevokeFlowCredentialDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string
}

export class ValidateFlowDto {
  @ApiProperty({
    required: false,
    description: 'Non-negative integer, in the unit of the schema pricing asset.',
  })
  @IsOptional()
  @IsInt()
  validationFees?: number

  @ApiProperty({
    required: false,
    description: 'Non-negative integer, in the unit of the schema pricing asset.',
  })
  @IsOptional()
  @IsInt()
  issuanceFees?: number

  @ApiProperty({
    required: false,
    description: 'Non-negative integer, in the unit of the schema pricing asset.',
  })
  @IsOptional()
  @IsInt()
  verificationFees?: number

  @ApiProperty({ required: false, description: 'Decimal between 0 and 1.' })
  @IsOptional()
  @IsNumber()
  issuanceFeeDiscount?: number

  @ApiProperty({ required: false, description: 'Decimal between 0 and 1.' })
  @IsOptional()
  @IsNumber()
  verificationFeeDiscount?: number

  @ApiProperty({
    required: false,
    description:
      'effective_until of the entry. When absent the VPR uses the expiration of the onboarding process, ' +
      'or no limit when the validity period of the role is 0.',
  })
  @IsOptional()
  @IsISO8601()
  effectiveUntil?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  opSummaryDigest?: string
}
